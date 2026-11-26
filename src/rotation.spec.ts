import type { ClassifiedLine } from './classify.js';

import { describe, expect, test } from 'vitest';

import { LOCKFILE_STOP_RULE } from './lines-check.js';
import { eolIssues, isFirstStableOfMajor, withLockfileStop } from './rotation.js';

const v3: ClassifiedLine = {
	branch: 'v3',
	role: 'previous',
	major: 3,
	publishBranch: 'v3',
	stage: 'stable',
	phase: 'security',
	successorStable: new Date('2026-04-01T00:00:00Z'),
	supportEnd: new Date('2027-04-01T00:00:00Z'),
};

describe('eolIssues', () => {
	test('opens 14 days before the end', () => {
		expect(eolIssues([v3], new Date('2027-03-17T23:59:59Z'))).toEqual([]);
		const [issue] = eolIssues([v3], new Date('2027-03-18T00:00:00Z'));
		expect(issue?.marker).toBe('<!-- release-automation:eol:v3:2027-04-01 -->');
		expect(issue?.body.startsWith(issue.marker)).toBe(true);
	});

	test('a line without a stable successor has no end', () => {
		expect(
			eolIssues(
				[{ ...v3, supportEnd: null, phase: 'fixes' }],
				new Date('2099-01-01T00:00:00Z'),
			),
		).toEqual([]);
	});
});

describe('isFirstStableOfMajor', () => {
	test.each([
		['5.0.0', ['v4.2.0'], true],
		['5.0.1', ['v4.2.0', 'v5.0.0'], false],
		['5.0.0-rc.1', ['v4.2.0'], false],
		['1.0.0', ['v0.25.1'], true],
	])('%s after %j is %s', (version, tags, expected) => {
		expect(isFirstStableOfMajor(version, tags)).toBe(expected);
	});
});

describe('withLockfileStop', () => {
	test('adds the rule, then extends it, and is idempotent', () => {
		const once = withLockfileStop({ packageRules: [{ matchPackageNames: ['a'] }] }, [
			'v4',
		]);
		expect(once['packageRules']).toEqual([
			{ matchPackageNames: ['a'] },
			{
				description: LOCKFILE_STOP_RULE,
				matchBaseBranches: ['v4'],
				matchUpdateTypes: ['lockFileMaintenance'],
				enabled: false,
			},
		]);
		const twice = withLockfileStop(once, ['v5', 'v4']);
		expect(twice['packageRules']).toEqual([
			{ matchPackageNames: ['a'] },
			{
				description: LOCKFILE_STOP_RULE,
				matchBaseBranches: ['v4', 'v5'],
				matchUpdateTypes: ['lockFileMaintenance'],
				enabled: false,
			},
		]);
		expect(withLockfileStop(twice, ['v5'])).toEqual(twice);
	});
});
