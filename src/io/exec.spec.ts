import { describe, expect, test } from 'vitest';

import { redact, run } from './exec.js';

describe('redact', () => {
	test('hides the token in a remote URL', () => {
		expect(
			redact('git push https://x-access-token:ghs_secret@github.com/o/r.git HEAD'),
		).toBe('git push https://x-access-token:***@github.com/o/r.git HEAD');
	});

	test('leaves a URL without credentials alone', () => {
		expect(redact('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
	});
});

describe('run', () => {
	test('a failed command does not repeat a token from its arguments', () => {
		let message = '';
		try {
			run(
				'git',
				['ls-remote', 'https://x-access-token:ghs_secret@invalid.invalid/o/r.git'],
				{
					cwd: process.cwd(),
					env: { GIT_TERMINAL_PROMPT: '0' },
				},
			);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('x-access-token:***@');
		expect(message).not.toContain('ghs_secret');
	});
});
