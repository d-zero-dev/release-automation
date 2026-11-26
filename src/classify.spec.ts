import type { RepoFacts } from './classify.js';

import { describe, expect, test } from 'vitest';

import { classify } from './classify.js';

const NOW = new Date('2026-11-25T00:00:00Z');

/**
 * @param overrides - Fields that differ from a stable single-line repository
 * @returns Facts for a test
 */
function facts(overrides: Partial<RepoFacts>): RepoFacts {
	return {
		devVersion: '1.0.0',
		lernaVersion: '1.0.0',
		rootPrivate: true,
		packageManager: 'yarn@4.18.1',
		branches: ['dev', 'main'],
		stableTags: [],
		codeowners: ['@alice'],
		linesFile: null,
		now: NOW,
		...overrides,
	};
}

/**
 * @param tag - A tag name
 * @param iso - The date it points at
 * @returns A stable tag fact
 */
function tag(tag: string, iso: string) {
	return { tag, date: new Date(iso) };
}

describe('lines of the repositories as they stand', () => {
	test('a prerelease current line with a maintained previous major that has no stable successor', () => {
		const result = classify(
			facts({
				devVersion: '4.0.0-alpha.78',
				lernaVersion: '4.0.0-alpha.78',
				branches: ['dev', 'main', 'v3'],
				stableTags: [tag('v3.5.0', '2026-09-01T00:00:00Z')],
			}),
		);
		expect(result.errors).toEqual([]);
		expect(
			result.lines.map(({ branch, role, stage, phase }) => ({
				branch,
				role,
				stage,
				phase,
			})),
		).toEqual([
			{ branch: 'dev', role: 'current', stage: 'alpha', phase: null },
			{ branch: 'v3', role: 'previous', stage: 'stable', phase: 'fixes' },
		]);
		expect(result.publishMode).toBe('lerna-fixed');
		expect(result.review).toEqual({ mode: 'solo', approvals: 0 });
	});

	test('a branch of a major without a stable release is locked, and a supported major without a branch gets one', () => {
		const result = classify(
			facts({
				devVersion: '3.0.0-alpha.7',
				lernaVersion: '3.0.0-alpha.7',
				branches: ['dev', 'main', 'v2'],
				stableTags: [
					tag('v1.3.0', '2026-01-01T00:00:00Z'),
					tag('v1.3.1', '2026-02-01T00:00:00Z'),
				],
				codeowners: ['@alice', '@bob'],
			}),
		);
		expect(result.errors).toEqual([]);
		expect(
			result.actions.map(({ code, branch, fromTag }) => ({ code, branch, fromTag })),
		).toEqual([
			{ code: 'lock-branch', branch: 'v2', fromTag: undefined },
			{ code: 'create-branch', branch: 'v1', fromTag: 'v1.3.1' },
			{ code: 'write-lines-file', branch: undefined, fromTag: undefined },
		]);
		expect(
			result.lines.map(({ branch, role, phase }) => ({ branch, role, phase })),
		).toEqual([
			{ branch: 'dev', role: 'current', phase: null },
			{ branch: 'v1', role: 'previous', phase: 'fixes' },
		]);
		expect(result.review).toEqual({ mode: 'collaborative', approvals: 1 });
	});

	test('a branch named after the current major is an error, a later one is the next major', () => {
		const result = classify(
			facts({
				devVersion: '5.1.3',
				lernaVersion: '5.1.3',
				branches: ['dev', 'main', 'v5', 'v6'],
				stableTags: [
					tag('v4.9.0', '2024-06-01T00:00:00Z'),
					tag('v5.0.0', '2025-01-01T00:00:00Z'),
					tag('v5.1.3', '2026-05-01T00:00:00Z'),
				],
			}),
		);
		expect(result.errors.map(({ code, branch }) => ({ code, branch }))).toEqual([
			{ code: 'branch-same-as-current', branch: 'v5' },
		]);
		expect(result.lines.map(({ branch, role }) => ({ branch, role }))).toEqual([
			{ branch: 'dev', role: 'current' },
			{ branch: 'v6', role: 'next' },
		]);
	});

	test('a stable current line with a next major', () => {
		const result = classify(
			facts({
				devVersion: '5.4.2',
				lernaVersion: '5.4.2',
				branches: ['dev', 'main', 'v6'],
				stableTags: [tag('v5.4.2', '2026-10-01T00:00:00Z')],
			}),
		);
		expect(result.errors).toEqual([]);
		expect(
			result.lines.map(({ branch, role, stage }) => ({ branch, role, stage })),
		).toEqual([
			{ branch: 'dev', role: 'current', stage: 'stable' },
			{ branch: 'v6', role: 'next', stage: null },
		]);
	});

	test('major 0 has one line', () => {
		const result = classify(
			facts({
				devVersion: '0.25.1',
				lernaVersion: '0.25.1',
				stableTags: [tag('v0.25.1', '2026-10-01T00:00:00Z')],
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.lines.map(({ branch, major }) => ({ branch, major }))).toEqual([
			{ branch: 'dev', major: 0 },
		]);
	});

	test('Lerna independent mode has one line and no version on dev', () => {
		const result = classify(facts({ devVersion: null, lernaVersion: 'independent' }));
		expect(result.publishMode).toBe('lerna-independent');
		expect(result.errors).toEqual([]);
		expect(result.lines.map(({ branch, role }) => ({ branch, role }))).toEqual([
			{ branch: 'dev', role: 'current' },
		]);
	});

	test('a single package at the root', () => {
		const result = classify(
			facts({ devVersion: '2.0.1-alpha.3', lernaVersion: null, rootPrivate: false }),
		);
		expect(result.publishMode).toBe('npm-single');
		expect(result.errors).toEqual([]);
	});

	test('a repository without an npm package needs a publish command', () => {
		const result = classify(
			facts({ devVersion: '5.0.0-alpha.0', lernaVersion: null, rootPrivate: true }),
		);
		expect(result.publishMode).toBe('custom');
		expect(result.errors.map(({ code }) => code)).toEqual(['missing-publish-command']);

		const withCommand = classify(
			facts({
				devVersion: '5.0.0-alpha.0',
				lernaVersion: null,
				rootPrivate: true,
				linesFile: {
					lines: [{ branch: 'dev', role: 'current' }],
					publishCommand: 'yarn deploy',
				},
			}),
		);
		expect(withCommand.errors).toEqual([]);
		expect(withCommand.actions).toEqual([]);
	});
});

describe('the next major', () => {
	test('cannot start while the current line is a prerelease', () => {
		const result = classify(
			facts({
				devVersion: '2.0.0-rc.1',
				lernaVersion: '2.0.0-rc.1',
				branches: ['dev', 'main', 'v3'],
			}),
		);
		expect(result.errors.map(({ code, branch }) => ({ code, branch }))).toEqual([
			{ code: 'next-while-prerelease', branch: 'v3' },
		]);
	});

	test('only one at a time', () => {
		const result = classify(facts({ branches: ['dev', 'main', 'v2', 'v3'] }));
		expect(result.errors.map(({ code, branch }) => ({ code, branch }))).toEqual([
			{ code: 'multiple-next', branch: 'v3' },
		]);
		expect(result.lines.map(({ branch }) => branch)).toEqual(['dev', 'v2']);
	});

	test('a v<N> branch in Lerna independent mode is an error', () => {
		const result = classify(
			facts({
				devVersion: null,
				lernaVersion: 'independent',
				branches: ['dev', 'main', 'v2'],
			}),
		);
		expect(result.errors.map(({ code }) => code)).toEqual(['branch-on-independent']);
	});
});

describe('previous lines', () => {
	test('the support period runs from the first stable release of a later major', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				branches: ['dev', 'main', 'v3'],
				stableTags: [
					tag('v3.9.0', '2026-03-01T00:00:00Z'),
					tag('v4.0.0', '2026-04-01T00:00:00Z'),
					tag('v4.1.0', '2026-06-01T00:00:00Z'),
				],
			}),
		);
		const v3 = result.lines.find(({ branch }) => branch === 'v3');
		expect(v3?.phase).toBe('security');
		expect(v3?.supportEnd?.toISOString()).toBe('2027-04-01T00:00:00.000Z');
	});

	test('a line past its support end leaves the lines and its branch is locked', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				branches: ['dev', 'main', 'v3'],
				stableTags: [
					tag('v3.9.0', '2025-03-01T00:00:00Z'),
					tag('v4.0.0', '2025-04-01T00:00:00Z'),
				],
			}),
		);
		expect(result.lines.map(({ branch }) => branch)).toEqual(['dev']);
		expect(result.actions.map(({ code, branch }) => ({ code, branch }))).toContainEqual({
			code: 'lock-branch',
			branch: 'v3',
		});
	});

	test('the support period comes from the lines file', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				branches: ['dev', 'main', 'v3'],
				stableTags: [
					tag('v3.9.0', '2025-03-01T00:00:00Z'),
					tag('v4.0.0', '2025-04-01T00:00:00Z'),
				],
				linesFile: {
					lines: [
						{ branch: 'dev', role: 'current' },
						{ branch: 'v3', role: 'previous' },
					],
					supportMonths: 24,
				},
			}),
		);
		expect(result.lines.find(({ branch }) => branch === 'v3')?.phase).toBe('security');
	});

	test('an ended line without a branch needs nothing', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				stableTags: [
					tag('v3.9.0', '2024-03-01T00:00:00Z'),
					tag('v4.0.0', '2024-04-01T00:00:00Z'),
				],
				linesFile: { lines: [{ branch: 'dev', role: 'current' }] },
			}),
		);
		expect(result.actions).toEqual([]);
	});
});

