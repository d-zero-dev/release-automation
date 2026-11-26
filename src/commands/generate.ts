import type { ClassifiedLine } from '../classify.js';
import type { LocalGit } from '../io/git.js';
import type { Promotion } from '../next-version.js';
import type { PublishMode } from '../types.js';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { prependRelease } from '../changelog.js';
import { parseCommit } from '../conventional-commit.js';
import { runShell } from '../io/exec.js';
import { versionAt } from '../io/repo.js';
import { nextVersion } from '../next-version.js';
import { withLockfileStop } from '../rotation.js';
import { formatDate } from '../support-end.js';

/**
 * The result of generating a release commit.
 * @example
 * const result: Generated = { ok: true, version: '1.2.4', message: 'chore(release): v1.2.4' };
 */
export type Generated =
	| { readonly ok: true; readonly version: string | null; readonly message: string }
	| { readonly ok: false; readonly reason: string };

/**
 * Applies the release changes of a line to the working tree, which is checked
 * out at the line's head: the version, the changelog, and, for the first
 * stable release of a major on the current line, the end of lock file
 * maintenance on the previous lines that turn security-only with it. Does not
 * commit. The same input gives the same tree, apart from the dates in the
 * changelog, so the verification can generate it again and compare.
 * @param input - The line and what to release
 * @param input.git - Git access to the checkout
 * @param input.mode - The publishing mode
 * @param input.line - The line
 * @param input.lines - Every line
 * @param input.baseline - The revision of the last release
 * @param input.promote - The stage a person asked for
 * @param input.now - The date written into the changelog
 * @returns The version, or why there is none
 * @example
 * generateRelease({ git, mode: 'lerna-fixed', line, lines, baseline: 'origin/main', promote: null, now: new Date() });
 */
export function generateRelease(input: {
	readonly git: LocalGit;
	readonly mode: PublishMode;
	readonly line: ClassifiedLine;
	readonly lines: readonly ClassifiedLine[];
	readonly baseline: string;
	readonly promote: Promotion | null;
	readonly now: Date;
}): Generated {
	const { git, mode, line } = input;
	const cwd = git.cwd;

	if (mode === 'lerna-independent') {
		if (input.promote !== null) {
			return { ok: false, reason: 'Lerna independent mode has no stage to promote' };
		}
		runShell(
			'yarn lerna version --conventional-commits --exact --no-git-tag-version --no-push --yes',
			cwd,
		);
		runShell('yarn install --mode=update-lockfile', cwd);
		return { ok: true, version: null, message: 'chore(release): publish' };
	}

	const current = versionAt(git, 'HEAD');
	if (current === null) {
		return { ok: false, reason: 'No version on the line' };
	}
	const commits = git
		.messages(input.baseline, 'HEAD')
		.map(({ message }) => parseCommit(message));
	const next = nextVersion({
		current,
		commits,
		promote: input.promote,
		lineMajor: line.major,
	});
	if (!next.ok) {
		return { ok: false, reason: next.message };
	}

	if (mode === 'lerna-fixed') {
		const prerelease = next.version.includes('-') ? ' --force-publish' : '';
		runShell(
			`yarn lerna version ${next.version} --conventional-commits --exact --no-git-tag-version --no-push --yes${prerelease}`,
			cwd,
		);
		runShell('yarn install --mode=update-lockfile', cwd);
	} else {
		const manifestPath = path.join(cwd, 'package.json');
		const manifest = readFileSync(manifestPath, 'utf8');
		writeFileSync(
			manifestPath,
			manifest.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next.version}$2`),
		);
		const changelogPath = path.join(cwd, 'CHANGELOG.md');
		const counted = git
			.messages(input.baseline, 'HEAD')
			.filter(({ message }) => {
				const parsed = parseCommit(message);
				return (
					parsed.breaking || ['feat', 'fix', 'perf', 'revert'].includes(parsed.type ?? '')
				);
			})
			.map(({ sha, message }) => `${message.split('\n')[0]} (${sha.slice(0, 7)})`);
		writeFileSync(
			changelogPath,
			prependRelease(
				existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : null,
				{
					version: next.version,
					date: formatDate(input.now),
					entries: counted,
				},
			),
		);
	}

	// The first stable release of a major on the current line graduates its
	// own prerelease (X.0.0-rc.n becomes X.0.0).
	const firstStable =
		line.role === 'current' &&
		/^\d+\.0\.0$/.test(next.version) &&
		current.startsWith(`${next.version}-`);
	if (firstStable) {
		const turning = input.lines
			.filter((other) => other.role === 'previous' && other.phase === 'fixes')
			.map((other) => other.branch);
		if (turning.length > 0) {
			const renovatePath = path.join(cwd, '.github/renovate.json');
			const text = readFileSync(renovatePath, 'utf8');
			const indent = /^(\s+)"/m.exec(text)?.[1] ?? '\t';
			const updated = withLockfileStop(
				JSON.parse(text) as Record<string, unknown>,
				turning,
			);
			writeFileSync(renovatePath, `${JSON.stringify(updated, null, indent)}\n`);
		}
	}

	return { ok: true, version: next.version, message: `chore(release): v${next.version}` };
}
