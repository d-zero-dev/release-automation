/**
 * An open Release PR of the line.
 * @example
 * const pr: OpenReleasePr = { number: 12, fingerprint: 'abc', approvedAt: null, baseUpdatedSinceApproval: false };
 */
export interface OpenReleasePr {
	readonly number: number;
	/** The fingerprint of the release content the PR carries. */
	readonly fingerprint: string;
	/** When the earliest approval by a person that is still valid was given; `null` without one. */
	readonly approvedAt: Date | null;
	/** Whether the target branch moved after {@link approvedAt}. */
	readonly baseUpdatedSinceApproval: boolean;
}

/**
 * Everything the decision reads about one release line.
 * @example
 * const input: ReleasePrInput = {
 * 	now: new Date(),
 * 	manual: false,
 * 	fingerprint: 'def',
 * 	userFacingSince: new Date('2026-11-20T00:00:00Z'),
 * 	securityLandedAt: [],
 * 	openPr: null,
 * 	declinedFingerprints: [],
 * 	nightlyFailing: false,
 * 	syncPending: false,
 * 	publishIncomplete: false,
 * 	securityBatchMinutes: 60,
 * };
 */
export interface ReleasePrInput {
	readonly now: Date;
	/** Whether a person started the run. */
	readonly manual: boolean;
	/**
	 * The fingerprint of the release content on the line now (the changes that
	 * reach users since the last release); `null` when there is none.
	 */
	readonly fingerprint: string | null;
	/** When the oldest unreleased change that reaches users landed on the line. */
	readonly userFacingSince: Date | null;
	/** When each unreleased security fix landed on the line. */
	readonly securityLandedAt: readonly Date[];
	readonly openPr: OpenReleasePr | null;
	/** The fingerprints of Release PRs a person closed without merging. */
	readonly declinedFingerprints: readonly string[];
	/** Whether the last Nightly of the line failed. */
	readonly nightlyFailing: boolean;
	/** Whether the last release has not reached the development branch yet. */
	readonly syncPending: boolean;
	/** Whether a release of the line is not fully published. */
	readonly publishIncomplete: boolean;
	readonly securityBatchMinutes: number;
}

/**
 * What to do with the Release PR of a line.
 *
 * - `none`: nothing
 * - `create`: open a Release PR
 * - `update`: rewrite the open, unapproved Release PR
 * - `replace`: close the approved Release PR as replaced; open its successor when `openSuccessor`
 * @example
 * const decision: ReleasePrDecision = { action: 'none', reason: 'waiting' };
 */
export type ReleasePrDecision =
	| {
			readonly action: 'none';
			readonly reason:
				| 'nothing-to-release'
				| 'up-to-date'
				| 'frozen'
				| 'waiting'
				| 'security-batching'
				| 'declined'
				| 'nightly-failing'
				| 'sync-pending'
				| 'publish-incomplete';
	  }
	| { readonly action: 'create' | 'update' }
	| { readonly action: 'replace'; readonly openSuccessor: boolean };

/** How long a change that reaches users waits before a Release PR is opened for it. */
export const RELEASE_WAIT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Decides what happens to the Release PR of a line. The order of the checks
 * is the order of precedence:
 *
 * 1. A release that is not fully published, or not yet brought back to the
 *    development branch, stops every new Release PR.
 * 2. An approved Release PR is frozen. It is replaced when its target branch
 *    moved or a security fix landed after the approval; the successor waits
 *    while the Nightly of the line fails.
 * 3. An unapproved Release PR is updated when the release content changed.
 * 4. No new Release PR opens while the Nightly of the line fails.
 * 5. A person's run opens one at once. A scheduled run does not reopen a
 *    release a person declined, gathers security fixes for the batch window,
 *    and otherwise waits three days from the oldest change.
 * @param input - The state of the line
 * @returns The decision
 * @example
 * decideReleasePr({ ...input, userFacingSince: new Date(Date.now() - 4 * 86_400_000) }); // { action: 'create' }
 */
export function decideReleasePr(input: ReleasePrInput): ReleasePrDecision {
	if (input.publishIncomplete) {
		return { action: 'none', reason: 'publish-incomplete' };
	}
	if (input.syncPending) {
		return { action: 'none', reason: 'sync-pending' };
	}

	const pr = input.openPr;
	if (pr !== null && pr.approvedAt !== null) {
		const approvedAt = pr.approvedAt.getTime();
		const securityAfterApproval = input.securityLandedAt.some(
			(date) => date.getTime() > approvedAt,
		);
		if (pr.baseUpdatedSinceApproval || securityAfterApproval) {
			return { action: 'replace', openSuccessor: !input.nightlyFailing };
		}
		return { action: 'none', reason: 'frozen' };
	}

	if (input.fingerprint === null) {
		return { action: 'none', reason: 'nothing-to-release' };
	}

	if (pr !== null) {
		return pr.fingerprint === input.fingerprint
			? { action: 'none', reason: 'up-to-date' }
			: { action: 'update' };
	}

	if (input.nightlyFailing) {
		return { action: 'none', reason: 'nightly-failing' };
	}
	if (input.manual) {
		return { action: 'create' };
	}
	if (input.declinedFingerprints.includes(input.fingerprint)) {
		return { action: 'none', reason: 'declined' };
	}

	const now = input.now.getTime();
	if (input.securityLandedAt.length > 0) {
		const first = Math.min(...input.securityLandedAt.map((date) => date.getTime()));
		return now - first >= input.securityBatchMinutes * 60 * 1000
			? { action: 'create' }
			: { action: 'none', reason: 'security-batching' };
	}
	if (
		input.userFacingSince !== null &&
		now - input.userFacingSince.getTime() >= RELEASE_WAIT_MS
	) {
		return { action: 'create' };
	}
	return { action: 'none', reason: 'waiting' };
}
