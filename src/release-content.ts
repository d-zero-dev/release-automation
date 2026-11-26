import { createHash } from 'node:crypto';

/**
 * A commit as `git log` reports it.
 * @example
 * const commit: Commit = { sha: 'abc', time: 1_764_000_000, subject: 'fix: x' };
 */
export interface Commit {
	readonly sha: string;
	/** Committer time, in seconds since the epoch. */
	readonly time: number;
	readonly subject: string;
}

/**
 * Read access to a repository. Paths are relative to its root.
 * @example
 * const git: Git = createGit(process.cwd());
 */
export interface Git {
	/** The tags that `ref` contains. */
	tags(ref: string): readonly string[];
	/** The files that differ between two revisions, under `path`. */
	diffNames(from: string, to: string, path: string): readonly string[];
	/** The content of a file at a revision, or `null` if it does not exist there. */
	show(rev: string, path: string): string | null;
	/** Every file at a revision, under `path`. */
	listFiles(rev: string, path: string): readonly string[];
	/** The first-parent commits in `from..to`, oldest first. */
	firstParents(from: string, to: string): readonly Commit[];
	/** The object id of a file at a revision, or `null` if it does not exist there. */
	blobId(rev: string, path: string): string | null;
}

/** The `package.json` fields whose change reaches a consumer. */
export const PACKAGE_FIELDS = [
	'dependencies',
	'peerDependencies',
	'peerDependenciesMeta',
	'optionalDependencies',
	'engines',
	'bin',
	'exports',
	'main',
	'module',
	'types',
	'type',
	'files',
] as const;

const NOT_SHIPPED_CONTENT = [
	/\.md$/i,
	/\.spec\.[cm]?[jt]sx?$/,
	/(?:^|\/)(?:__snapshots__|__mocks__|fixtures?|test)\//,
	/^\.(?:github|husky|claude|yarn|vscode)\//,
	/^(?:yarn\.lock|pnpm-lock\.yaml|package-lock\.json|\.yarnrc\.yml)$/,
];

/** Files npm puts in every tarball, whatever `files` says. */
const ALWAYS_SHIPPED = /^(?:package\.json|readme(?:\.[^/]*)?|licen[cs]e(?:\.[^/]*)?)$/i;

/**
 * What a line holds that reaches users and is not released yet.
 * @example
 * const content: ReleaseContent = { fingerprint: null, carriers: [], changes: [] };
 */
export interface ReleaseContent {
	/**
	 * A hash of the unreleased changes that reach users: the same changes give
	 * the same hash, whatever commits brought them. `null` when there are none.
	 */
	readonly fingerprint: string | null;
	/** The first-parent commits that brought in a counted change, oldest first. */
	readonly carriers: readonly Commit[];
	/** The counted changes, as `<package root>/<file>` or `<package root>/package.json#<field>.<key>`. */
	readonly changes: readonly string[];
}

/**
 * Compiles `.npmignore` lines with the `.gitignore` semantics npm applies: a
 * pattern without an inner slash matches a name at any depth, a trailing
 * slash matches a directory only, the last matching line wins.
 * @param source - The content of an `.npmignore`
 * @returns A predicate that tells whether a path relative to the package is left out of the tarball
 * @example
 * npmIgnore('src/\n')('src/a.ts'); // true
 */
export function npmIgnore(source: string): (path: string) => boolean {
	const rules: { negate: boolean; pattern: RegExp }[] = [];
	for (const raw of source.split('\n')) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) {
			continue;
		}
		const negate = line.startsWith('!');
		let body = negate ? line.slice(1) : line;
		const directoryOnly = body.endsWith('/');
		body = body.replace(/\/+$/, '');
		const anchored = body.includes('/');
		body = body.replace(/^\/+/, '');
		const glob = body
			.split('**')
			.map((part) =>
				part
					.split('*')
					.map((piece) => piece.replaceAll(/[.+^${}()|[\]\\?]/g, String.raw`\$&`))
					.join('[^/]*'),
			)
			.join('.*');
		const tail = directoryOnly ? '/.*' : '(?:/.*)?';
		rules.push({
			negate,
			pattern: new RegExp(`${anchored ? '^' : '(?:^|/)'}${glob}${tail}$`),
		});
	}
	return (path) => {
		let ignored = false;
		for (const rule of rules) {
			if (rule.pattern.test(path)) {
				ignored = !rule.negate;
			}
		}
		return ignored;
	};
}

/**
 * Lists the consumer-facing `package.json` fields that differ.
 * @param before - `package.json` at the older revision, or `null`
 * @param after - `package.json` at the newer revision, or `null`
 * @returns `package.json#<field>` for a changed scalar field,
 *   `package.json#<field>.<key>` for a changed entry of an object field
 * @example
 * manifestChanges('{"dependencies":{"a":"1"}}', '{"dependencies":{"a":"2"}}'); // ['package.json#dependencies.a']
 */
export function manifestChanges(before: string | null, after: string | null): string[] {
	const a = JSON.parse(before ?? '{}') as Record<string, unknown>;
	const b = JSON.parse(after ?? '{}') as Record<string, unknown>;
	const changes: string[] = [];
	for (const field of PACKAGE_FIELDS) {
		const x = a[field];
		const y = b[field];
		if (isRecord(x) || isRecord(y)) {
			const xs = isRecord(x) ? x : {};
			const ys = isRecord(y) ? y : {};
			for (const key of [
				...new Set([...Object.keys(xs), ...Object.keys(ys)]),
			].toSorted()) {
				if (JSON.stringify(xs[key]) !== JSON.stringify(ys[key])) {
					changes.push(`package.json#${field}.${key}`);
				}
			}
		} else if (JSON.stringify(x) !== JSON.stringify(y)) {
			changes.push(`package.json#${field}`);
		}
	}
	return changes;
}

