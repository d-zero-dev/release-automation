import type { ClassifiedLine } from './classify.js';

import { LOCKFILE_STOP_RULE } from './lines-check.js';
import { parseVersion } from './semver.js';
import { formatDate } from './support-end.js';

/** Days before a line's support end that its end-of-support Issue opens. */
export const EOL_NOTICE_DAYS = 14;

/**
 * An Issue the rotation asks for. The marker makes it unique: an Issue whose
 * body already holds the marker is not opened again.
 * @example
 * const issue: RotationIssue = { marker: '<!-- eol:v3:2027-04-01 -->', title: '...', body: '...' };
 */
export interface RotationIssue {
	readonly marker: string;
	readonly title: string;
	readonly body: string;
}

/**
 * Lists the end-of-support Issues due: one per previous line whose support
 * ends within {@link EOL_NOTICE_DAYS} days.
 * @param lines - The lines
 * @param now - The current time
 * @returns The Issues to open (when not open yet)
 * @example
 * eolIssues(classify(facts).lines, new Date());
 */
export function eolIssues(lines: readonly ClassifiedLine[], now: Date): RotationIssue[] {
	return lines.flatMap((line) => {
		if (line.role !== 'previous' || line.supportEnd === null) {
			return [];
		}
		const notice = line.supportEnd.getTime() - EOL_NOTICE_DAYS * 24 * 60 * 60 * 1000;
		if (now.getTime() < notice) {
			return [];
		}
		const end = formatDate(line.supportEnd);
		const marker = `<!-- release-automation:eol:${line.branch}:${end} -->`;
		return [
			{
				marker,
				title: `End of support for v${line.major} on ${end}`,
				body: [
					marker,
					'',
					`Support for v${line.major} (\`${line.branch}\`) ends on ${end}.`,
					'',
					'Prepare the changes with the `major-rotation` skill. Merge them and apply the repository settings on or after the end date, not before:',
					'',
					`- remove \`${line.branch}\` from \`.github/release-lines.json\`, Renovate, the workflows and \`SECURITY.md\``,
					`- lock the \`${line.branch}\` branch and keep it and its tags`,
					'',
					'Close this Issue when every change is applied and verified.',
					'',
				].join('\n'),
			},
		];
	});
}

/**
 * Tells whether a release is the first stable release of its major, which
 * starts the rotation of the lines.
 * @param version - The released version
 * @param stableTags - The tags that existed before the release
 * @returns Whether no stable release of the major existed before
 * @example
 * isFirstStableOfMajor('5.0.0', ['v4.2.0']); // true
 */
export function isFirstStableOfMajor(
	version: string,
	stableTags: readonly string[],
): boolean {
	const parsed = parseVersion(version);
	if (parsed.pre !== null) {
		return false;
	}
	return !stableTags.some((tag) =>
		new RegExp(String.raw`^v${parsed.major}\.\d+\.\d+$`).test(tag),
	);
}

/**
 * The Issue that asks for the rotation after the first stable release of a major.
 * @param input - The release
 * @param input.version - The released version
 * @param input.publishedAt - When the publish was verified
 * @param input.verified - What was verified, one line per package
 * @param input.lockfileStop - The result of stopping the lock file maintenance of the older lines
 * @returns The Issue
 * @example
 * rotationIssue({ version: '5.0.0', publishedAt: new Date(), verified: ['a@5.0.0 latest'], lockfileStop: 'stopped on v4' });
 */
export function rotationIssue(input: {
	readonly version: string;
	readonly publishedAt: Date;
	readonly verified: readonly string[];
	readonly lockfileStop: string;
}): RotationIssue {
	const major = parseVersion(input.version).major;
	const marker = `<!-- release-automation:rotation:v${major} -->`;
	return {
		marker,
		title: `Rotate the release lines after v${input.version}`,
		body: [
			marker,
			'',
			`v${input.version} was published on ${input.publishedAt.toISOString()}.`,
			'',
			'### Verified on the registry',
			'',
			...input.verified.map((entry) => `- ${entry}`),
			'',
			'### Lock file maintenance of the older lines',
			'',
			input.lockfileStop,
			'',
			'### What is left',
			'',
			'Hand this Issue to an agent with the `major-rotation` skill. It updates the lines file, Renovate, the workflows, the Nightly, `SECURITY.md`, the documents and the rulesets for the new lines.',
			'',
			'Close this Issue when every change is applied and verified.',
			'',
		].join('\n'),
	};
}

/**
 * Returns `renovate.json` with lock file maintenance stopped on the given
 * branches (on top of the branches already stopped), through the rule
 * {@link LOCKFILE_STOP_RULE}. Applying it twice gives the same result.
 * @param renovate - The parsed `renovate.json`
 * @param branches - The branches to stop
 * @returns The new configuration
 * @example
 * withLockfileStop({ packageRules: [] }, ['v4']).packageRules;
 * // [{ description: LOCKFILE_STOP_RULE, matchBaseBranches: ['v4'], matchUpdateTypes: ['lockFileMaintenance'], enabled: false }]
 */
export function withLockfileStop(
	renovate: Readonly<Record<string, unknown>>,
	branches: readonly string[],
): Record<string, unknown> {
	const rules = Array.isArray(renovate['packageRules'])
		? (renovate['packageRules'] as Record<string, unknown>[])
		: [];
	const existing = rules.find((rule) => rule['description'] === LOCKFILE_STOP_RULE);
	const stopped = Array.isArray(existing?.['matchBaseBranches'])
		? (existing['matchBaseBranches'] as string[])
		: [];
	const rule = {
		description: LOCKFILE_STOP_RULE,
		matchBaseBranches: [...new Set([...stopped, ...branches])].toSorted(),
		matchUpdateTypes: ['lockFileMaintenance'],
		enabled: false,
	};
	return {
		...renovate,
		packageRules: existing
			? rules.map((r) => (r === existing ? rule : r))
			: [...rules, rule],
	};
}
