import type { ClassifiedLine } from '../classify.js';
import type { GitHub } from '../io/github.js';
import type { LocalGit } from '../io/git.js';
import type { Promotion } from '../next-version.js';
import type { OpenReleasePr } from '../release-pr-decision.js';
import type { PublishMode } from '../types.js';

import { runShell } from '../io/exec.js';
import { fetchPackument } from '../io/npm.js';
import { publicPackages, publishModeAt, readLinesFile, versionAt } from '../io/repo.js';
import { isBlocked, isStale } from '../nightly.js';
import { decideReleasePr } from '../release-pr-decision.js';
import { releaseContent } from '../release-content.js';
import { DEFAULT_SECURITY_BATCH_MINUTES } from '../types.js';

import {
	classifiedLines,
	ensureIssue,
	github,
	localGit,
	RELEASE_LABEL,
	REPLACED_LABEL,
	requireEnv,
	summary,
} from './context.js';
import { generateRelease } from './generate.js';
import { nightlyRuns } from './runs.js';

/** The label of a pull request that fixes a vulnerability. */
export const SECURITY_LABEL = 'security';

interface PullRequest {
	readonly number: number;
	readonly node_id: string;
	readonly body: string | null;
	readonly state: string;
	readonly merged_at: string | null;
	readonly labels: readonly { readonly name: string }[];
	readonly base: { readonly ref: string };
	readonly head: { readonly ref: string; readonly sha: string };
}

/**
 * The markers a Release PR body carries.
 * @param branch - The line branch
 * @returns The marker of the line
 * @example
 * lineMarker('dev'); // '<!-- release-automation:line:dev -->'
 */
export function lineMarker(branch: string): string {
	return `<!-- release-automation:line:${branch} -->`;
}

/**
 * Reads a value marker from a Release PR body.
 * @param body - The body
 * @param name - The marker name (`fingerprint`, `promote`)
 * @returns The value, or `null`
 * @example
 * markerValue('<!-- release-automation:promote:rc -->', 'promote'); // 'rc'
 */
export function markerValue(body: string | null, name: string): string | null {
	return (
		new RegExp(`<!-- release-automation:${name}:([^ ]+) -->`).exec(body ?? '')?.[1] ??
		null
	);
}

/**
 * The branch a line's Release PR is pushed to.
 * @param branch - The line branch
 * @returns The head branch
 * @example
 * releaseBranch('dev'); // 'release/dev'
 */
export function releaseBranch(branch: string): string {
	return `release/${branch}`;
}

/**
 * The revision of the last release of a line: `main` for the current line,
 * the tag of the version on the line's branch for the others.
 * @param git - Git access
 * @param line - The line
 * @param mode - The publishing mode
 * @returns The revision
 */
export function baselineOf(
	git: LocalGit,
	line: ClassifiedLine,
	mode: PublishMode,
): string {
	if (line.role === 'current' || mode === 'lerna-independent') {
		return `origin/${line.publishBranch}`;
	}
	return `v${versionAt(git, `origin/${line.branch}`) ?? ''}`;
}

/**
 * Runs the Release PR decision for every line, or one, and acts on it with
 * the Release App's token (`RELEASE_APP_TOKEN`). The checkout must hold every
 * branch and tag.
 * @param options - What to run
 * @param options.line - Only this line branch
 * @param options.manual - Whether a person started the run
 * @param options.promote - The stage a person asked for
 * @param options.dryRun - Decide and report without writing
 * @example
 * await releasePrCommand({ manual: false, promote: null, dryRun: false });
 */
