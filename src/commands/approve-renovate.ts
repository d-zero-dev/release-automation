import { canApproveRenovatePr } from '../pr-checks.js';

import { github, summary } from './context.js';

/**
 * Approves a Renovate pull request with the Approve App's token
 * (`APPROVE_APP_TOKEN`) when {@link canApproveRenovatePr} allows it. Reads
 * everything from the API, so it runs on `pull_request_target` without
 * checking out the pull request.
 * @param options - The pull request
 * @param options.pr - Its number
 * @example
 * await approveRenovateCommand({ pr: 42 });
 */
export async function approveRenovateCommand(options: {
	readonly pr: number;
}): Promise<void> {
	const gh = github('APPROVE_APP_TOKEN');
	const pr = await gh.rest<{
		user: { login: string };
		body: string | null;
		labels: { name: string }[];
		head: { sha: string };
	}>('GET', `/repos/{repo}/pulls/${options.pr}`);
	const commits = await gh.paginate<{
		author: { login: string } | null;
		commit: { verification: { verified: boolean } | null };
	}>(`/repos/{repo}/pulls/${options.pr}/commits`);
	const result = canApproveRenovatePr({
		author: pr.user.login,
		commits: commits.map((commit) => ({
			author: commit.author?.login ?? null,
			verified: commit.commit.verification?.verified === true,
		})),
		body: pr.body ?? '',
		labels: pr.labels.map(({ name }) => name),
	});
	if (!result.ok) {
		await summary(`#${options.pr}: not approved (${result.reasons.join('; ')})`);
		return;
	}
	await gh.rest('POST', `/repos/{repo}/pulls/${options.pr}/reviews`, {
		event: 'APPROVE',
		commit_id: pr.head.sha,
	});
	await summary(`#${options.pr}: approved`);
}
