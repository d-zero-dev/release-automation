import { describe, expect, test } from 'vitest';

import { retry } from './retry.js';

describe('retry', () => {
	test('waits longer each time and stops at the first success', async () => {
		const waits: number[] = [];
		const result = await retry(
			(attempt) =>
				attempt < 3
					? Promise.reject(new Error(`fail ${attempt}`))
					: Promise.resolve('ok'),
			{
				attempts: 3,
				baseDelayMs: 10,
				sleep: (ms) => {
					waits.push(ms);
					return Promise.resolve();
				},
			},
		);
		expect(result).toBe('ok');
		expect(waits).toEqual([10, 20]);
	});

	test('gives up after the last try with its error', async () => {
		let tries = 0;
		await expect(
			retry(
				() => {
					tries++;
					return Promise.reject(new Error(`fail ${tries}`));
				},
				{ attempts: 3, baseDelayMs: 1, sleep: () => Promise.resolve() },
			),
		).rejects.toThrow('fail 3');
		expect(tries).toBe(3);
	});
});