export async function releasePrCommand(options: {
	readonly line?: string;
	readonly manual: boolean;
	readonly promote: Promotion | null;
	readonly dryRun: boolean;
}): Promise<void> {
	const now = new Date();
	const git = localGit();
	const gh = github('RELEASE_APP_TOKEN');
	const { lines, collaborative } = classifiedLines(git, now);
	const mode = publishModeAt(git, 'origin/dev');
	const linesFile = readLinesFile(git, 'origin/dev');
	const targets =
		options.line === undefined
			? lines
			: lines.filter(({ branch }) => branch === options.line);
	if (targets.length === 0) {
		throw new Error(`${options.line ?? ''} is not a line`);
	}

	const prs = await gh.paginate<PullRequest>(
		'/repos/{repo}/pulls?state=all&sort=updated&direction=desc',
	);
	const releasePrs = prs.filter((pr) =>
		pr.labels.some(({ name }) => name === RELEASE_LABEL),
	);

	for (const line of targets) {
		const runs = await nightlyRuns(gh, line.branch);
		if (isStale(runs, now)) {
			await ensureIssue(
				gh,
				{
					marker: `<!-- release-automation:nightly-stale:${line.branch} -->`,
					title: `The Nightly of ${line.branch} stopped running`,
					body: `<!-- release-automation:nightly-stale:${line.branch} -->\n\nNo Nightly of \`${line.branch}\` finished in the last two days. GitHub disables the schedule of a public repository after 60 days without activity; enable the Nightly workflow again in the Actions tab, then close this Issue.\n`,
				},
				[],
			);
		}

		const baseline = baselineOf(git, line, mode);
		const head = `origin/${line.branch}`;
		const content = releaseContent(git, baseline, head);
		const securityLandedAt: Date[] = [];
		for (const carrier of content.carriers) {
			const pulls = await gh.rest<PullRequest[]>(
				'GET',
				`/repos/{repo}/commits/${carrier.sha}/pulls`,
			);
			if (pulls.some((pr) => pr.labels.some(({ name }) => name === SECURITY_LABEL))) {
				securityLandedAt.push(new Date(carrier.time * 1000));
			}
		}

		const mine = releasePrs.filter((pr) =>
			(pr.body ?? '').includes(lineMarker(line.branch)),
		);
		const open = mine.find((pr) => pr.state === 'open') ?? null;
		const declined = mine
			.filter(
				(pr) =>
					pr.state === 'closed' &&
					pr.merged_at === null &&
					!pr.labels.some(({ name }) => name === REPLACED_LABEL),
			)
			.map((pr) => markerValue(pr.body, 'fingerprint'))
			.filter((value): value is string => value !== null);

		const openPr = open === null ? null : await describeOpenPr(gh, git, open);
		const decision = decideReleasePr({
			now,
			manual: options.manual,
			fingerprint: content.fingerprint,
			userFacingSince:
				content.carriers[0] === undefined
					? null
					: new Date(content.carriers[0].time * 1000),
			securityLandedAt,
			openPr,
			declinedFingerprints: declined,
			nightlyFailing: isBlocked(runs),
			syncPending:
				line.role === 'current' && !git.isAncestor('origin/main', 'origin/dev'),
			publishIncomplete: await publishIncomplete(git, line, mode),
			securityBatchMinutes:
				linesFile?.securityBatchMinutes ?? DEFAULT_SECURITY_BATCH_MINUTES,
		});
		await summary(`${line.branch}: ${JSON.stringify(decision)}`);
		if (options.dryRun || decision.action === 'none') {
			continue;
		}

		if (decision.action === 'replace' && open !== null) {
			await gh.rest('POST', `/repos/{repo}/issues/${open.number}/labels`, {
				labels: [REPLACED_LABEL],
			});
			await gh.rest('POST', `/repos/{repo}/issues/${open.number}/comments`, {
				body: 'Replaced: the release changed after this pull request was approved. A successor Release PR carries the current content and needs a new review and Full CI.',
			});
			await gh.rest('PATCH', `/repos/{repo}/pulls/${open.number}`, { state: 'closed' });
			if (!decision.openSuccessor) {
				continue;
			}
		}

		const promote = options.manual ? options.promote : null;
		const result = await pushRelease({
			git,
			gh,
			line,
			lines,
			mode,
			baseline,
			promote,
			fingerprint: content.fingerprint ?? '',
			now,
		});
		if (!result.ok) {
			await summary(`${line.branch}: ${result.reason}`);
			continue;
		}
		const body = releaseBody({
			line,
			version: result.version,
			fingerprint: content.fingerprint ?? '',
			promote,
			changes: content.changes,
		});
		const title =
			result.version === null ? `Release ${line.branch}` : `Release v${result.version}`;
		if (decision.action === 'update' && open !== null) {
			await gh.rest('PATCH', `/repos/{repo}/pulls/${open.number}`, { title, body });
			continue;
		}
		const pr = await gh.rest<PullRequest>('POST', '/repos/{repo}/pulls', {
			title,
			body,
			head: releaseBranch(line.branch),
			base: line.publishBranch,
		});
		await gh.rest('POST', `/repos/{repo}/issues/${pr.number}/labels`, {
			labels: [RELEASE_LABEL],
		});
		if (collaborative) {
			await gh.graphql(
				'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }',
				{ id: pr.node_id },
			);
		}
		await summary(`${line.branch}: opened #${pr.number}`);
	}
}

/**
 * @param gh - The client
 * @param git - Git access
 * @param pr - The open Release PR
 * @returns What the decision reads about it
 */
