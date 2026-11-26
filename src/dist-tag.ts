import type { LineRole } from './types.js';

import { parseVersion } from './semver.js';

/**
 * What decides the dist-tag of a release.
 * @example
 * const input: DistTagInput = {
 * 	version: '3.5.1',
 * 	role: 'previous',
 * 	independent: false,
 * 	successorStablePublished: true,
 * 	latestOnRegistry: '4.2.0',
 * };
 */
export interface DistTagInput {
	/** The version being published. */
	readonly version: string;
	/** The role of the line it is published from. */
	readonly role: LineRole;
	/** Whether the repository is in Lerna independent mode. */
	readonly independent: boolean;
	/** Whether a later major has a stable release. */
	readonly successorStablePublished: boolean;
	/** The version `latest` points at on the registry, or `null` when the package is new. */
	readonly latestOnRegistry: string | null;
}

/**
 * Decides the dist-tag of a release: `alpha`, `beta` and `rc` for those
 * prereleases, `latest` for a stable release of the current line, and
 * `v<major>` for a stable release of a previous line once a later major is
 * stable. `next` is never used.
 * @param input - The release
 * @returns The dist-tag
 * @throws {Error} For a version that is not valid, an unknown prerelease
 *   identifier, a stable release on the next-major line, and a release that
 *   would move `latest` to an older major
 * @example
 * distTag({ version: '4.0.0-beta.2', role: 'current', independent: false, successorStablePublished: false, latestOnRegistry: '3.5.0' }); // 'beta'
 * distTag({ version: '3.5.1', role: 'previous', independent: false, successorStablePublished: true, latestOnRegistry: '4.2.0' }); // 'v3'
 */
export function distTag(input: DistTagInput): string {
	const version = parseVersion(input.version);
	if (version.pre !== null) {
		return version.pre.id;
	}
	if (input.independent || input.role === 'current') {
		const latest =
			input.latestOnRegistry === null ? null : parseVersion(input.latestOnRegistry);
		if (!input.independent && latest !== null && latest.major > version.major) {
			throw new Error(
				`${input.version} would move latest from ${input.latestOnRegistry} to an older major`,
			);
		}
		return 'latest';
	}
	if (input.role === 'next') {
		throw new Error(
			`${input.version}: the next-major line publishes prereleases only; its stable release is published from main`,
		);
	}
	return input.successorStablePublished ? `v${version.major}` : 'latest';
}
