import type { ClassifiedLine } from './classify.js';
import type { CheckedFiles } from './lines-check.js';

import { describe, expect, test } from 'vitest';

import { checkLines, LOCKFILE_STOP_RULE, PREVIOUS_LINES_RULE } from './lines-check.js';

const lines: ClassifiedLine[] = [
	{
		branch: 'dev',
		role: 'current',
		major: 4,
		publishBranch: 'main',
		stage: 'stable',
		phase: null,
		successorStable: null,
		supportEnd: null,
	},
	{
		branch: 'v3',
		role: 'previous',
		major: 3,
		publishBranch: 'v3',
		stage: 'stable',
		phase: 'security',
		successorStable: new Date('2026-04-01T00:00:00Z'),
		supportEnd: new Date('2027-04-01T00:00:00Z'),
	},
];

const ci = `
on:
  pull_request:
    branches: [dev, main, v3]
  merge_group:
jobs:
  test:
    runs-on: ubuntu-latest
  ci-ok:
    needs: [test]
`;

const files: CheckedFiles = {
	renovate: {
		baseBranchPatterns: ['dev', 'v3'],
		packageRules: [
			{ description: PREVIOUS_LINES_RULE, matchBaseBranches: ['v3'], enabled: false },
			{ description: LOCKFILE_STOP_RULE, matchBaseBranches: ['v3'], enabled: false },
		],
	},
	workflows: [{ path: '.github/workflows/test.yml', content: ci }],
	securityMd: '| v4 | Current | Yes |\n| v3 | Security fixes until 2027-04-01 | Yes |\n',
	preCommit: 'yarn release-automation guard\n',
};

describe('checkLines', () => {
	test('agreeing files', () => {
		expect(checkLines(lines, files)).toEqual([]);
	});

	test('Renovate targets a branch that is not a line', () => {
		expect(
			checkLines(lines, {
				...files,
				renovate: { ...(files.renovate as object), baseBranchPatterns: ['dev', 'v2'] },
			}),
		).toContainEqual(expect.stringMatching(/baseBranchPatterns/));
	});

	test('the previous-line rule is missing', () => {
		expect(
			checkLines(lines, {
				...files,
				renovate: { baseBranchPatterns: ['dev', 'v3'], packageRules: [] },
			}),
		).toEqual([
			`renovate.json has no packageRule "${PREVIOUS_LINES_RULE}" with enabled: false`,
		]);
	});

	test('a workflow names a branch that is not a line', () => {
		expect(
			checkLines(lines, {
				...files,
				workflows: [
					...files.workflows,
					{
						path: '.github/workflows/x.yml',
						content: 'on:\n  push:\n    branches: [v2, "renovate/**"]\n',
					},
				],
			}),
		).toEqual([
			'.github/workflows/x.yml: on.push.branches names v2, which is not a line branch',
		]);
	});

	test('the Minimum CI misses a line branch and the merge queue', () => {
		expect(
			checkLines(lines, {
				...files,
				workflows: [
					{
						path: '.github/workflows/test.yml',
						content: 'on:\n  pull_request:\n    branches: [dev]\njobs:\n  ci-ok: {}\n',
					},
				],
			}),
		).toEqual([
			'.github/workflows/test.yml: on.pull_request.branches lacks v3',
			'.github/workflows/test.yml: on.pull_request.branches lacks main',
			'.github/workflows/test.yml: the Minimum CI does not run on merge_group',
		]);
	});

	test('SECURITY.md misses a line or its end date', () => {
		expect(
			checkLines(lines, {
				...files,
				securityMd: '| v4 | Current |\n| v3 | Security |\n',
			}),
		).toEqual(['SECURITY.md does not state 2027-04-01 as the end of v3']);
		expect(checkLines(lines, { ...files, securityMd: null })).toEqual([
			'SECURITY.md does not exist',
		]);
	});

	test('the commit guard is missing', () => {
		expect(checkLines(lines, { ...files, preCommit: null })).toEqual([
			'.husky/pre-commit does not run "release-automation guard"',
		]);
	});
});
