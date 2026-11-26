import type { ReleasePrInput } from './release-pr-decision.js';

import { describe, expect, test } from 'vitest';

import { decideReleasePr } from './release-pr-decision.js';

const NOW = new Date('2026-11-25T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const base: ReleasePrInput = {
	now: NOW,
	manual: false,
	fingerprint: 'f1',
	userFacingSince: hoursAgo(1),
	securityLandedAt: [],
	openPr: null,
	declinedFingerprints: [],
	nightlyFailing: false,
	syncPending: false,
	publishIncomplete: false,
	securityBatchMinutes: 60,
};

describe('waiting', () => {
	test('a change waits three days', () => {
		expect(decideReleasePr({ ...base, userFacingSince: hoursAgo(71) })).toEqual({
			action: 'none',
			reason: 'waiting',
		});
		expect(decideReleasePr({ ...base, userFacingSince: hoursAgo(72) })).toEqual({
			action: 'create',
		});
	});

	test('a person does not wait', () => {
		expect(decideReleasePr({ ...base, manual: true })).toEqual({ action: 'create' });
	});

	test('nothing to release', () => {
		expect(
			decideReleasePr({ ...base, fingerprint: null, userFacingSince: null }),
		).toEqual({
			action: 'none',
			reason: 'nothing-to-release',
		});
	});
});

describe('security fixes', () => {
	test('are gathered for the batch window, then skip the three days', () => {
		expect(decideReleasePr({ ...base, securityLandedAt: [hoursAgo(0.5)] })).toEqual({
			action: 'none',
			reason: 'security-batching',
		});
		expect(
			decideReleasePr({ ...base, securityLandedAt: [hoursAgo(1), hoursAgo(0.1)] }),
		).toEqual({ action: 'create' });
	});

	test('the batch window comes from the lines file', () => {
		expect(
			decideReleasePr({
				...base,
				securityLandedAt: [hoursAgo(1)],
				securityBatchMinutes: 120,
			}),
		).toEqual({ action: 'none', reason: 'security-batching' });
	});
});

describe('stops', () => {
	test('a failing Nightly stops a new Release PR, from a person too, with security fixes too', () => {
		for (const input of [
			{ ...base, userFacingSince: hoursAgo(100) },
			{ ...base, manual: true },
			{ ...base, securityLandedAt: [hoursAgo(5)] },
		]) {
			expect(decideReleasePr({ ...input, nightlyFailing: true })).toEqual({
				action: 'none',
				reason: 'nightly-failing',
			});
		}
	});

	test('a failing Nightly does not stop the update of an open Release PR', () => {
		expect(
			decideReleasePr({
				...base,
				nightlyFailing: true,
				openPr: {
					number: 1,
					fingerprint: 'f0',
					approvedAt: null,
					baseUpdatedSinceApproval: false,
				},
			}),
		).toEqual({ action: 'update' });
	});

	test('an incomplete publish and a pending sync stop everything', () => {
		expect(decideReleasePr({ ...base, manual: true, publishIncomplete: true })).toEqual({
			action: 'none',
			reason: 'publish-incomplete',
		});
		expect(decideReleasePr({ ...base, manual: true, syncPending: true })).toEqual({
			action: 'none',
			reason: 'sync-pending',
		});
	});
});

describe('declined', () => {
	test('a schedule does not reopen the same content; a person may', () => {
		const declined = {
			...base,
			userFacingSince: hoursAgo(100),
			declinedFingerprints: ['f1'],
		};
		expect(decideReleasePr(declined)).toEqual({ action: 'none', reason: 'declined' });
		expect(decideReleasePr({ ...declined, manual: true })).toEqual({ action: 'create' });
		expect(decideReleasePr({ ...declined, fingerprint: 'f2' })).toEqual({
			action: 'create',
		});
	});
});

describe('an open Release PR', () => {
	test('without approval follows the content', () => {
		const openPr = {
			number: 1,
			fingerprint: 'f1',
			approvedAt: null,
			baseUpdatedSinceApproval: false,
		};
		expect(decideReleasePr({ ...base, openPr })).toEqual({
			action: 'none',
			reason: 'up-to-date',
		});
		expect(decideReleasePr({ ...base, openPr, fingerprint: 'f2' })).toEqual({
			action: 'update',
		});
	});

	test('with approval is frozen', () => {
		expect(
			decideReleasePr({
				...base,
				fingerprint: 'f2',
				openPr: {
					number: 1,
					fingerprint: 'f1',
					approvedAt: hoursAgo(2),
					baseUpdatedSinceApproval: false,
				},
			}),
		).toEqual({ action: 'none', reason: 'frozen' });
	});

	test('with approval is replaced when a security fix lands after the approval', () => {
		const openPr = {
			number: 1,
			fingerprint: 'f1',
			approvedAt: hoursAgo(2),
			baseUpdatedSinceApproval: false,
		};
		expect(decideReleasePr({ ...base, openPr, securityLandedAt: [hoursAgo(3)] })).toEqual(
			{
				action: 'none',
				reason: 'frozen',
			},
		);
		expect(decideReleasePr({ ...base, openPr, securityLandedAt: [hoursAgo(1)] })).toEqual(
			{
				action: 'replace',
				openSuccessor: true,
			},
		);
	});

	test('with approval is replaced when its target branch moved; the successor waits for the Nightly', () => {
		const openPr = {
			number: 1,
			fingerprint: 'f1',
			approvedAt: hoursAgo(2),
			baseUpdatedSinceApproval: true,
		};
		expect(decideReleasePr({ ...base, openPr })).toEqual({
			action: 'replace',
			openSuccessor: true,
		});
		expect(decideReleasePr({ ...base, openPr, nightlyFailing: true })).toEqual({
			action: 'replace',
			openSuccessor: false,
		});
	});
});
