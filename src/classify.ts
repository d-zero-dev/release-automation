import type { Version } from './semver.js';
import type {
	LineEntry,
	LineRole,
	LinesFile,
	MaintenancePhase,
	PrereleaseId,
	PublishMode,
	ReviewMode,
} from './types.js';

import {
	compareVersions,
	formatVersion,
	parseVersion,
	stableTagVersion,
} from './semver.js';
import { addMonths, formatDate } from './support-end.js';
import {
	CURRENT_BRANCH,
	CURRENT_PUBLISH_BRANCH,
	DEFAULT_SUPPORT_MONTHS,
} from './types.js';

/**
 * What `classify` reads from a repository. Every field is a fact that a
 * file, a branch or a tag states; nothing here is a judgement.
 * @example
 * const facts: RepoFacts = {
 * 	devVersion: '5.4.2',
 * 	lernaVersion: '5.4.2',
 * 	rootPrivate: true,
 * 	packageManager: 'yarn@4.18.1',
 * 	branches: ['dev', 'main', 'v6'],
 * 	stableTags: [{ tag: 'v5.4.2', date: new Date('2026-10-01T00:00:00Z') }],
 * 	codeowners: ['@alice', '@bob'],
 * 	linesFile: null,
 * 	now: new Date('2026-11-25T00:00:00Z'),
 * };
 */
export interface RepoFacts {
	/** The version on `dev` (`lerna.json`, or the root `package.json` without Lerna). */
	readonly devVersion: string | null;
	/** `lerna.json#version`, or `null` without `lerna.json`. */
	readonly lernaVersion: string | null;
	/** Whether the root `package.json` is private. */
	readonly rootPrivate: boolean;
	/** `package.json#packageManager`. */
	readonly packageManager: string | null;
	/** The branch names on the remote. */
	readonly branches: readonly string[];
	/** The `vX.Y.Z` tags and the date each points at. Other tags may be included; they are ignored. */
	readonly stableTags: readonly { readonly tag: string; readonly date: Date }[];
	/** The owners named in `.github/CODEOWNERS`, or `null` when it does not exist. */
	readonly codeowners: readonly string[] | null;
	/** `.github/release-lines.json`, or `null` when it does not exist. */
	readonly linesFile: LinesFile | null;
	readonly now: Date;
}

/**
 * A release line.
 * @example
 * const line: ClassifiedLine = {
 * 	branch: 'v3',
 * 	role: 'previous',
 * 	major: 3,
 * 	publishBranch: 'v3',
 * 	stage: 'stable',
 * 	phase: 'security',
 * 	successorStable: new Date('2026-04-01T00:00:00Z'),
 * 	supportEnd: new Date('2027-04-01T00:00:00Z'),
 * };
 */
export interface ClassifiedLine {
	readonly branch: string;
	readonly role: LineRole;
	readonly major: number;
	/** The branch Release PRs of the line target. */
	readonly publishBranch: string;
	/** The prerelease stage of the current line, `stable` otherwise; `null` when unknown. */
	readonly stage: PrereleaseId | 'stable' | null;
	/** What a previous line accepts; `null` for the other roles. */
	readonly phase: MaintenancePhase | null;
	/** The date of the first stable release of a later major; `null` when there is none yet. */
	readonly successorStable: Date | null;
	/** The end of support of a previous line; `null` while it has no stable successor. */
	readonly supportEnd: Date | null;
}

/**
 * A state that stops the setup until it is resolved, or a change the setup
 * makes. Each carries the one resolution it calls for.
 * @example
 * const finding: Finding = { code: 'lock-branch', branch: 'v2', message: 'v2 is not a line; lock the branch' };
 */