describe('with a lines file', () => {
	test('the file is the definition: tags of an older project do not make a line', () => {
		const result = classify(
			facts({
				devVersion: '4.0.0-alpha.78',
				lernaVersion: '4.0.0-alpha.78',
				branches: ['dev', 'main', 'v3'],
				stableTags: [
					tag('v0.10.0', '2022-06-14T00:00:00Z'),
					tag('v3.5.0', '2026-10-29T00:00:00Z'),
				],
				linesFile: {
					lines: [
						{ branch: 'dev', role: 'current' },
						{ branch: 'v3', role: 'previous' },
					],
				},
			}),
		);
		expect(result.source).toBe('file');
		expect(result.errors).toEqual([]);
		expect(result.actions).toEqual([]);
		expect(result.lines.map(({ branch, phase }) => ({ branch, phase }))).toEqual([
			{ branch: 'dev', phase: null },
			{ branch: 'v3', phase: 'fixes' },
		]);
	});

	test('the file states when the successor became stable', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				branches: ['dev', 'main', 'v3'],
				linesFile: {
					lines: [
						{ branch: 'dev', role: 'current' },
						{ branch: 'v3', role: 'previous', successorStable: '2026-04-01' },
					],
				},
			}),
		);
		expect(result.lines[1]?.phase).toBe('security');
		expect(result.lines[1]?.supportEnd?.toISOString()).toBe('2027-04-01T00:00:00.000Z');
	});

	test('a v<N> branch the file does not list is locked', () => {
		const result = classify(
			facts({
				devVersion: '3.0.0-alpha.7',
				lernaVersion: '3.0.0-alpha.7',
				branches: ['dev', 'main', 'v2'],
				linesFile: { lines: [{ branch: 'dev', role: 'current' }] },
			}),
		);
		expect(result.actions.map(({ code, branch }) => ({ code, branch }))).toEqual([
			{ code: 'lock-branch', branch: 'v2' },
		]);
	});

	test('a listed previous line without a branch is created from its newest tag', () => {
		const result = classify(
			facts({
				devVersion: '3.0.0-alpha.7',
				lernaVersion: '3.0.0-alpha.7',
				stableTags: [
					tag('v1.3.0', '2026-01-01T00:00:00Z'),
					tag('v1.3.1', '2026-02-01T00:00:00Z'),
				],
				linesFile: {
					lines: [
						{ branch: 'dev', role: 'current' },
						{ branch: 'v1', role: 'previous' },
					],
				},
			}),
		);
		expect(result.actions.map(({ code, fromTag }) => ({ code, fromTag }))).toEqual([
			{ code: 'create-branch', fromTag: 'v1.3.1' },
		]);
	});

	test('a listed line past its support end calls for the end-of-support work', () => {
		const result = classify(
			facts({
				devVersion: '4.1.0',
				lernaVersion: '4.1.0',
				branches: ['dev', 'main', 'v3'],
				linesFile: {
					lines: [
						{ branch: 'dev', role: 'current' },
						{ branch: 'v3', role: 'previous', successorStable: '2025-01-01' },
					],
				},
			}),
		);
		expect(result.actions.map(({ code, branch }) => ({ code, branch }))).toEqual([
			{ code: 'line-ended', branch: 'v3' },
		]);
	});

	test.each([
		[{ lines: [{ branch: 'v3', role: 'previous' as const }] }, /needs/],
		[
			{
				lines: [
					{ branch: 'dev', role: 'current' as const },
					{ branch: 'v5', role: 'previous' as const },
				],
			},
			/below v4/,
		],
		[
			{
				lines: [
					{ branch: 'dev', role: 'current' as const },
					{ branch: 'v3', role: 'next' as const },
				],
			},
			/above v4/,
		],
		[
			{
				lines: [
					{ branch: 'dev', role: 'current' as const },
					{ branch: 'legacy', role: 'previous' as const },
				],
			},
			/v<major> branch/,
		],
		[
			{
				lines: [
					{ branch: 'dev', role: 'current' as const },
					{ branch: 'v2', role: 'previous' as const },
				],
			},
			/no v2\.x\.y tag/,
		],
		[
			{
				lines: [
					{ branch: 'dev', role: 'current' as const },
					{ branch: 'v5', role: 'next' as const },
				],
			},
			/does not exist/,
		],
	])('an entry that contradicts the facts is an error: %j', (linesFile, message) => {
		const result = classify(
			facts({ devVersion: '4.1.0', lernaVersion: '4.1.0', linesFile }),
		);
		expect(result.errors.map(({ code }) => code)).toContain('invalid-lines-file');
		expect(result.errors.map(({ message }) => message).join('\n')).toMatch(message);
	});
});

