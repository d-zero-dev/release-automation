import type { ClassifiedLine } from './classify.js';

import { parse as parseYaml } from 'yaml';

import { formatDate } from './support-end.js';
import { CURRENT_PUBLISH_BRANCH } from './types.js';

/**
 * The description of the Renovate rule that limits previous lines to
 * vulnerability fixes and lock file maintenance. `lines check` finds the rule
 * by it.
 */
export const PREVIOUS_LINES_RULE =
	'release-automation: previous lines take vulnerability fixes and lock file maintenance only';

/**
 * The description of the Renovate rule that stops lock file maintenance on
 * previous lines whose successor is stable.
 */
export const LOCKFILE_STOP_RULE =
	'release-automation: lock file maintenance stopped on security-only lines';

/** The name of the job that aggregates the checks of the Minimum CI. */
export const CI_OK_JOB = 'ci-ok';

/**
 * The files `lines check` compares with the lines.
 * @example
 * const files: CheckedFiles = { renovate: {}, workflows: [], securityMd: null, preCommit: null };
 */
export interface CheckedFiles {
	/** `.github/renovate.json`, parsed. */
	readonly renovate: unknown;
	/** Every `.github/workflows/*.yml`. */
	readonly workflows: readonly { readonly path: string; readonly content: string }[];
	/** `SECURITY.md`, or `null`. */
	readonly securityMd: string | null;
	/** `.husky/pre-commit`, or `null`. */
	readonly preCommit: string | null;
}

/**
 * Compares the files that name branches with the lines, and reports every
 * difference. Only what the files state is compared: a check whose result
 * changes with the date would fail unrelated pull requests on the day a
 * line's support ends. The support end dates come from tags, which do not
 * change with the date.
 * @param lines - The lines, as `classify` derives them
 * @param files - The files to compare
 * @returns The differences; empty when everything agrees
 * @example
 * checkLines(classify(facts).lines, files); // []
 */
export function checkLines(
	lines: readonly ClassifiedLine[],
	files: CheckedFiles,
): string[] {
	const problems: string[] = [];
	const lineBranches = lines.map(({ branch }) => branch);
	const previous = lines
		.filter(({ role }) => role === 'previous')
		.map(({ branch }) => branch);
	const publishBranches = lines.some(({ role }) => role === 'current')
		? [...lineBranches, CURRENT_PUBLISH_BRANCH]
		: lineBranches;

	const renovate = asRecord(files.renovate);
	const bases = asStrings(renovate['baseBranchPatterns']);
	if (!sameSet(bases, lineBranches)) {
		problems.push(
			`renovate.json baseBranchPatterns is [${bases.join(', ')}]; the lines are [${lineBranches.join(', ')}]`,
		);
	}
	const rules = Array.isArray(renovate['packageRules'])
		? renovate['packageRules'].map(asRecord)
		: [];
	const previousRule = rules.find((rule) => rule['description'] === PREVIOUS_LINES_RULE);
	const previousRuleBranches = asStrings(previousRule?.['matchBaseBranches']);
	if (previous.length > 0 && (!previousRule || previousRule['enabled'] !== false)) {
		problems.push(
			`renovate.json has no packageRule "${PREVIOUS_LINES_RULE}" with enabled: false`,
		);
	} else if (!sameSet(previousRuleBranches, previous)) {
		problems.push(
			`renovate.json "${PREVIOUS_LINES_RULE}" matches [${previousRuleBranches.join(', ')}]; the previous lines are [${previous.join(', ')}]`,
		);
	}
	const stopRule = rules.find((rule) => rule['description'] === LOCKFILE_STOP_RULE);
	for (const branch of asStrings(stopRule?.['matchBaseBranches'])) {
		if (!previous.includes(branch)) {
			problems.push(
				`renovate.json "${LOCKFILE_STOP_RULE}" names ${branch}, which is not a previous line`,
			);
		}
	}

	let ciFound = false;
	for (const workflow of files.workflows) {
		let doc: Record<string, unknown>;
		try {
			doc = asRecord(parseYaml(workflow.content));
		} catch (error) {
			problems.push(`${workflow.path}: ${String(error)}`);
			continue;
		}
		const on = asRecord(doc['on']);
		for (const event of ['pull_request', 'pull_request_target', 'push']) {
			for (const branch of asStrings(asRecord(on[event])['branches'])) {
				if (!publishBranches.includes(branch) && !branch.includes('*')) {
					problems.push(
						`${workflow.path}: on.${event}.branches names ${branch}, which is not a line branch`,
					);
				}
			}
		}
		if (CI_OK_JOB in asRecord(doc['jobs'])) {
			ciFound = true;
			const prBranches = asStrings(asRecord(on['pull_request'])['branches']);
			for (const branch of publishBranches) {
				if (!prBranches.includes(branch)) {
					problems.push(`${workflow.path}: on.pull_request.branches lacks ${branch}`);
				}
			}
			if (!('merge_group' in on)) {
				problems.push(`${workflow.path}: the Minimum CI does not run on merge_group`);
			}
		}
	}
	if (!ciFound) {
		problems.push(`No workflow has a "${CI_OK_JOB}" job`);
	}

	if (files.securityMd === null) {
		problems.push('SECURITY.md does not exist');
	} else {
		const rows = files.securityMd.split('\n');
		for (const line of lines) {
			if (line.role === 'current' && line.stage === null) {
				// Lerna independent mode: the packages have majors of their own, so
				// SECURITY.md states its support without a version table.
				continue;
			}
			const row = rows.find((text) => new RegExp(`\\bv${line.major}\\b`).test(text));
			if (row === undefined) {
				problems.push(`SECURITY.md does not list v${line.major}`);
			} else if (line.supportEnd !== null && !row.includes(formatDate(line.supportEnd))) {
				problems.push(
					`SECURITY.md does not state ${formatDate(line.supportEnd)} as the end of v${line.major}`,
				);
			}
		}
	}

	if (!files.preCommit?.includes('release-automation guard')) {
		problems.push('.husky/pre-commit does not run "release-automation guard"');
	}

	return problems;
}

/**
 * @param value - Any value
 * @returns The value as a record, or an empty one
 */
function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * @param value - Any value
 * @returns The strings of an array (a single string becomes one), or none
 */
function asStrings(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

/**
 * @param a - A list
 * @param b - Another list
 * @returns Whether both hold the same items
 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item) => b.includes(item));
}