export interface Finding {
	readonly code:
		| 'missing-codeowners'
		| 'missing-publish-command'
		| 'invalid-dev-version'
		| 'invalid-lines-file'
		| 'next-while-prerelease'
		| 'multiple-next'
		| 'branch-same-as-current'
		| 'branch-on-independent'
		| 'lock-branch'
		| 'create-branch'
		| 'line-ended'
		| 'write-lines-file';
	readonly branch?: string;
	/** The tag a branch is created from. */
	readonly fromTag?: string;
	readonly message: string;
}

/**
 * The result of {@link classify}.
 * @example
 * const result = classify(facts);
 * if (result.errors.length > 0) {
 * 	// stop the setup and resolve them first
 * }
 */
export interface Classification {
	readonly publishMode: PublishMode | null;
	readonly review: { readonly mode: ReviewMode; readonly approvals: 0 | 1 } | null;
	/** The age gate setting the package manager takes, or `null` when it supports none. */
	readonly ageGate: {
		readonly file: string;
		readonly key: string;
		readonly value: string;
	} | null;
	/**
	 * Where the lines come from: `file` when the lines file exists and is the
	 * definition, `proposal` when there is none and the lines are proposed from
	 * the tags for a person to confirm.
	 */
	readonly source: 'file' | 'proposal';
	/** The lines once the actions are applied. Ended lines are not included. */
	readonly lines: readonly ClassifiedLine[];
	/** The lines file to write: the proposal, or the file as it is. */
	readonly expectedLinesFile: LinesFile;
	/** States that stop the setup. */
	readonly errors: readonly Finding[];
	/** Changes the setup makes. */
	readonly actions: readonly Finding[];
}

const LINE_BRANCH = /^v(0|[1-9]\d*)$/;

/**
 * Decides how the rules apply to a repository: its publishing mode, review
 * mode, age gate, and release lines, with the errors that stop the setup and
 * the actions that bring the repository into shape.
 *
 * The lines file is the definition of the lines. A person confirms it once
 * per repository: without the file, the lines are proposed from the branches
 * and the tags (`source: 'proposal'`) for that confirmation. With the file,
 * its lines are used, and only what contradicts the branches and the version
 * on `dev` is an error. Tags are an imperfect record of the past (a history
 * may lack tags, or carry those of an older project), so they never override
 * the file.
 * @param facts - What the repository states
 * @returns The classification
 * @example
 * const { lines, errors, actions } = classify(facts);
 */