describe('review mode', () => {
	test('stops without code owners', () => {
		expect(classify(facts({ codeowners: null })).errors.map(({ code }) => code)).toEqual([
			'missing-codeowners',
		]);
		expect(classify(facts({ codeowners: [] })).review).toBeNull();
	});

	test('a team counts as more than one person', () => {
		expect(classify(facts({ codeowners: ['@org/team'] })).review).toEqual({
			mode: 'collaborative',
			approvals: 1,
		});
	});

	test('the same owner listed twice is one person', () => {
		expect(classify(facts({ codeowners: ['@alice', '@alice'] })).review?.mode).toBe(
			'solo',
		);
	});
});

describe('age gate', () => {
	test.each([
		['yarn@4.18.1', { file: '.yarnrc.yml', key: 'npmMinimalAgeGate', value: '3d' }],
		['yarn@4.10.0', { file: '.yarnrc.yml', key: 'npmMinimalAgeGate', value: '3d' }],
		['yarn@4.9.4', null],
		[
			'pnpm@10.16.0',
			{ file: 'pnpm-workspace.yaml', key: 'minimumReleaseAge', value: '4320' },
		],
		['pnpm@9.15.0', null],
		['npm@11.0.0', null],
	])('%s', (packageManager, expected) => {
		expect(classify(facts({ packageManager })).ageGate).toEqual(expected);
	});
});