async function describeOpenPr(
	gh: GitHub,
	git: LocalGit,
	pr: PullRequest,
): Promise<OpenReleasePr> {
	const reviews = await gh.paginate<{
		user: { login: string; type: string } | null;
		state: string;
		submitted_at: string;
	}>(`/repos/{repo}/pulls/${pr.number}/reviews`);
	const latest = new Map<string, { state: string; at: Date }>();
	for (const review of reviews) {
		if (
			review.user === null ||
			review.user.type !== 'User' ||
			review.state === 'COMMENTED'
		) {
			continue;
		}
		latest.set(review.user.login, {
			state: review.state,
			at: new Date(review.submitted_at),
		});
	}
	const approvals = [...latest.values()].filter(({ state }) => state === 'APPROVED');
	const approvedAt =
		approvals.length === 0
			? null
			: new Date(Math.min(...approvals.map(({ at }) => at.getTime())));
	const baseTime =
		Number(git.raw('log', '-1', '--format=%ct', `origin/${pr.base.ref}`)) * 1000;
	return {
		number: pr.number,
		fingerprint: markerValue(pr.body, 'fingerprint') ?? '',
		approvedAt,
		baseUpdatedSinceApproval: approvedAt !== null && baseTime > approvedAt.getTime(),
	};
}

/**
 * Tells whether the last release of a line is not fully out: a public package
 * whose version on the publish branch is missing from the registry, or for a
 * repository without npm packages, a version without its tag.
 * @param git - Git access
 * @param line - The line
 * @param mode - The publishing mode
 * @returns Whether the release is incomplete
 */
async function publishIncomplete(
	git: LocalGit,
	line: ClassifiedLine,
	mode: PublishMode,
): Promise<boolean> {
	const rev = `origin/${line.publishBranch}`;
	if (mode === 'custom') {
		const version = versionAt(git, rev);
		return version !== null && !git.tags(rev).includes(`v${version}`);
	}
	for (const pkg of publicPackages(git, rev)) {
		const packument = await fetchPackument(pkg.name);
		if (packument !== null && !packument.versions.includes(pkg.version)) {
			return true;
		}
	}
	return false;
}

/**
 * Generates the release commit on top of the line's head as the Release App
 * and force-pushes it to the release branch.
 * @param input - The line and what to release
 * @returns The version, or why there is none
 */
async function pushRelease(input: {
	readonly git: LocalGit;
	readonly gh: GitHub;
	readonly line: ClassifiedLine;
	readonly lines: readonly ClassifiedLine[];
	readonly mode: PublishMode;
	readonly baseline: string;
	readonly promote: Promotion | null;
	readonly fingerprint: string;
	readonly now: Date;
}): Promise<{ ok: true; version: string | null } | { ok: false; reason: string }> {
	const { git } = input;
	git.raw('checkout', '--force', '--detach', `origin/${input.line.branch}`);
	runShell('yarn install --immutable', git.cwd);
	const generated = generateRelease({
		git,
		mode: input.mode,
		line: input.line,
		lines: input.lines,
		baseline: input.baseline,
		promote: input.promote,
		now: input.now,
	});
	if (!generated.ok) {
		git.raw('checkout', '--force', '--detach', `origin/${input.line.branch}`);
		return generated;
	}
	const appSlug = requireEnv('RELEASE_APP_SLUG');
	const bot = await input.gh.rest<{ id: number }>(
		'GET',
		`/users/${encodeURIComponent(`${appSlug}[bot]`)}`,
	);
	git.raw('add', '--all');
	git.raw(
		'-c',
		`user.name=${appSlug}[bot]`,
		'-c',
		`user.email=${bot.id}+${appSlug}[bot]@users.noreply.github.com`,
		'commit',
		'--no-verify',
		'--message',
		generated.message,
	);
	const token = requireEnv('RELEASE_APP_TOKEN');
	git.raw(
		'push',
		'--force',
		`https://x-access-token:${token}@github.com/${input.gh.repository}.git`,
		`HEAD:refs/heads/${releaseBranch(input.line.branch)}`,
	);
	return { ok: true, version: generated.version };
}

/**
 * @param input - The release
 * @returns The Release PR body, with the markers the automation reads
 */
function releaseBody(input: {
	readonly line: ClassifiedLine;
	readonly version: string | null;
	readonly fingerprint: string;
	readonly promote: Promotion | null;
	readonly changes: readonly string[];
}): string {
	return [
		lineMarker(input.line.branch),
		`<!-- release-automation:fingerprint:${input.fingerprint} -->`,
		...(input.promote === null
			? []
			: [`<!-- release-automation:promote:${input.promote} -->`]),
		'',
		input.version === null
			? `Releases the changed packages of \`${input.line.branch}\`.`
			: `Releases v${input.version} from \`${input.line.branch}\`.`,
		'',
		'Merging this pull request publishes the release. It is generated and kept up to date automatically: do not push to it. After the first approval it is frozen; later changes go to the next Release PR.',
		'',
		'### Changes that reach users',
		'',
		...input.changes.map((change) => `- \`${change}\``),
		'',
	].join('\n');
}