export function classify(facts: RepoFacts): Classification {
	const errors: Finding[] = [];
	const actions: Finding[] = [];
	const supportMonths = facts.linesFile?.supportMonths ?? DEFAULT_SUPPORT_MONTHS;

	const publishMode = decidePublishMode(facts);
	if (publishMode === 'custom' && !facts.linesFile?.publishCommand) {
		errors.push({
			code: 'missing-publish-command',
			message:
				'The repository publishes no npm package; set "publishCommand" in .github/release-lines.json',
		});
	}

	const review = decideReview(facts.codeowners);
	if (review === null) {
		errors.push({
			code: 'missing-codeowners',
			message: 'Decide the code owners and write .github/CODEOWNERS',
		});
	}

	const branchMajors = facts.branches
		.map((branch) => ({ branch, match: LINE_BRANCH.exec(branch) }))
		.filter(
			(entry): entry is { branch: string; match: RegExpExecArray } =>
				entry.match !== null,
		)
		.map(({ branch, match }) => ({ branch, major: Number(match[1]) }))
		.toSorted((a, b) => a.major - b.major);

	const stableByMajor = new Map<
		number,
		{ tag: string; date: Date; version: Version }[]
	>();
	for (const { tag, date } of facts.stableTags) {
		const version = stableTagVersion(tag);
		if (version) {
			stableByMajor.set(version.major, [
				...(stableByMajor.get(version.major) ?? []),
				{ tag, date, version },
			]);
		}
	}
	const successorFromTags = (major: number) =>
		earliest(
			[...stableByMajor.entries()]
				.filter(([m]) => m > major)
				.flatMap(([, list]) => list.map(({ date }) => date)),
		);
	const previousLine = (
		branch: string,
		major: number,
		successorStable: Date | null,
	): ClassifiedLine => {
		const supportEnd = successorStable ? addMonths(successorStable, supportMonths) : null;
		const phase: MaintenancePhase =
			supportEnd === null
				? 'fixes'
				: facts.now.getTime() < supportEnd.getTime()
					? 'security'
					: 'ended';
		return {
			branch,
			role: 'previous',
			major,
			publishBranch: branch,
			stage: 'stable',
			phase,
			successorStable,
			supportEnd,
		};
	};
	const newestTag = (major: number) =>
		(stableByMajor.get(major) ?? []).toSorted((a, b) =>
			compareVersions(b.version, a.version),
		)[0]?.tag;

	const lines: ClassifiedLine[] = [];

	if (publishMode === 'lerna-independent') {
		lines.push(currentLine(0, null));
		for (const { branch } of branchMajors) {
			errors.push({
				code: 'branch-on-independent',
				branch,
				message: `${branch}: a repository in Lerna independent mode has one line; delete or rename the branch`,
			});
		}
		return finish('proposal-or-file');
	}

	let dev: Version;
	try {
		dev = parseVersion(facts.devVersion ?? '');
	} catch {
		errors.push({
			code: 'invalid-dev-version',
			message: `The version on dev is not a valid version: ${facts.devVersion ?? '(none)'}`,
		});
		return finish('proposal-or-file');
	}
	lines.push(currentLine(dev.major, dev.pre?.id ?? 'stable'));

	for (const { branch } of branchMajors.filter(({ major }) => major === dev.major)) {
		errors.push({
			code: 'branch-same-as-current',
			branch,
			message: `${branch}: dev carries v${dev.major}; delete or rename the branch`,
		});
	}

	if (facts.linesFile !== null) {
		fromFile(facts.linesFile, dev);
		return finish('file');
	}

	const nextBranches = branchMajors.filter(({ major }) => major > dev.major);
	for (const [index, { branch, major }] of nextBranches.entries()) {
		if (!checkNext(branch, index, nextBranches[0]?.branch)) {
			continue;
		}
		lines.push({
			branch,
			role: 'next',
			major,
			publishBranch: branch,
			stage: null,
			phase: null,
			successorStable: null,
			supportEnd: null,
		});
	}

	const branchByMajor = new Map(
		branchMajors.filter(({ major }) => major < dev.major).map((b) => [b.major, b.branch]),
	);
	const olderMajors = [...new Set([...branchByMajor.keys(), ...stableByMajor.keys()])]
		.filter((major) => major < dev.major)
		.toSorted((a, b) => b - a);
	for (const major of olderMajors) {
		const branch = branchByMajor.get(major);
		if ((stableByMajor.get(major) ?? []).length === 0) {
			if (branch !== undefined) {
				actions.push({
					code: 'lock-branch',
					branch,
					message: `${branch}: v${major} has no stable release, so it is not a line; lock the branch and keep it`,
				});
			}
			continue;
		}
		const line = previousLine(`v${major}`, major, successorFromTags(major));
		if (line.phase === 'ended') {
			if (branch !== undefined) {
				actions.push({
					code: 'lock-branch',
					branch,
					message: `${branch}: support ended; lock the branch and keep it`,
				});
			}
			continue;
		}
		if (branch === undefined) {
			const tag = newestTag(major);
			actions.push({
				code: 'create-branch',
				branch: line.branch,
				...(tag ? { fromTag: tag } : {}),
				message: `${line.branch}: v${major} is still supported; create the branch from ${tag ?? '?'}`,
			});
		}
		lines.push(line);
	}
	return finish('proposal-or-file');

	/**
	 * Takes the lines from the file and reports what contradicts the facts.
	 * @param file - The lines file
	 * @param current - The version on `dev`
	 */
	function fromFile(file: LinesFile, current: Version): void {
		const entries = file.lines;
		if (
			!entries.some(({ branch, role }) => branch === CURRENT_BRANCH && role === 'current')
		) {
			invalid(`the file needs { "branch": "${CURRENT_BRANCH}", "role": "current" }`);
		}
		const nextEntries = entries.filter(({ role }) => role === 'next');
		for (const entry of entries) {
			if (entry.role === 'current') {
				if (entry.branch !== CURRENT_BRANCH) {
					invalid(`${entry.branch}: the current line is on ${CURRENT_BRANCH}`);
				}
				continue;
			}
			const major = Number(LINE_BRANCH.exec(entry.branch)?.[1] ?? Number.NaN);
			if (Number.isNaN(major)) {
				invalid(`${entry.branch}: a ${entry.role} line is on a v<major> branch`);
				continue;
			}
			if (entry.role === 'next') {
				if (major <= current.major) {
					invalid(`${entry.branch}: a next-major line is above v${current.major}`);
					continue;
				}
				if (
					!checkNext(entry.branch, nextEntries.indexOf(entry), nextEntries[0]?.branch)
				) {
					continue;
				}
				if (!facts.branches.includes(entry.branch)) {
					invalid(`${entry.branch}: the branch does not exist`);
				}
				lines.push({
					branch: entry.branch,
					role: 'next',
					major,
					publishBranch: entry.branch,
					stage: null,
					phase: null,
					successorStable: null,
					supportEnd: null,
				});
				continue;
			}
			if (major >= current.major) {
				invalid(`${entry.branch}: a previous line is below v${current.major}`);
				continue;
			}
			const line = previousLine(
				entry.branch,
				major,
				successorDate(entry) ?? successorFromTags(major),
			);
			if (!facts.branches.includes(entry.branch)) {
				const tag = newestTag(major);
				if (tag === undefined) {
					invalid(
						`${entry.branch}: the branch does not exist and no v${major}.x.y tag to create it from`,
					);
					continue;
				}
				actions.push({
					code: 'create-branch',
					branch: entry.branch,
					fromTag: tag,
					message: `${entry.branch}: create the branch from ${tag}`,
				});
			}
			if (line.phase === 'ended') {
				actions.push({
					code: 'line-ended',
					branch: entry.branch,
					message: `${entry.branch}: support ended on ${formatDate(line.supportEnd ?? facts.now)}; run the end-of-support work of the major-rotation skill`,
				});
			}
			lines.push(line);
		}
		const listed = new Set(entries.map(({ branch }) => branch));
		for (const { branch, major } of branchMajors) {
			if (!listed.has(branch) && major !== current.major) {
				actions.push({
					code: 'lock-branch',
					branch,
					message: `${branch}: not a line in the lines file; lock the branch and keep it`,
				});
			}
		}
	}

	/**
	 * @param entry - A line of the file
	 * @returns The date the file states, or `null`
	 */
	function successorDate(entry: LineEntry): Date | null {
		if (entry.successorStable === undefined) {
			return null;
		}
		const date = new Date(`${entry.successorStable}T00:00:00Z`);
		if (Number.isNaN(date.getTime())) {
			invalid(`${entry.branch}: "successorStable" is not a YYYY-MM-DD date`);
			return null;
		}
		return date;
	}

	/**
	 * @param branch - A next-major branch
	 * @param index - Its position among the next-major branches
	 * @param first - The first next-major branch
	 * @returns Whether it can be the next-major line
	 */
	function checkNext(branch: string, index: number, first: string | undefined): boolean {
		if (dev.pre !== null) {
			errors.push({
				code: 'next-while-prerelease',
				branch,
				message: `${branch}: the next major cannot start while dev (${formatVersion(dev)}) is a prerelease; delete the branch or release dev as stable first`,
			});
			return false;
		}
		if (index > 0) {
			errors.push({
				code: 'multiple-next',
				branch,
				message: `${branch}: only one next-major line is allowed (${first ?? '?'} is the next major); delete the branch`,
			});
			return false;
		}
		return true;
	}

	/**
	 * @param message - What is wrong with the lines file
	 */
	function invalid(message: string): void {
		errors.push({
			code: 'invalid-lines-file',
			message: `.github/release-lines.json: ${message}`,
		});
	}

	/**
	 * @param major - The major on `dev`
	 * @param stage - Its stage
	 * @returns The current line
	 */
	function currentLine(major: number, stage: ClassifiedLine['stage']): ClassifiedLine {
		return {
			branch: CURRENT_BRANCH,
			role: 'current',
			major,
			publishBranch: CURRENT_PUBLISH_BRANCH,
			stage,
			phase: null,
			successorStable: null,
			supportEnd: null,
		};
	}

	/**
	 * @param mode - `file` when the lines came from the file
	 * @returns The classification
	 */
	function finish(mode: 'file' | 'proposal-or-file'): Classification {
		const source =
			mode === 'file' ? 'file' : facts.linesFile === null ? 'proposal' : 'file';
		const expectedLinesFile: LinesFile =
			source === 'file' && facts.linesFile !== null
				? facts.linesFile
				: {
						...facts.linesFile,
						lines: lines.map(({ branch, role }) => ({ branch, role })),
					};
		if (facts.linesFile === null) {
			actions.push({
				code: 'write-lines-file',
				message:
					'Confirm the proposed lines with a person, then write .github/release-lines.json',
			});
		}
		return {
			publishMode,
			review,
			ageGate: decideAgeGate(facts.packageManager),
			source,
			lines,
			expectedLinesFile,
			errors,
			actions,
		};
	}
}

