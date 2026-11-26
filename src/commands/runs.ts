import type { GitHub } from '../io/github.js';
import type { NightlyRun } from '../nightly.js';

import { FULL_CI_WORKFLOW } from './context.js';

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
