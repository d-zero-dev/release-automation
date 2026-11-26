import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { classify } from '../classify.js';
import { commitMessageError, guardedBranches } from '../guard.js';
import { readFacts, readLinesFile, versionAt } from '../io/repo.js';
import { checkLines } from '../lines-check.js';
import { formatDate } from '../support-end.js';

import { classifiedLines, localGit, summary } from './context.js';

/**
 * Prints the classification of the repository: lines, modes, errors and the
 * actions the setup takes. Reads the remote refs; fetch them first.
 * @param options - Output format
 * @param options.json - Print JSON
 * @returns The exit code: 1 when there are errors
 * @example
 * process.exitCode = classifyCommand({ json: false });
 */
export function classifyCommand(options: { readonly json: boolean }): number {
	const result = classify(readFacts(localGit(), new Date()));
	if (options.json) {
		// oxlint-disable-next-line no-console -- the CLI prints its result
		console.log(JSON.stringify(result, null, 2));
	} else {
		const out = [
			`publish mode: ${result.publishMode ?? '-'}`,
			`review: ${result.review === null ? '-' : `${result.review.mode} (approvals: ${result.review.approvals})`}`,
			`age gate: ${result.ageGate === null ? 'not supported' : `${result.ageGate.file} ${result.ageGate.key}: ${result.ageGate.value}`}`,
			'lines:',
			...result.lines.map(
				(line) =>
					`  ${line.branch} ${line.role} v${line.major} → ${line.publishBranch}${line.stage ? ` [${line.stage}]` : ''}${line.phase ? ` (${line.phase}${line.supportEnd ? ` until ${formatDate(line.supportEnd)}` : ''})` : ''}`,
			),
			'errors:',
			...result.errors.map((finding) => `  ${finding.code}: ${finding.message}`),
			'actions:',
			...result.actions.map((finding) => `  ${finding.code}: ${finding.message}`),
		];
		// oxlint-disable-next-line no-console -- the CLI prints its result
		console.log(out.join('\n'));
	}
	return result.errors.length > 0 ? 1 : 0;
}

/**
 * Compares the files that name branches with the lines (see `checkLines`).
 * @returns The exit code: 1 when they differ
 * @example
 * process.exitCode = await linesCheckCommand();
 */
export async function linesCheckCommand(): Promise<number> {
	const git = localGit();
	const { lines } = classifiedLines(git, new Date());
	const cwd = git.cwd;
	const read = (file: string) => {
		const full = path.join(cwd, file);
		return existsSync(full) ? readFileSync(full, 'utf8') : null;
	};
	const workflowDir = path.join(cwd, '.github/workflows');
	const workflows = existsSync(workflowDir)
		? readdirSync(workflowDir)
				.filter((file) => /\.ya?ml$/.test(file))
				.map((file) => ({
					path: `.github/workflows/${file}`,
					content: readFileSync(path.join(workflowDir, file), 'utf8'),
				}))
		: [];
	const problems = checkLines(lines, {
		renovate: JSON.parse(read('.github/renovate.json') ?? '{}'),
		workflows,
		securityMd: read('SECURITY.md'),
		preCommit: read('.husky/pre-commit'),
	});
	for (const problem of problems) {
		await summary(`- ${problem}`);
	}
	return problems.length > 0 ? 1 : 0;
}

/**
 * Refuses a local commit on a guarded branch, for `.husky/pre-commit`.
 * Reads the lines file of the working tree.
 * @returns The exit code: 1 on a guarded branch
 * @example
 * process.exitCode = guardCommand();
 */
export function guardCommand(): number {
	const git = localGit();
	const lines = readLinesFile(git, null);
	const branch = git.currentBranch();
	if (lines === null || branch === null) {
		return 0;
	}
	if (guardedBranches(lines).includes(branch)) {
		process.stderr.write(
			`${branch} changes through pull requests only. Create a topic branch: git switch -c <name>\n`,
		);
		return 1;
	}
	return 0;
}

/**
 * Checks the commits of a pull request against its target branch (a
 * breaking change on a stable line). Runs in CI.
 * @param options - The range
 * @param options.base - The target branch of the pull request
 * @returns The exit code: 1 when a commit may not land
 * @example
 * process.exitCode = await commitCheckCommand({ base: 'dev' });
 */
export async function commitCheckCommand(options: {
	readonly base: string;
}): Promise<number> {
	const git = localGit();
	const lines =
		readLinesFile(git, `origin/${options.base}`) ?? readLinesFile(git, 'origin/dev');
	if (lines === null) {
		return 0;
	}
	const currentVersion = versionAt(git, 'origin/dev');
	let failed = 0;
	for (const { sha, message } of git.messages(`origin/${options.base}`, 'HEAD')) {
		const error = commitMessageError({
			message,
			target: options.base,
			currentVersion,
			lines,
		});
		if (error !== null) {
			failed++;
			await summary(`${sha.slice(0, 9)}: ${error}`);
		}
	}
	return failed > 0 ? 1 : 0;
}
