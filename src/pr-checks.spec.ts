import type { PrFacts } from './pr-checks.js';

import { describe, expect, test } from 'vitest';

import { canApproveRenovatePr, releasePrOrigin } from './pr-checks.js';

const renovatePr: PrFacts = {
	author: 'renovate[bot]',
	commits: [{ author: 'renovate[bot]', verified: true }],
	body: 'This PR contains...\n\n🚦 **Automerge**: Enabled.\n',
	labels: ['Dependencies'],
};

describe('canApproveRenovatePr', () => {
	test('approves a pull request Renovate wrote and merges by itself', () => {
		expect(canApproveRenovatePr(renovatePr)).toEqual({ ok: true, reasons: [] });
	});

	test('refuses a pull request a person pushed to', () => {
		const result = canApproveRenovatePr({
			...renovatePr,
			commits: [...renovatePr.commits, { author: 'alice', verified: true }],
		});
		expect(result.ok).toBe(false);
		expect(result.reasons).toEqual(['commit 2 is by alice']);
	});

	test('refuses an unsigned commit', () => {
		expect(
			canApproveRenovatePr({
				...renovatePr,
				commits: [{ author: 'renovate[bot]', verified: false }],
			}).ok,
		).toBe(false);
	});

	test('refuses a pull request Renovate leaves to a person', () => {
		expect(
			canApproveRenovatePr({
				...renovatePr,
				body: '🚦 **Automerge**: Disabled by config.',
			}).ok,
		).toBe(false);
		expect(canApproveRenovatePr({ ...renovatePr, labels: ['manual-review'] }).ok).toBe(
			false,
		);
	});

	test('refuses a pull request someone else opened', () => {
		expect(canApproveRenovatePr({ ...renovatePr, author: 'alice' }).ok).toBe(false);
	});
});

describe('releasePrOrigin', () => {
	const app = 'release-app[bot]';
	const pr: PrFacts = {
		author: app,
		commits: [{ author: app, verified: true }],
		body: '',
		labels: ['release'],
	};

	test('accepts a pull request the Release App opened and wrote', () => {
		expect(releasePrOrigin(pr, app).ok).toBe(true);
	});

	test('refuses one with a commit by someone else, whatever its title or labels', () => {
		expect(
			releasePrOrigin(
				{ ...pr, commits: [...pr.commits, { author: 'alice', verified: true }] },
				app,
			).ok,
		).toBe(false);
		expect(releasePrOrigin({ ...pr, author: 'alice' }, app).ok).toBe(false);
	});
});
