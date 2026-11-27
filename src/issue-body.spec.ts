import { describe, expect, test } from 'vitest';

import { issuesToRewrite } from './issue-body.js';

describe('issuesToRewrite', () => {
	test('picks the Issues whose body differs', () => {
		const open = [
			{ number: 1, body: 'old' },
			{ number: 2, body: 'new\n' },
		];
		expect(issuesToRewrite(open, 'new\n')).toEqual([1]);
	});

	test('treats CRLF and trailing whitespace as the same body', () => {
		expect(issuesToRewrite([{ number: 1, body: 'a\r\nb' }], 'a\nb\n')).toEqual([]);
	});

	test('rewrites an empty body', () => {
		expect(issuesToRewrite([{ number: 3, body: null }], 'a\n')).toEqual([3]);
	});
});
