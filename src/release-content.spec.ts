import type { Commit, Git } from './release-content.js';

import { describe, expect, test } from 'vitest';

import { manifestChanges, npmIgnore, releaseContent } from './release-content.js';

type Tree = Readonly<Record<string, string>>;

/**
 * A repository of snapshots: each commit is a whole tree, the first parent
 * of each commit is the one before it.
 * @param snapshots - The commits, oldest first
 * @returns Read access to them
 */
function fakeGit(
	snapshots: readonly { sha: string; time: number; subject: string; tree: Tree }[],
): Git {
	const tree = (rev: string): Tree => {
		const [sha, parent] = rev.split('^');
		const index = snapshots.findIndex((snapshot) => snapshot.sha === sha);
		const at = parent === undefined ? index : index - 1;
		return at < 0 ? {} : (snapshots[at]?.tree ?? {});
	};
	const position = (sha: string) =>
		snapshots.findIndex((snapshot) => snapshot.sha === sha);
	return {
		tags: () => [],
		diffNames: (from, to, path) => {
			const a = tree(from);
			const b = tree(to);
			return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
				(file) => (path === '.' || file.startsWith(`${path}/`)) && a[file] !== b[file],
			);
		},
		show: (rev, path) => tree(rev)[path] ?? null,
		listFiles: (rev, path) =>
			Object.keys(tree(rev)).filter((file) => file.startsWith(`${path}/`)),
		firstParents: (from, to): Commit[] =>
			snapshots
				.slice(position(from) + 1, position(to) + 1)
				.map(({ sha, time, subject }) => ({ sha, time, subject })),
		blobId: (rev, path) => tree(rev)[path] ?? null,
	};
}

const pkg = (fields: object) => JSON.stringify({ name: '@x/a', ...fields });

describe('releaseContent', () => {
	const v1: Tree = {
		'packages/a/package.json': pkg({ version: '1.0.0', files: ['dist'] }),
		'packages/a/src/index.ts': 'one',
		'packages/a/README.md': 'readme',
		'yarn.lock': 'lock',
	};

	test('a source change counts; docs, lockfile and version bumps do not', () => {
		const git = fakeGit([
			{ sha: 'r', time: 0, subject: 'chore(release): v1.0.0', tree: v1 },
			{
				sha: 'a',
				time: 10,
				subject: 'docs: readme',
				tree: { ...v1, 'packages/a/README.md': 'more' },
			},
			{
				sha: 'b',
				time: 20,
				subject: 'chore: lock',
				tree: { ...v1, 'packages/a/README.md': 'more', 'yarn.lock': 'new' },
			},
		]);
		expect(releaseContent(git, 'r', 'b')).toEqual({
			fingerprint: null,
			carriers: [],
			changes: [],
		});

		const withSource = fakeGit([
			{ sha: 'r', time: 0, subject: 'chore(release): v1.0.0', tree: v1 },
			{
				sha: 'a',
				time: 10,
				subject: 'docs: readme',
				tree: { ...v1, 'packages/a/README.md': 'more' },
			},
			{
				sha: 'b',
				time: 20,
				subject: 'fix: x',
				tree: { ...v1, 'packages/a/README.md': 'more', 'packages/a/src/index.ts': 'two' },
			},
		]);
		const content = releaseContent(withSource, 'r', 'b');
		expect(content.changes).toEqual(['packages/a/src/index.ts']);
		expect(content.carriers.map(({ sha }) => sha)).toEqual(['b']);
		expect(content.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	test('the same changes give the same fingerprint, whatever commits brought them', () => {
		const target = { ...v1, 'packages/a/src/index.ts': 'two' };
		const once = fakeGit([
			{ sha: 'r', time: 0, subject: 'r', tree: v1 },
			{ sha: 'a', time: 10, subject: 'fix: x', tree: target },
		]);
		const twice = fakeGit([
			{ sha: 'r', time: 0, subject: 'r', tree: v1 },
			{
				sha: 'a',
				time: 10,
				subject: 'fix: x',
				tree: { ...v1, 'packages/a/src/index.ts': 'half' },
			},
			{ sha: 'b', time: 20, subject: 'fix: y', tree: target },
		]);
		expect(releaseContent(once, 'r', 'a').fingerprint).toBe(
			releaseContent(twice, 'r', 'b').fingerprint,
		);
	});

	test('a dependency change in package.json counts; devDependencies do not', () => {
		const git = fakeGit([
			{ sha: 'r', time: 0, subject: 'r', tree: v1 },
			{
				sha: 'a',
				time: 10,
				subject: 'chore: dev',
				tree: {
					...v1,
					'packages/a/package.json': pkg({
						version: '1.0.0',
						files: ['dist'],
						devDependencies: { x: '1' },
					}),
				},
			},
			{
				sha: 'b',
				time: 20,
				subject: 'fix(deps): y',
				tree: {
					...v1,
					'packages/a/package.json': pkg({
						version: '1.0.0',
						files: ['dist'],
						devDependencies: { x: '1' },
						dependencies: { y: '^2.0.0' },
					}),
				},
			},
		]);
		const content = releaseContent(git, 'r', 'b');
		expect(content.changes).toEqual(['packages/a/package.json#dependencies.y']);
		expect(content.carriers.map(({ sha }) => sha)).toEqual(['b']);
	});

	test('a change that is reverted does not count', () => {
		const git = fakeGit([
			{ sha: 'r', time: 0, subject: 'r', tree: v1 },
			{
				sha: 'a',
				time: 10,
				subject: 'fix: x',
				tree: { ...v1, 'packages/a/src/index.ts': 'two' },
			},
			{ sha: 'b', time: 20, subject: 'revert: x', tree: v1 },
		]);
		expect(releaseContent(git, 'r', 'b').fingerprint).toBeNull();
	});

	test('a single package at the root ignores repository files', () => {
		const root: Tree = {
			'package.json': pkg({ version: '1.0.0' }),
			'tsconfig.json': 'a',
			'.github/workflows/ci.yml': 'a',
		};
		const git = fakeGit([
			{ sha: 'r', time: 0, subject: 'r', tree: root },
			{
				sha: 'a',
				time: 10,
				subject: 'ci: x',
				tree: { ...root, '.github/workflows/ci.yml': 'b' },
			},
			{
				sha: 'b',
				time: 20,
				subject: 'feat: x',
				tree: { ...root, '.github/workflows/ci.yml': 'b', 'tsconfig.json': 'b' },
			},
		]);
		expect(releaseContent(git, 'r', 'b').changes).toEqual(['tsconfig.json']);
	});
});

describe('npmIgnore', () => {
	test('follows gitignore semantics', () => {
		const ignored = npmIgnore('src/\n*.map\n!keep.map\n/root-only\n');
		expect(ignored('src/a.ts')).toBe(true);
		expect(ignored('dist/a.js.map')).toBe(true);
		expect(ignored('keep.map')).toBe(false);
		expect(ignored('root-only')).toBe(true);
		expect(ignored('nested/root-only')).toBe(false);
		expect(ignored('dist/a.js')).toBe(false);
	});
});

describe('manifestChanges', () => {
	test('lists changed consumer-facing fields only', () => {
		expect(
			manifestChanges(
				JSON.stringify({
					version: '1.0.0',
					engines: { node: '>=20' },
					exports: './a.js',
				}),
				JSON.stringify({
					version: '1.1.0',
					engines: { node: '>=22' },
					exports: './b.js',
				}),
			),
		).toEqual(['package.json#engines.node', 'package.json#exports']);
	});
});
