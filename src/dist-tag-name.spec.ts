import { describe, expect, test } from 'vitest';

import { isDistTagName } from './dist-tag-name.js';

describe('isDistTagName', () => {
	test.each(['latest', 'v3-legacy', 'v3', 'alpha', 'stable.1', 'Legacy_3'])(
		'%s is a dist-tag name',
		(name) => {
			expect(isDistTagName(name)).toBe(true);
		},
	);

	test.each(['next', '', '3', '1.0.0', 'v1.0.0-x', '^1', 'a b', '-x', '.x'])(
		'%j is not a dist-tag name',
		(name) => {
			expect(isDistTagName(name)).toBe(false);
		},
	);

	test.each([undefined, null, 3, {}, ['latest']])('%j is not a string', (value) => {
		expect(isDistTagName(value)).toBe(false);
	});
});