/**
 * Finds what a line holds that reaches users since a baseline revision.
 *
 * What counts is decided per public package (or the root package when the
 * repository has no `packages/` directory):
 *
 * - A file `npm pack` ships (not matched by `.npmignore`), or a build input
 *   under `src/`, other than Markdown, specs and test data
 * - In `package.json`, the fields in {@link PACKAGE_FIELDS}
 *
 * A carrier is a first-parent commit of the branch that brought in a change
 * still present in the cumulative diff, so its date is when the change landed
 * on the branch, and the merge that brings a release back does not count.
 * @param git - Read access to the repository
 * @param baseline - The revision of the last release (a tag), or `null` before the first
 * @param head - The revision of the line's branch
 * @returns The release content
 * @example
 * releaseContent(git, 'v3.5.0', 'origin/v3').fingerprint;
 */
export function releaseContent(
	git: Git,
	baseline: string | null,
	head: string,
): ReleaseContent {
	const from = baseline ?? emptyTree();
	const packages = publicPackages(git, head);
	const cumulative = countedChanges(git, packages, from, head);
	if (cumulative.size === 0) {
		return { fingerprint: null, carriers: [], changes: [] };
	}
	const carriers =
		baseline === null
			? []
			: git.firstParents(baseline, head).filter((commit) => {
					const own = countedChanges(git, packages, `${commit.sha}^1`, commit.sha);
					return [...own].some((key) => cumulative.has(key));
				});
	const changes = [...cumulative].toSorted();
	const hash = createHash('sha256');
	for (const key of changes) {
		const [path, field] = key.split('#') as [string, string | undefined];
		hash.update(key);
		hash.update('\0');
		if (field === undefined) {
			hash.update(git.blobId(head, path) ?? 'deleted');
		} else {
			const [name, sub] = field.split('.') as [string, string | undefined];
			const manifest = JSON.parse(git.show(head, path) ?? '{}') as Record<
				string,
				unknown
			>;
			const value = manifest[name];
			hash.update(
				JSON.stringify(sub === undefined || !isRecord(value) ? value : value[sub]) ??
					'deleted',
			);
		}
		hash.update('\n');
	}
	return { fingerprint: hash.digest('hex'), carriers, changes };
}

/**
 * The id of git's empty tree, the baseline of a line with no release yet.
 * @returns The object id
 */
function emptyTree(): string {
	return '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
}

interface PublicPackage {
	readonly root: string;
	readonly ignored: (path: string) => boolean;
}

/**
 * @param git - Read access
 * @param rev - A revision
 * @returns The public packages at the revision
 */
function publicPackages(git: Git, rev: string): PublicPackage[] {
	const manifests = git
		.listFiles(rev, 'packages')
		.filter((file) => /^packages\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file));
	const candidates = manifests.length > 0 ? manifests : ['package.json'];
	return candidates.flatMap((file) => {
		const manifest = JSON.parse(git.show(rev, file) ?? '{}') as {
			name?: string;
			private?: boolean;
			files?: unknown;
		};
		if (manifest.private === true || !manifest.name) {
			return [];
		}
		const root = file === 'package.json' ? '' : file.slice(0, -'/package.json'.length);
		const prefix = root === '' ? '' : `${root}/`;
		if (Array.isArray(manifest.files)) {
			// `files` lists what ships; matching it is the inverse of an ignore list.
			const listed = npmIgnore(
				manifest.files
					.filter((entry): entry is string => typeof entry === 'string')
					.join('\n'),
			);
			return [
				{ root, ignored: (path: string) => !ALWAYS_SHIPPED.test(path) && !listed(path) },
			];
		}
		return [{ root, ignored: npmIgnore(git.show(rev, `${prefix}.npmignore`) ?? '') }];
	});
}

/**
 * @param git - Read access
 * @param packages - The public packages
 * @param from - The older revision
 * @param to - The newer revision
 * @returns The counted changes between two revisions
 */
function countedChanges(
	git: Git,
	packages: readonly PublicPackage[],
	from: string,
	to: string,
): Set<string> {
	const keys = new Set<string>();
	const scope = packages.some(({ root }) => root === '') ? '.' : 'packages';
	for (const file of git.diffNames(from, to, scope)) {
		const pkg = packages.find(({ root }) => root === '' || file.startsWith(`${root}/`));
		if (!pkg) {
			continue;
		}
		const prefix = pkg.root === '' ? '' : `${pkg.root}/`;
		const rel = file.slice(prefix.length);
		if (rel === 'package.json') {
			for (const change of manifestChanges(git.show(from, file), git.show(to, file))) {
				keys.add(`${prefix}${change}`);
			}
			continue;
		}
		if (NOT_SHIPPED_CONTENT.some((pattern) => pattern.test(rel))) {
			continue;
		}
		if (rel.startsWith('src/') || !pkg.ignored(rel)) {
			keys.add(`${prefix}${rel}`);
		}
	}
	return keys;
}

/**
 * @param value - Any value
 * @returns Whether it is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
