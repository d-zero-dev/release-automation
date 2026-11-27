import type { GitHub } from '../io/github.js';
import type { NightlyRun } from '../nightly.js';

import { GitHubError } from '../io/github.js';

import { FULL_CI_WORKFLOW, NIGHTLY_WORKFLOW } from './context.js';

/**
 * Reads when the Nightly workflow was added to the repository, which
 * {@link isStale} counts from while a line has no finished run.
 * @param gh - The client
 * @returns The time, or undefined when the repository has no Nightly workflow
 * @example
 * isStale(runs, new Date(), await nightlyAddedAt(gh));
 */
export async function nightlyAddedAt(gh: GitHub): Promise<Date | undefined> {
	try {
		const workflow = await gh.rest<{ created_at: string }>(
			'GET',
			`/repos/{repo}/actions/workflows/${NIGHTLY_WORKFLOW}`,
		);
		return new Date(workflow.created_at);
	} catch (error) {
		if (error instanceof GitHubError && error.status === 404) {
			return undefined;
		}
		throw error;
	}
}

/**
 * Reads the finished Nightly runs of a line: the Full CI runs started by
 * `workflow_dispatch` on the line's branch, newest first. A run that was
 * cancelled or skipped tells nothing about the code and is left out.
 * @param gh - The client
 * @param branch - The branch of the line
 * @returns The runs
 * @example
 * isBlocked(await nightlyRuns(gh, 'dev'));
 */
export async function nightlyRuns(gh: GitHub, branch: string): Promise<NightlyRun[]> {
	const response = await gh.rest<{
		workflow_runs: {
			head_sha: string;
			conclusion: string | null;
			updated_at: string;
		}[];
	}>(
		'GET',
		`/repos/{repo}/actions/workflows/${FULL_CI_WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&status=completed&per_page=20`,
	);
	return response.workflow_runs
		.filter((run) => run.conclusion === 'success' || run.conclusion === 'failure')
		.map((run) => ({
			sha: run.head_sha,
			conclusion: run.conclusion as NightlyRun['conclusion'],
			finishedAt: new Date(run.updated_at),
		}));
}
