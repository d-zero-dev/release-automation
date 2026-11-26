import { describe, expect, test } from 'vitest';

import { pushArgs } from './git.js';

describe('pushArgs', () => {
	test('clears the header actions/checkout leaves, so the token of the URL is the credential', () => {
		expect(pushArgs('ghs_x', 'o/r', 'HEAD:refs/heads/release/dev')).toEqual([
			'-c',
			'http.https://github.com/.extraheader=',
			'push',
			'--force',
			'https://x-access-token:ghs_x@github.com/o/r.git',
			'HEAD:refs/heads/release/dev',
		]);
	});

	test('the reset comes before the subcommand, where git reads configuration options', () => {
		const args = pushArgs('ghs_x', 'o/r', 'HEAD:refs/heads/b');
		expect(args.indexOf('http.https://github.com/.extraheader=')).toBeLessThan(
			args.indexOf('push'),
		);
	});
});
