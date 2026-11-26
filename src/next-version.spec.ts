import { describe, expect, test } from 'vitest';

import { parseCommit } from './conventional-commit.js';
import { nextVersion } from './next-version.js';

const commits = (...messages: string[]) =>
	messages.map((message) => parseCommit(message));

describe('nextVersion', () => {
	test.each([
		['1.2.3', ['fix: a'], '1.2.4'],
		['1.2.3', ['fix(deps): update foo'], '1.2.4'],
		['1.2.3', ['perf: a', 'fix: b'], '1.2.4'],
		['1.2.3', ['feat: a', 'fix: b'], '1.3.0'],
		['0.25.1', ['feat!: a'], '0.26.0'],
		['0.25.1', ['fix: a\n\nBREAKING CHANGE: b'], '0.26.0'],
	])('%s with %j is %s', (current, messages, expected) => {
		expect(
			nextVersion({
				current,
				commits: commits(...messages),
				promote: null,
				lineMajor: Number(current.split('.')[0]),
			}),
		).toEqual({
			ok: true,
			version: expected,
		});
	});

	test('a breaking change on a stable line above major 0 leaves the line', () => {
		expect(
			nextVersion({
				current: '1.2.3',
				commits: commits('feat!: a'),
				promote: null,
				lineMajor: 1,
			}),
		).toMatchObject({ ok: false, reason: 'exceeds-line-major' });
	});

	test('a prerelease stays in its stage', () => {
		expect(
			nextVersion({
				current: '2.0.1-alpha.3',
				commits: commits('feat!: a'),
				promote: null,
				lineMajor: 2,
			}),
		).toEqual({ ok: true, version: '2.0.1-alpha.4' });
	});

	test.each([
		['2.0.0-alpha.3', 'beta', '2.0.0-beta.0'],
		['2.0.0-beta.3', 'rc', '2.0.0-rc.0'],
		['2.0.0-rc.1', 'stable', '2.0.0'],
	] as const)('%s promoted to %s is %s', (current, promote, expected) => {
		expect(nextVersion({ current, commits: [], promote, lineMajor: 2 })).toEqual({
			ok: true,
			version: expected,
		});
	});

	test.each([
		['2.0.0-alpha.3', 'rc'],
		['2.0.0-alpha.3', 'stable'],
		['2.0.0-rc.1', 'beta'],
		['2.0.0', 'stable'],
	] as const)('%s cannot be promoted to %s', (current, promote) => {
		expect(nextVersion({ current, commits: [], promote, lineMajor: 2 })).toMatchObject({
			ok: false,
			reason: 'invalid-promotion',
		});
	});

	test('commits that do not reach users release nothing', () => {
		expect(
			nextVersion({
				current: '1.2.3',
				commits: commits('chore: a', 'docs: b', 'test: c', 'not conventional'),
				promote: null,
				lineMajor: 1,
			}),
		).toMatchObject({ ok: false, reason: 'nothing-to-release' });
	});
});
