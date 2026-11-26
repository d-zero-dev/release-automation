import { parse as parseYaml } from 'yaml';

import { fetchPackument } from '../io/npm.js';
import { blockerMarker, isBlocked, nightlyAction } from '../nightly.js';
import { eolIssues } from '../rotation.js';

import {
	BLOCKER_LABEL,
	classifiedLines,
	closeIssuesWith,
	ensureIssue,
	FULL_CI_WORKFLOW,
	github,
	localGit,
	summary,
} from './context.js';
import { nightlyRuns } from './runs.js';

/** How long a version stays behind the age gate. */
const AGE_GATE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Starts the Full CI of every line whose head has no successful run yet,
 * by `workflow_dispatch` on the line's branch. A success on the same commit
 * is reused; a failure is run again.
 * @param options - Flags
 * @param options.force - Run every line, reusing nothing
 * @example
 * await nightlyDispatchCommand({ force: false });
 */
export async function nightlyDispatchCommand(options: {
	readonly force: boolean;
}): Promise<void> {
	const git = localGit();
	const gh = github('GITHUB_TOKEN');
	const { lines } = classifiedLines(git, new Date());
	for (const line of lines) {
		const head = git.sha(`origin/${line.branch}`);
		const action = nightlyAction(head, await nightlyRuns(gh, line.branch), options.force);
		if (action === 'run') {
			await gh.rest(
				'POST',
				`/repos/{repo}/actions/workflows/${FULL_CI_WORKFLOW}/dispatches`,
				{
					ref: line.branch,
				},
			);
		}
		await summary(
			`${line.branch}: ${action === 'run' ? 'Full CI started' : `reused the success on ${head}`}`,
		);
	}
}

/**
 * Brings the Issues in line with the state of the lines: a `release-blocker`
 * Issue for each line whose newest Nightly failed (closed again by the
 * automation once one passes), the end-of-support Issues that are due, and
 * an Issue for each age gate exception that is no longer needed.
 * @example
 * await nightlyReportCommand();
 */
export async function nightlyReportCommand(): Promise<void> {
	const now = new Date();
	const git = localGit();
	const gh = github('GITHUB_TOKEN');
	const { lines } = classifiedLines(git, now);

	for (const line of lines) {
		const runs = await nightlyRuns(gh, line.branch);
		const marker = blockerMarker(line.branch);
		if (isBlocked(runs)) {
			const opened = await ensureIssue(
				gh,
				{
					marker,
					title: `Nightly of ${line.branch} fails: new Release PRs of the line are stopped`,
					body: `${marker}\n\nThe newest Full CI run of the Nightly on \`${line.branch}\` (${runs[0]?.sha ?? ''}) failed. No new Release PR of the line opens until a Nightly passes again; open Release PRs can still merge with their own Full CI.\n\nClosing this Issue does not lift the stop. Fix the failure, then run the Nightly again (by hand or on schedule).\n`,
				},
				[BLOCKER_LABEL],
			);
			await summary(`${line.branch}: blocked${opened ? ' (Issue opened)' : ''}`);
		} else {
			const closed = await closeIssuesWith(
				gh,
				marker,
				`The Nightly of \`${line.branch}\` passed again on ${runs[0]?.sha ?? ''}; Release PRs of the line resume.`,
			);
			if (closed > 0) {
				await summary(`${line.branch}: unblocked`);
			}
		}
	}

	for (const issue of eolIssues(lines, now)) {
		await ensureIssue(gh, issue, []);
	}

	const yarnrc = git.show('origin/dev', '.yarnrc.yml');
	const approved =
		yarnrc === null
			? []
			: ((parseYaml(yarnrc) as { npmPreapprovedPackages?: unknown })
					.npmPreapprovedPackages ?? []);
	for (const entry of Array.isArray(approved) ? approved : []) {
		const match = typeof entry === 'string' ? /^(@?[^@]+)@(\d[^\s]*)$/.exec(entry) : null;
		if (!match?.[1] || !match[2]) {
			continue;
		}
		const packument = await fetchPackument(match[1]);
		const published = packument?.times[match[2]];
		if (
			published !== undefined &&
			now.getTime() - new Date(published).getTime() >= AGE_GATE_MS
		) {
			const marker = `<!-- release-automation:age-gate:${entry} -->`;
			await ensureIssue(
				gh,
				{
					marker,
					title: `Remove the age gate exception for ${entry}`,
					body: `${marker}\n\n\`${entry}\` was published more than three days ago, so the age gate no longer holds it back. Remove it from \`npmPreapprovedPackages\` in \`.yarnrc.yml\`, check the lockfile, and pass the required CI.\n`,
				},
				[],
			);
		}
	}
}

/**
 * Turns the output of `yarn npm audit --json` on a line into an Issue, or
 * closes the line's audit Issue when the audit is clean.
 * @param options - The line and the audit output
 * @param options.line - The branch the audit ran on
 * @param options.output - The audit output (one JSON object per line)
 * @example
 * await auditReportCommand({ line: 'v3', output: readFileSync('audit.json', 'utf8') });
 */
export async function auditReportCommand(options: {
	readonly line: string;
	readonly output: string;
}): Promise<void> {
	const gh = github('GITHUB_TOKEN');
	const findings = options.output
		.split('\n')
		.filter((text) => text.trim().startsWith('{'))
		.map(
			(text) =>
				JSON.parse(text) as {
					value?: string;
					children?: Record<string, string | undefined>;
				},
		)
		.filter((finding) => finding.value !== undefined);
	const marker = `<!-- release-automation:audit:${options.line} -->`;
	if (findings.length === 0) {
		await closeIssuesWith(gh, marker, `The audit of \`${options.line}\` is clean.`);
		return;
	}
	await ensureIssue(
		gh,
		{
			marker,
			title: `Vulnerable dependencies on ${options.line}`,
			body: [
				marker,
				'',
				`The dependency audit of \`${options.line}\` found:`,
				'',
				...findings.map(
					(finding) =>
						`- \`${finding.value}\`: ${finding.children?.['Issue'] ?? ''} (${finding.children?.['Severity'] ?? ''}) ${finding.children?.['URL'] ?? ''}`,
				),
				'',
				'Fix them on the line (a vulnerability fix PR, `resolutions`, or the age gate exception of the repository policy), then this Issue closes after a clean audit.',
				'',
			].join('\n'),
		},
		[],
	);
}
