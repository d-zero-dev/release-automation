import type { LinesFile } from './types.js';

import { parseCommit } from './conventional-commit.js';
import { CURRENT_PUBLISH_BRANCH } from './types.js';

/**
 * The branches a local commit must not land on: every line branch and
 * `main`. They change only through pull requests (and the publishing App's
 * push of a release back to `dev`, which happens on GitHub, not locally).
 * @param lines - The lines file
 * @returns The guarded branch names
 * @example
 * guardedBranches({ lines: [{ branch: 'dev', role: 'current' }, { branch: 'v3', role: 'previous' }] });
 * // ['dev', 'main', 'v3']
 */
export function guardedBranches(lines: LinesFile): string[] {
	return [
		...new Set([
			...lines.lines.map(({ branch }) => branch),
			...(lines.lines.some(({ role }) => role === 'current')
				? [CURRENT_PUBLISH_BRANCH]
				: []),
		]),
	];
}

/**
 * Tells whether a commit message may land on a branch. A breaking change is
 * refused on a previous line, and on the current line once it is stable at
 * major 1 or above, because it would make the Release PR propose the next
 * major. The next-major line and a current line in a prerelease or at
 * major 0 accept it.
 *
 * A local hook cannot know where a topic branch will be merged, so this runs
 * in CI on the commits of a pull request, with its target branch.
 * @param input - The message, the target branch, and the current line's version
 * @param input.message - The commit message
 * @param input.target - The branch the pull request merges into
 * @param input.currentVersion - The version on `dev`; `null` in Lerna independent mode
 * @param input.lines - The lines file
 * @returns `null` when it may land, the reason otherwise
 * @example
 * commitMessageError({ message: 'feat!: x', target: 'dev', currentVersion: '2.1.0', lines }); // the reason
 */
export function commitMessageError(input: {
	readonly message: string;
	readonly target: string;
	readonly currentVersion: string | null;
	readonly lines: LinesFile;
}): string | null {
	if (!parseCommit(input.message).breaking) {
		return null;
	}
	const target = input.target;
	const line = input.lines.lines.find(({ branch }) => branch === target);
	if (line === undefined || line.role === 'next') {
		return null;
	}
	if (line.role === 'previous') {
		return `A breaking change cannot land on ${target}: a previous line takes fixes only`;
	}
	const version = input.currentVersion;
	if (version === null || version.includes('-') || version.startsWith('0.')) {
		return null;
	}
	return `A breaking change cannot land on ${target} while it is stable (${version}): start the next major on a v<major> branch`;
}
