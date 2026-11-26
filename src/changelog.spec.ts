import { describe, expect, test } from 'vitest';

import { prependRelease } from './changelog.js';

const release = {
	version: '0.0.1',
	date: '2026-11-26',
	entries: ['fix: a (aaaaaaa)', 'fix: b (bbbbbbb)'],
};

describe('prependRelease', () => {
	test('starts a changelog that ends with one newline', () => {
		expect(prependRelease(null, release)).toBe(
			'# Changelog\n\n## 0.0.1 (2026-11-26)\n\n- fix: a (aaaaaaa)\n- fix: b (bbbbbbb)\n',
		);
	});

	test('puts a release above the earlier ones, one blank line apart', () => {
		const first = prependRelease(null, release);
		expect(
			prependRelease(first, {
				version: '0.0.2',
				date: '2026-11-27',
				entries: ['feat: c (ccccccc)'],
			}),
		).toBe(
			'# Changelog\n\n## 0.0.2 (2026-11-27)\n\n- feat: c (ccccccc)\n\n## 0.0.1 (2026-11-26)\n\n- fix: a (aaaaaaa)\n- fix: b (bbbbbbb)\n',
		);
	});

	test('keeps the title of an existing changelog and drops extra blank lines', () => {
		expect(prependRelease('# Releases\n\n\n', release)).toBe(
			'# Releases\n\n## 0.0.1 (2026-11-26)\n\n- fix: a (aaaaaaa)\n- fix: b (bbbbbbb)\n',
		);
	});

	test('a release without entries is the heading alone', () => {
		expect(prependRelease(null, { ...release, entries: [] })).toBe(
			'# Changelog\n\n## 0.0.1 (2026-11-26)\n',
		);
	});
});
