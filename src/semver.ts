import type { PrereleaseId } from './types.js';

import { PRERELEASE_IDS } from './types.js';

/**
 * A parsed version in the shape release lines use: `X.Y.Z` or
 * `X.Y.Z-<id>.<n>` with `<id>` one of `alpha`, `beta`, `rc`.
 * @example
 * const v: Version = { major: 1, minor: 2, patch: 3, pre: { id: 'beta', n: 0 } };
 */
export interface Version {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly pre: { readonly id: PrereleaseId; readonly n: number } | null;
}

const VERSION =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)(?:\.(0|[1-9]\d*))?)?$/;

/**
 * Parses a version. Anything outside the shape release lines use (build
 * metadata, unknown prerelease identifiers, a prerelease without a number
 * other than a bare identifier) is rejected, because the dist-tag and the
 * next version cannot be decided for it.
 * @param text - The version, without a leading `v`
 * @returns The parsed version
 * @throws {Error} When the text is not such a version
 * @example
 * parseVersion('2.0.1-alpha.3'); // { major: 2, minor: 0, patch: 1, pre: { id: 'alpha', n: 3 } }
 */
export function parseVersion(text: string): Version {
	const match = VERSION.exec(text);
	if (!match) {
		throw new Error(`Not a valid version: ${text}`);
	}
	const [, major, minor, patch, id, n] = match;
	if (id === undefined) {
		return {
			major: Number(major),
			minor: Number(minor),
			patch: Number(patch),
			pre: null,
		};
	}
	if (!(PRERELEASE_IDS as readonly string[]).includes(id)) {
		throw new Error(`Unknown prerelease identifier "${id}" in ${text}`);
	}
	return {
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
		pre: { id: id as PrereleaseId, n: n === undefined ? 0 : Number(n) },
	};
}

/**
 * Formats a version.
 * @param version - The version
 * @returns `X.Y.Z` or `X.Y.Z-<id>.<n>`
 * @example
 * formatVersion({ major: 1, minor: 0, patch: 0, pre: null }); // '1.0.0'
 */
export function formatVersion(version: Version): string {
	const core = `${version.major}.${version.minor}.${version.patch}`;
	return version.pre ? `${core}-${version.pre.id}.${version.pre.n}` : core;
}

/**
 * Compares two versions by SemVer precedence.
 * @param a - A version
 * @param b - Another version
 * @returns Negative when `a` is lower, positive when higher, `0` when equal
 * @example
 * compareVersions(parseVersion('1.0.0-rc.1'), parseVersion('1.0.0')); // negative
 */
export function compareVersions(a: Version, b: Version): number {
	const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
	if (core !== 0) {
		return core;
	}
	if (a.pre === null || b.pre === null) {
		return (a.pre === null ? 1 : 0) - (b.pre === null ? 1 : 0);
	}
	return (
		PRERELEASE_IDS.indexOf(a.pre.id) - PRERELEASE_IDS.indexOf(b.pre.id) ||
		a.pre.n - b.pre.n
	);
}

/**
 * Parses a `v<version>` tag of a stable release.
 * @param tag - A tag name
 * @returns The version, or `null` when the tag is not `vX.Y.Z`
 * @example
 * stableTagVersion('v3.5.0'); // { major: 3, minor: 5, patch: 0, pre: null }
 * stableTagVersion('v4.0.0-alpha.1'); // null
 */
export function stableTagVersion(tag: string): Version | null {
	const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
	if (!match?.[1]) {
		return null;
	}
	try {
		return parseVersion(match[1]);
	} catch {
		return null;
	}
}
