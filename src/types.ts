/**
 * The role of a release line.
 *
 * - `current`: developed on `dev` and published from `main`
 * - `next`: the next major, developed and published on its own `v<major>` branch
 * - `previous`: an older major, maintained and published on its own `v<major>` branch
 * @example
 * const role: LineRole = 'current';
 */
export type LineRole = 'current' | 'next' | 'previous';

/**
 * One entry of `.github/release-lines.json`.
 * @example
 * const line: LineEntry = { branch: 'v3', role: 'previous' };
 */
export interface LineEntry {
	/** The branch pull requests and Renovate target. */
	readonly branch: string;
	readonly role: LineRole;
	/**
	 * For a previous line: the date (`YYYY-MM-DD`) of the first stable release
	 * of a later major, which starts the support period. Without it, the date
	 * of the first `vX.Y.Z` tag of a later major is used.
	 */
	readonly successorStable?: string;
}

/**
 * The content of `.github/release-lines.json`: the single definition of a
 * repository's release lines and the values a person decides for it.
 * @example
 * const file: LinesFile = {
 * 	lines: [
 * 		{ branch: 'dev', role: 'current' },
 * 		{ branch: 'v3', role: 'previous' },
 * 	],
 * };
 */
export interface LinesFile {
	readonly lines: readonly LineEntry[];
	/** Months a previous line is supported after its successor's first stable release. */
	readonly supportMonths?: number;
	/** Minutes security fixes are gathered before a Release PR is opened. */
	readonly securityBatchMinutes?: number;
	/** The command that publishes, overriding the default of the publishing mode. */
	readonly publishCommand?: string;
}

/** The default of {@link LinesFile.supportMonths}. */
export const DEFAULT_SUPPORT_MONTHS = 12;

/** The default of {@link LinesFile.securityBatchMinutes}. */
export const DEFAULT_SECURITY_BATCH_MINUTES = 60;

/** The branch the `current` line is published from. */
export const CURRENT_PUBLISH_BRANCH = 'main';

/** The branch the `current` line is developed on. */
export const CURRENT_BRANCH = 'dev';

/**
 * How a repository publishes.
 *
 * - `lerna-fixed` / `lerna-independent`: Lerna, by `lerna.json#version`
 * - `npm-single`: one package at the repository root
 * - `custom`: no npm package; the line file names the command
 * @example
 * const mode: PublishMode = 'lerna-fixed';
 */
export type PublishMode = 'lerna-fixed' | 'lerna-independent' | 'npm-single' | 'custom';

/**
 * The review mode, decided by the number of code owners.
 * @example
 * const mode: ReviewMode = 'solo';
 */
export type ReviewMode = 'collaborative' | 'solo';

/**
 * The prerelease identifiers a version may carry.
 * @example
 * PRERELEASE_IDS.includes('beta'); // true
 */
export const PRERELEASE_IDS = ['alpha', 'beta', 'rc'] as const;

/**
 * One of {@link PRERELEASE_IDS}.
 * @example
 * const id: PrereleaseId = 'rc';
 */
export type PrereleaseId = (typeof PRERELEASE_IDS)[number];

/**
 * What a previous line accepts at a point in time.
 *
 * - `fixes`: bug fixes and security fixes (the successor has no stable release yet)
 * - `security`: security fixes only (the successor is stable, the support period runs)
 * - `ended`: the support period is over
 * @example
 * const phase: MaintenancePhase = 'security';
 */
export type MaintenancePhase = 'fixes' | 'security' | 'ended';
