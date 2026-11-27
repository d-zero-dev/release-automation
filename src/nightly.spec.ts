import type { NightlyRun } from './nightly.js';

import { describe, expect, test } from 'vitest';

import { isBlocked, isStale, nightlyAction } from './nightly.js';

const NOW = new Date('2026-11-25T00:00:00Z');
const run = (
	sha: string,
	conclusion: NightlyRun['conclusion'],
	hoursAgo = 1,
): NightlyRun => ({
	sha,
	conclusion,
	finishedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
});

describe('nightlyAction', () => {
	test('reuses a success on the same commit', () => {
		expect(nightlyAction('a', [run('a', 'success')], false)).toBe('reuse');
	});

	test('tests a failed commit again', () => {
		expect(nightlyAction('a', [run('a', 'failure')], false)).toBe('run');
	});

	test('tests a new commit', () => {
		expect(nightlyAction('b', [run('a', 'success')], false)).toBe('run');
		expect(nightlyAction('a', [], false)).toBe('run');
	});

	test('a person may run it anyway', () => {
		expect(nightlyAction('a', [run('a', 'success')], true)).toBe('run');
	});
});

describe('isBlocked', () => {
	test('follows the newest run only', () => {
		expect(isBlocked([run('b', 'failure'), run('a', 'success')])).toBe(true);
		expect(isBlocked([run('b', 'success'), run('a', 'failure')])).toBe(false);
		expect(isBlocked([])).toBe(false);
	});
});

describe('isStale', () => {
	test('a Nightly that has not finished for more than two days stopped', () => {
		expect(isStale([run('a', 'success', 47)], NOW)).toBe(false);
		expect(isStale([run('a', 'success', 49)], NOW)).toBe(true);
		expect(isStale([], NOW)).toBe(true);
	});

	test('a Nightly that never ran counts from when its workflow was added', () => {
		const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
		expect(isStale([], NOW, hoursAgo(47))).toBe(false);
		expect(isStale([], NOW, hoursAgo(49))).toBe(true);
	});

	test('a finished run decides, whenever the workflow was added', () => {
		const added = new Date(NOW.getTime() - 3_600_000);
		expect(isStale([run('a', 'success', 49)], NOW, added)).toBe(true);
		expect(isStale([run('a', 'success', 47)], NOW, added)).toBe(false);
	});
});