/**
 * @param facts - The repository facts
 * @returns The publishing mode
 */
function decidePublishMode(facts: RepoFacts): PublishMode {
	if (facts.lernaVersion === 'independent') {
		return 'lerna-independent';
	}
	if (facts.lernaVersion !== null) {
		return 'lerna-fixed';
	}
	return facts.rootPrivate ? 'custom' : 'npm-single';
}

/**
 * A team owner (`@org/team`) counts as more than one person.
 * @param codeowners - The owners, or `null` without the file
 * @returns The review mode and the number of approvals, or `null` without owners
 */
function decideReview(
	codeowners: readonly string[] | null,
): { mode: ReviewMode; approvals: 0 | 1 } | null {
	const owners = codeowners === null ? [] : [...new Set(codeowners)];
	if (owners.length === 0) {
		return null;
	}
	const collaborative = owners.length > 1 || owners.some((owner) => owner.includes('/'));
	return collaborative
		? { mode: 'collaborative', approvals: 1 }
		: { mode: 'solo', approvals: 0 };
}

/**
 * @param packageManager - `package.json#packageManager`
 * @returns The age gate setting, or `null` when the version supports none
 */
function decideAgeGate(
	packageManager: string | null,
): { file: string; key: string; value: string } | null {
	const match = /^(yarn|pnpm)@(\d+)\.(\d+)\.(\d+)/.exec(packageManager ?? '');
	if (!match) {
		return null;
	}
	const [, name, major, minor] = match;
	const atLeast = (m: number, n: number) =>
		Number(major) > m || (Number(major) === m && Number(minor) >= n);
	if (name === 'yarn' && atLeast(4, 10)) {
		return { file: '.yarnrc.yml', key: 'npmMinimalAgeGate', value: '3d' };
	}
	if (name === 'pnpm' && atLeast(10, 16)) {
		return { file: 'pnpm-workspace.yaml', key: 'minimumReleaseAge', value: '4320' };
	}
	return null;
}

/**
 * @param dates - Dates
 * @returns The earliest, or `null` for none
 */
function earliest(dates: readonly Date[]): Date | null {
	let result: Date | null = null;
	for (const date of dates) {
		if (result === null || date.getTime() < result.getTime()) {
			result = date;
		}
	}
	return result;
}
