import type { LinesFile } from './types.js';

import { describe, expect, test } from 'vitest';

import { commitMessageError, guardedBranches } from './guard.js';

const lines: LinesFile = {
	lines: [
		{ branch: 'dev', role: 'current' },
		{ branch: 'v6', role: 'next' },
		{ branch: 'v4', role: 'previous' },
	],
};

describe('guardedBranches', () => {
	test('every line branch and main', () => {
		expect(guardedBranches(lines)).toEqual(['dev', 'v6', 'v4', 'main']);
	});

	test('a topic branch is not guarded', () => {
		expect(guardedBranches(lines)).not.toContain('feat/x');
	});
});

describe('commitMessageError', () => {
	const check = (
		message: string,
		target: string,
		currentVersion: string | null = '5.1.0',
	) => commitMessageError({ message, target, currentVersion, lines });

	test('a change that is not breaking lands anywhere', () => {
		expect(check('feat: x', 'dev')).toBeNull();
		expect(check('fix: x', 'v4')).toBeNull();
	});

	test('a breaking change is refused on a stable current line', () => {
		expect(check('feat!: x', 'dev')).toMatch(/next major/);
		expect(check('fix: x\n\nBREAKING CHANGE: y', 'dev')).toMatch(/next major/);
	});

	test('a breaking change lands on the next-major line', () => {
		expect(check('feat!: x', 'v6')).toBeNull();
	});

	test('a breaking change is refused on a previous line', () => {
		expect(check('feat!: x', 'v4')).toMatch(/previous line/);
	});

	test('a breaking change lands on a current line in a prerelease, at major 0, and in independent mode', () => {
		expect(check('feat!: x', 'dev', '6.0.0-alpha.1')).toBeNull();
		expect(check('feat!: x', 'dev', '0.25.1')).toBeNull();
		expect(check('feat!: x', 'dev', null)).toBeNull();
	});
});
