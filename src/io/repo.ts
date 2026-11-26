import type { RepoFacts } from '../classify.js';
import type { LinesFile, PublishMode } from '../types.js';
import type { LocalGit } from './git.js';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { CURRENT_BRANCH } from '../types.js';

/** Where the lines file lives in a repository. */
export const LINES_FILE = '.github/release-lines.json';

/**
 * Parses and validates a lines file.
 * @param text - The file content
 * @returns The lines file
 * @throws {Error} When the content does not have the shape of a lines file
 * @example
 * parseLinesFile('{"lines":[{"branch":"dev","role":"current"}]}');
 */
export function parseLinesFile(text: string): LinesFile {
	const data = JSON.parse(text) as Partial<LinesFile>;
	if (!Array.isArray(data.lines)) {
		throw new TypeError(`${LINES_FILE}: "lines" must be an array`);
	}
	for (const line of data.lines) {
		if (
			typeof line.branch !== 'string' ||
			!['current', 'next', 'previous'].includes(line.role)
		) {
			throw new TypeError(
				`${LINES_FILE}: each line needs "branch" and a "role" of current, next or previous`,
			);
		}
	}
	for (const key of ['supportMonths', 'securityBatchMinutes'] as const) {
		const value = data[key];
		if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
			throw new TypeError(`${LINES_FILE}: "${key}" must be a positive integer`);
		}
	}
	if (data.publishCommand !== undefined && typeof data.publishCommand !== 'string') {
		throw new TypeError(`${LINES_FILE}: "publishCommand" must be a string`);
	}
	return data as LinesFile;
}

/**
 * Reads a file of the checkout at a revision, or from the working tree.
 * @param git - Git access
 * @param file - The path in the repository
 * @param rev - The revision; `null` for the working tree
 * @returns The content, or `null`
 */
function read(git: LocalGit, file: string, rev: string | null): string | null {
	if (rev !== null) {
		return git.show(rev, file);
	}
	const full = path.join(git.cwd, file);
	return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/**
 * @param git - Git access
 * @param rev - The revision; `null` for the working tree
 * @returns The lines file, or `null` when there is none
 * @example
 * readLinesFile(git, 'origin/dev');
 */
export function readLinesFile(git: LocalGit, rev: string | null): LinesFile | null {
	const text = read(git, LINES_FILE, rev);
	return text === null ? null : parseLinesFile(text);
}

/**
 * Lists the owners `.github/CODEOWNERS` names.
 * @param text - The file content
 * @returns The `@user` and `@org/team` owners, without duplicates
 * @example
 * parseCodeowners('* @alice @bob\n'); // ['@alice', '@bob']
 */
export function parseCodeowners(text: string): string[] {
	const owners = text
		.split('\n')
		.map((line) => line.replace(/#.*/, '').trim())
		.filter((line) => line !== '')
		.flatMap((line) => line.split(/\s+/).slice(1))
		.filter((token) => token.startsWith('@'));
	return [...new Set(owners)];
}

/**
 * A package the repository publishes.
 * @example
 * const pkg: PublicPackage = { name: '@d-zero/roar', version: '2.3.1', dir: 'packages/@d-zero/roar' };
 */
export interface PublicPackage {
	readonly name: string;
	readonly version: string;
	readonly dir: string;
}

/**
 * Lists the public packages at a revision: the non-private workspaces, or the
 * root package when it is not private and has no workspaces.
 * @param git - Git access
 * @param rev - The revision
 * @returns The packages
 * @example
 * publicPackages(git, 'origin/main');
 */
export function publicPackages(git: LocalGit, rev: string): PublicPackage[] {
	const manifests = git
		.listFiles(rev, 'packages')
		.filter((file) => /^packages\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file));
	const candidates = manifests.length > 0 ? manifests : ['package.json'];
	return candidates.flatMap((file) => {
		const manifest = JSON.parse(git.show(rev, file) ?? '{}') as {
			name?: string;
			version?: string;
			private?: boolean;
		};
		if (manifest.private === true || !manifest.name || !manifest.version) {
			return [];
		}
		return [
			{ name: manifest.name, version: manifest.version, dir: path.posix.dirname(file) },
		];
	});
}

/**
 * The version a line states at a revision: `lerna.json#version`, or the root
 * `package.json#version` without Lerna. `null` in Lerna independent mode.
 * @param git - Git access
 * @param rev - The revision
 * @returns The version
 * @example
 * versionAt(git, 'origin/dev'); // '5.4.2'
 */
export function versionAt(git: LocalGit, rev: string): string | null {
	const lerna = git.show(rev, 'lerna.json');
	if (lerna !== null) {
		const version = (JSON.parse(lerna) as { version?: string }).version ?? null;
		return version === 'independent' ? null : version;
	}
	return (
		(JSON.parse(git.show(rev, 'package.json') ?? '{}') as { version?: string }).version ??
		null
	);
}

/**
 * @param git - Git access
 * @param rev - The revision
 * @returns The publishing mode at the revision
 * @example
 * publishModeAt(git, 'origin/dev'); // 'lerna-fixed'
 */
export function publishModeAt(git: LocalGit, rev: string): PublishMode {
	const lerna = git.show(rev, 'lerna.json');
	if (lerna !== null) {
		return (JSON.parse(lerna) as { version?: string }).version === 'independent'
			? 'lerna-independent'
			: 'lerna-fixed';
	}
	const root = JSON.parse(git.show(rev, 'package.json') ?? '{}') as { private?: boolean };
	return root.private === true ? 'custom' : 'npm-single';
}

/**
 * Reads the facts `classify` decides on, from the remote refs and `dev`.
 * The caller fetches the branches and tags first.
 * @param git - Git access
 * @param now - The current time
 * @returns The facts
 * @example
 * classify(readFacts(git, new Date()));
 */
export function readFacts(git: LocalGit, now: Date): RepoFacts {
	const rev = `origin/${CURRENT_BRANCH}`;
	const lerna = git.show(rev, 'lerna.json');
	const root = JSON.parse(git.show(rev, 'package.json') ?? '{}') as {
		private?: boolean;
		packageManager?: string;
	};
	const codeowners = git.show(rev, '.github/CODEOWNERS');
	return {
		devVersion: versionAt(git, rev),
		lernaVersion:
			lerna === null
				? null
				: ((JSON.parse(lerna) as { version?: string }).version ?? null),
		rootPrivate: root.private === true,
		packageManager: root.packageManager ?? null,
		branches: git.remoteBranches(),
		stableTags: git.tagsWithDates().filter(({ tag }) => /^v\d+\.\d+\.\d+$/.test(tag)),
		codeowners: codeowners === null ? null : parseCodeowners(codeowners),
		linesFile: readLinesFile(git, rev),
		now,
	};
}
