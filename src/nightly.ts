/**
 * A finished Full CI run of the Nightly for one line.
 * @example
 * const run: NightlyRun = { sha: 'abc', conclusion: 'success', finishedAt: new Date() };
 */
export interface NightlyRun {
	/** The commit the run tested. */
	readonly sha: string;
	readonly conclusion: 'success' | 'failure';
	readonly finishedAt: Date;
}

/**
 * Decides whether the Nightly runs the Full CI of a line, or reuses the
 * last result: a success on the same commit is reused, a failure is tested
 * again, a new commit is always tested.
 * @param headSha - The head of the line's branch
 * @param runs - The finished runs of the line, newest first
 * @param force - Whether a person asked to run anyway
 * @returns `run` or `reuse`
 * @example
 * nightlyAction('abc', [{ sha: 'abc', conclusion: 'success', finishedAt: new Date() }], false); // 'reuse'
 */
export function nightlyAction(
	headSha: string,
	runs: readonly NightlyRun[],
	force: boolean,
): 'run' | 'reuse' {
	const last = runs[0];
	if (force || last === undefined) {
		return 'run';
	}
	return last.sha === headSha && last.conclusion === 'success' ? 'reuse' : 'run';
}

/**
 * Tells whether a line is blocked by its Nightly: the newest finished run
 * failed. Only a later success clears it, whether it ran on schedule or by
 * hand; the state of the Issue does not count.
 * @param runs - The finished runs of the line, newest first
 * @returns Whether new Release PRs of the line are stopped
 * @example
 * isBlocked([{ sha: 'abc', conclusion: 'failure', finishedAt: new Date() }]); // true
 */
export function isBlocked(runs: readonly NightlyRun[]): boolean {
	return runs[0]?.conclusion === 'failure';
}

/** How long without a finished Nightly before it counts as stopped. */
export const NIGHTLY_STALE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Tells whether the Nightly of a line stopped running (rule 35). GitHub
 * disables the schedule of a public repository after 60 days without
 * activity, and a stopped Nightly would leave the gate on stale results.
 * The time counts from the newest finished run; when the line has none, from
 * when the Nightly workflow was added, so a Nightly set up a moment ago is not
 * taken as stopped while one that never ran is.
 * @param runs - The finished runs of the line, newest first
 * @param now - The current time
 * @param since - When the Nightly workflow was added; without it, a line with no run counts as stopped
 * @returns Whether more than {@link NIGHTLY_STALE_MS} passed since the newest run, or since `since` when there is no run
 * @example
 * isStale([], new Date('2026-11-27T12:00:00Z'), new Date('2026-11-27T00:00:00Z')); // false
 */
export function isStale(runs: readonly NightlyRun[], now: Date, since?: Date): boolean {
	const from = runs[0]?.finishedAt ?? since;
	return from === undefined || now.getTime() - from.getTime() > NIGHTLY_STALE_MS;
}

/**
 * The marker that identifies the `release-blocker` Issue of a line.
 * @param branch - The branch of the line
 * @returns An HTML comment placed at the top of the Issue body
 * @example
 * blockerMarker('v3'); // '<!-- release-blocker:v3 -->'
 */
export function blockerMarker(branch: string): string {
	return `<!-- release-blocker:${branch} -->`;
}
