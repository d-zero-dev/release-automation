import type { ParsedCommit } from './conventional-commit.js';
import type { Version } from './semver.js';
import type { PrereleaseId } from './types.js';

import { countsForRelease } from './conventional-commit.js';
import { formatVersion, parseVersion } from './semver.js';
import { PRERELEASE_IDS } from './types.js';

/**
 * The stage a person asks a release to move to.
 * @example
 * const promote: Promotion = 'rc';
 */
export type Promotion = Exclude<PrereleaseId, 'alpha'> | 'stable';

/**
 * What decides the next version of a line.
 * @example
 * const input: NextVersionInput = {
 * 	current: '2.0.1-alpha.3',
 * 	commits: [{ type: 'fix', scope: null, breaking: false }],
 * 	promote: null,
 * 	lineMajor: 2,
 * };
 */
export interface NextVersionInput {
	/** The latest published version of the line. */
	readonly current: string;
	/** The commits since that version. */
	readonly commits: readonly ParsedCommit[];
	/** The stage a person asked for, or `null` to stay in the current stage. */
	readonly promote: Promotion | null;
	/** The major the line publishes. */
	readonly lineMajor: number;
}

/**
 * The result of {@link nextVersion}.
 * @example
 * const result: NextVersionResult = { ok: true, version: '2.0.1-alpha.4' };
 */
export type NextVersionResult =
	| { readonly ok: true; readonly version: string }
	| {
			readonly ok: false;
			readonly reason: 'nothing-to-release' | 'exceeds-line-major' | 'invalid-promotion';
			readonly message: string;
	  };

/**
 * Decides the next version of a line.
 *
 * - A prerelease stays in its stage and takes the next number. Moving to the
 *   next stage (alpha → beta → rc → stable) happens only when `promote`
 *   names that stage.
 * - A stable version takes a major bump for a breaking change (a minor bump
 *   in major 0), a minor bump for a feature, and a patch bump otherwise.
 * - A version above the major of the line is refused: whether to start a
 *   new major is a person's decision, not a commit's.
 * @param input - The current version, the commits and the requested stage
 * @returns The next version, or why there is none
 * @example
 * nextVersion({ current: '1.2.3', commits: [parseCommit('feat: add x')], promote: null, lineMajor: 1 });
 * // { ok: true, version: '1.3.0' }
 */
export function nextVersion(input: NextVersionInput): NextVersionResult {
	const current = parseVersion(input.current);
	const counted = input.commits.filter((commit) => countsForRelease(commit));

	if (current.pre !== null) {
		if (input.promote === null) {
			if (counted.length === 0) {
				return nothing();
			}
			return ok({ ...current, pre: { id: current.pre.id, n: current.pre.n + 1 } });
		}
		const from = PRERELEASE_IDS.indexOf(current.pre.id);
		const to =
			input.promote === 'stable'
				? PRERELEASE_IDS.length
				: PRERELEASE_IDS.indexOf(input.promote);
		if (to !== from + 1) {
			return {
				ok: false,
				reason: 'invalid-promotion',
				message: `${input.current} can move to ${PRERELEASE_IDS[from + 1] ?? 'stable'} only, not ${input.promote}`,
			};
		}
		return ok({
			...current,
			pre: input.promote === 'stable' ? null : { id: input.promote, n: 0 },
		});
	}

	if (input.promote !== null) {
		return {
			ok: false,
			reason: 'invalid-promotion',
			message: `${input.current} is stable; there is no stage to move to`,
		};
	}
	if (counted.length === 0) {
		return nothing();
	}
	const breaking = counted.some((commit) => commit.breaking);
	const feature = counted.some((commit) => commit.type === 'feat');
	const next: Version =
		breaking && current.major > 0
			? { major: current.major + 1, minor: 0, patch: 0, pre: null }
			: breaking || feature
				? { ...current, minor: current.minor + 1, patch: 0 }
				: { ...current, patch: current.patch + 1 };
	return ok(next);

	/**
	 * @param version - The candidate
	 * @returns The candidate, or a refusal when it leaves the line
	 */
	function ok(version: Version): NextVersionResult {
		if (version.major > input.lineMajor) {
			return {
				ok: false,
				reason: 'exceeds-line-major',
				message: `${formatVersion(version)} is above v${input.lineMajor}; a breaking change on this line needs a person's decision`,
			};
		}
		return { ok: true, version: formatVersion(version) };
	}

	/**
	 * @returns The result for no counted commits
	 */
	function nothing(): NextVersionResult {
		return {
			ok: false,
			reason: 'nothing-to-release',
			message: `No commit since ${input.current} counts toward a release`,
		};
	}
}
