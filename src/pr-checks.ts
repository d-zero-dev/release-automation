/**
 * The facts about a pull request that the checks read. They come from the
 * GitHub API, not from the pull request's own files.
 * @example
 * const pr: PrFacts = {
 * 	author: 'renovate[bot]',
 * 	commits: [{ author: 'renovate[bot]', verified: true }],
 * 	body: '**Automerge**: Enabled.',
 * 	labels: [],
 * };
 */
export interface PrFacts {
	readonly author: string;
	/** Each commit's GitHub author login and whether its signature is verified. */
	readonly commits: readonly {
		readonly author: string | null;
		readonly verified: boolean;
	}[];
	readonly body: string;
	readonly labels: readonly string[];
}

/** The login of Renovate's pull requests and commits. */
export const RENOVATE_LOGIN = 'renovate[bot]';

/** The label of a Renovate pull request that a person reviews. */
export const MANUAL_REVIEW_LABEL = 'manual-review';

/**
 * The result of a check.
 * @example
 * const result: CheckResult = { ok: false, reasons: ['a commit is not by renovate[bot]'] };
 */
export interface CheckResult {
	readonly ok: boolean;
	readonly reasons: readonly string[];
}

/**
 * Tells whether the Approve App may approve a Renovate pull request: Renovate
 * opened it, every commit is Renovate's and signed, Renovate merges it by
 * itself, and it is not one a person reviews (the major update of a package
 * the repository excepts from automerge carries {@link MANUAL_REVIEW_LABEL}).
 * A pull request someone pushed to is a person's change and gets no approval.
 * @param pr - The pull request
 * @returns Whether to approve, and why not
 * @example
 * canApproveRenovatePr(pr).ok; // true
 */
export function canApproveRenovatePr(pr: PrFacts): CheckResult {
	const reasons: string[] = [];
	if (pr.author !== RENOVATE_LOGIN) {
		reasons.push(`opened by ${pr.author}, not ${RENOVATE_LOGIN}`);
	}
	if (pr.commits.length === 0) {
		reasons.push('has no commits');
	}
	for (const [index, commit] of pr.commits.entries()) {
		if (commit.author !== RENOVATE_LOGIN) {
			reasons.push(`commit ${index + 1} is by ${commit.author ?? 'an unknown author'}`);
		} else if (!commit.verified) {
			reasons.push(`commit ${index + 1} is not signed`);
		}
	}
	if (!/\*\*Automerge\*\*: Enabled\./.test(pr.body)) {
		reasons.push('Renovate does not merge it by itself');
	}
	if (pr.labels.includes(MANUAL_REVIEW_LABEL)) {
		reasons.push(`labelled ${MANUAL_REVIEW_LABEL}`);
	}
	return { ok: reasons.length === 0, reasons };
}

/**
 * Tells whether a pull request comes from the Release PR generator: the
 * Release App opened it and wrote every commit. Whether its content matches
 * a fresh generation is checked separately, against the target branch.
 * @param pr - The pull request
 * @param appLogin - The login of the Release App (`<slug>[bot]`)
 * @returns Whether its origin is the generator, and why not
 * @example
 * releasePrOrigin(pr, 'd-zero-release[bot]').ok; // true
 */
export function releasePrOrigin(pr: PrFacts, appLogin: string): CheckResult {
	const reasons: string[] = [];
	if (pr.author !== appLogin) {
		reasons.push(`opened by ${pr.author}, not ${appLogin}`);
	}
	if (pr.commits.length === 0) {
		reasons.push('has no commits');
	}
	for (const [index, commit] of pr.commits.entries()) {
		if (commit.author !== appLogin) {
			reasons.push(`commit ${index + 1} is by ${commit.author ?? 'an unknown author'}`);
		}
	}
	return { ok: reasons.length === 0, reasons };
}
