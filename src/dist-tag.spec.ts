import type { DistTagInput } from './dist-tag.js';

import { describe, expect, test } from 'vitest';

import { distTag } from './dist-tag.js';

const base: DistTagInput = {
	version: '1.0.0',
	role: 'current',
	independent: false,
	successorStablePublished: false,
	latestOnRegistry: null,
};

describe('distTag', () => {
	test.each(['alpha', 'beta', 'rc'])(
		'a %s prerelease gets the tag of the same name',
		(id) => {
			expect(distTag({ ...base, version: `2.0.0-${id}.1` })).toBe(id);
		},
	);

	test('a stable release of the current line is latest', () => {
		expect(distTag({ ...base, version: '2.1.0', latestOnRegistry: '2.0.0' })).toBe(
			'latest',
		);
	});

	test('a stable release of a previous line is v<major> once a later major is stable', () => {
		expect(
			distTag({
				...base,
				version: '3.5.1',
				role: 'previous',
				successorStablePublished: true,
				latestOnRegistry: '4.0.0',
			}),
		).toBe('v3');
	});

	test('a stable release of a previous line stays latest while the later major has no stable release', () => {
		expect(
			distTag({ ...base, version: '3.5.1', role: 'previous', latestOnRegistry: '3.5.0' }),
		).toBe('latest');
	});

	test('the current line never moves latest to an older major', () => {
		expect(() =>
			distTag({ ...base, version: '3.0.0', latestOnRegistry: '4.0.0' }),
		).toThrow(/older major/);
	});

	test('the next-major line has no stable release of its own', () => {
		expect(() => distTag({ ...base, version: '6.0.0', role: 'next' })).toThrow(
			/prereleases only/,
		);
	});

	test.each(['1.0.0-next.1', '1.0.0-canary.0', 'v1.0.0', '1.0'])(
		'%s is rejected',
		(version) => {
			expect(() => distTag({ ...base, version })).toThrow();
		},
	);

	test('independent mode uses latest for every stable release', () => {
		expect(
			distTag({
				...base,
				version: '0.5.0',
				independent: true,
				latestOnRegistry: '1.0.0',
			}),
		).toBe('latest');
	});
});
