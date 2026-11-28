import type { PublishMode } from './types.js';

import { describe, expect, test } from 'vitest';

import { needsPublish } from './needs-publish.js';

describe('needsPublish', () => {
	test.each<PublishMode>(['npm-single', 'lerna-fixed', 'lerna-independent'])(
		'%s publishes while a package is not on the registry',
		(mode) => {
			expect(needsPublish({ mode, unpublishedCount: 1 })).toBe(true);
		},
	);

	test.each<PublishMode>(['npm-single', 'lerna-fixed', 'lerna-independent'])(
		'%s publishes nothing when every package is already on the registry',
		(mode) => {
			expect(needsPublish({ mode, unpublishedCount: 0 })).toBe(false);
		},
	);

	test('a custom command always runs: the registry says nothing about it', () => {
		expect(needsPublish({ mode: 'custom', unpublishedCount: 0 })).toBe(true);
	});
});
