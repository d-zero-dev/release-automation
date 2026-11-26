import type { ClassifiedLine } from '../classify.js';
import type { GitHub } from '../io/github.js';
import type { LocalGit } from '../io/git.js';

import { classify } from '../classify.js';
import { createGit } from '../io/git.js';
import { createGitHub } from '../io/github.js';
import { readFacts } from '../io/repo.js';

/** The label of Release PRs. */
export const RELEASE_LABEL = 'release';

/** The label of a Release PR closed because a successor replaced it. */
export const REPLACED_LABEL = 'release-replaced';

/** The label of the Issues that stop Release PRs of a line. */
export const BLOCKER_LABEL = 'release-blocker';

/** The name of the check that verifies a Release PR. */
export const VERIFY_CHECK = 'release-pr-verified';

/** The file name of the Full CI workflow the Nightly dispatches. */
export const FULL_CI_WORKFLOW = 'full-ci.yml';

/**
 * Reads an environment variable that must be set.
 * @param name - The variable
 * @returns Its value
 * @throws {Error} When it is not set
 * @example
 * requireEnv('GITHUB_REPOSITORY');
 */
export function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === '') {
		throw new Error(`${name} is not set`);
	}
	return value;
}

/**
 * Git access for the working directory.
 * @returns The access
 * @example
 * const git = localGit();
 */
export function localGit(): LocalGit {
	return createGit(process.cwd());
}

/**
 * A GitHub client authenticated with the token in an environment variable.
 * @param tokenVariable - The variable that holds the token
 * @returns The client for `GITHUB_REPOSITORY`
 * @example
 * const gh = github('RELEASE_APP_TOKEN');
 */
export function github(tokenVariable: string): GitHub {
	return createGitHub({
		token: requireEnv(tokenVariable),
		repository: requireEnv('GITHUB_REPOSITORY'),
	});
}

/**
 * Classifies the repository and refuses to go on while it has errors.
 * @param git - Git access
 * @param now - The current time
 * @param rev - The revision the definition is read from; `origin/dev` by default
 * @returns The lines and the review mode
 * @throws {Error} When the classification has errors
 * @example
 * const { lines } = classifiedLines(git, new Date());
 */
export function classifiedLines(
	git: LocalGit,
	now: Date,
	rev?: string,
): { lines: readonly ClassifiedLine[]; collaborative: boolean } {
	const result = classify(readFacts(git, now, rev));
	if (result.errors.length > 0) {
		throw new Error(
			`The repository does not follow the rules yet:\n${result.errors.map((e) => `- ${e.message}`).join('\n')}`,
		);
	}
	return { lines: result.lines, collaborative: result.review?.mode === 'collaborative' };
}

/**
 * An Issue as the API returns it.
 * @example
 * const issue: Issue = { number: 1, body: '', state: 'open', labels: [] };
 */
export interface Issue {
	readonly number: number;
	readonly body: string | null;
	readonly state: string;
	readonly labels: readonly { readonly name: string }[];
	readonly pull_request?: unknown;
}

/**
 * Finds the open Issues whose body holds a marker.
 * @param gh - The client
 * @param marker - The marker
 * @returns The Issues
 * @example
 * await openIssuesWith(gh, '<!-- release-blocker:dev -->');
 */
export async function openIssuesWith(gh: GitHub, marker: string): Promise<Issue[]> {
	const issues = await gh.paginate<Issue>('/repos/{repo}/issues?state=open');
	return issues.filter(
		(issue) => issue.pull_request === undefined && (issue.body ?? '').includes(marker),
	);
}

/**
 * Opens an Issue unless one with the same marker is open.
 * @param gh - The client
 * @param issue - The Issue
 * @param issue.marker - The marker the body starts with
 * @param issue.title - The title
 * @param issue.body - The body
 * @param labels - Labels to add
 * @returns Whether an Issue was opened
 * @example
 * await ensureIssue(gh, rotationIssue(...), []);
 */
export async function ensureIssue(
	gh: GitHub,
	issue: { readonly marker: string; readonly title: string; readonly body: string },
	labels: readonly string[],
): Promise<boolean> {
	const open = await openIssuesWith(gh, issue.marker);
	if (open.length > 0) {
		return false;
	}
	await gh.rest('POST', '/repos/{repo}/issues', {
		title: issue.title,
		body: issue.body,
		labels,
	});
	return true;
}

/**
 * Closes the open Issues with a marker.
 * @param gh - The client
 * @param marker - The marker
 * @param comment - The comment left on each
 * @returns The number of Issues closed
 * @example
 * await closeIssuesWith(gh, blockerMarker('dev'), 'The Nightly passed again.');
 */
export async function closeIssuesWith(
	gh: GitHub,
	marker: string,
	comment: string,
): Promise<number> {
	const issues = await openIssuesWith(gh, marker);
	for (const issue of issues) {
		await gh.rest('POST', `/repos/{repo}/issues/${issue.number}/comments`, {
			body: comment,
		});
		await gh.rest('PATCH', `/repos/{repo}/issues/${issue.number}`, { state: 'closed' });
	}
	return issues.length;
}

/**
 * Writes a line to the job summary when running in GitHub Actions, and to
 * standard output always.
 * @param text - The text
 * @example
 * summary('dev: Release PR opened');
 */
export async function summary(text: string): Promise<void> {
	// oxlint-disable-next-line no-console -- the CLI reports to its caller
	console.log(text);
	const file = process.env['GITHUB_STEP_SUMMARY'];
	if (file) {
		const { appendFile } = await import('node:fs/promises');
		await appendFile(file, `${text}\n`);
	}
}
