import type { Commit, Git } from '../release-content.js';

import { run } from './exec.js';

/**
 * Git access for a checkout, on top of the read access release content needs.
 * Refs of the remote are read as `origin/<branch>`; the caller fetches first.
 * @example
 * const git = createGit(process.cwd());
 * git.remoteBranches(); // ['dev', 'main', 'v3']
 */
export interface LocalGit extends Git {
	readonly cwd: string;
	/** The branch names on `origin`. */
	remoteBranches(): string[];
	/** Every tag with the date of the commit (or the tag object) it points at. */
	tagsWithDates(): { tag: string; date: Date }[];
	/** The commit id of a revision. */
	sha(rev: string): string;
	/** Whether `ancestor` is reachable from `descendant`. */
	isAncestor(ancestor: string, descendant: string): boolean;
	/** The name of the checked-out branch, or `null` when detached. */
	currentBranch(): string | null;
	/** The full messages of the commits in `from..to`, oldest first. */
	messages(from: string, to: string): { sha: string; message: string }[];
	/** Runs git with arguments and returns its output. */
	raw(...args: string[]): string;
	/** Force-pushes a refspec to a GitHub repository as the owner of a token (see {@link pushArgs}). */
	pushAs(token: string, repository: string, refspec: string): void;
}

/**
 * The arguments of a force push to a GitHub repository as the owner of a
 * token. `actions/checkout` leaves the workflow's own token in
 * `http.https://github.com/.extraheader`, and git sends that header in place
 * of the credentials of the URL, so the push would run as
 * `github-actions[bot]` with read access. An empty value of a multi-valued
 * `http.extraHeader` resets the list, and a `-c` option comes last, so the
 * token of the URL is the only credential.
 * @param token - The token, such as a GitHub App installation token
 * @param repository - `owner/name`
 * @param refspec - What to push, such as `HEAD:refs/heads/release/dev`
 * @returns The git arguments
 * @example
 * pushArgs('ghs_x', 'o/r', 'HEAD:refs/heads/b');
 * // ['-c', 'http.https://github.com/.extraheader=', 'push', '--force', 'https://x-access-token:ghs_x@github.com/o/r.git', 'HEAD:refs/heads/b']
 */
export function pushArgs(token: string, repository: string, refspec: string): string[] {
	return [
		'-c',
		'http.https://github.com/.extraheader=',
		'push',
		'--force',
		`https://x-access-token:${token}@github.com/${repository}.git`,
		refspec,
	];
}

/**
 * @param cwd - The root of the checkout
 * @returns Git access for it
 * @example
 * createGit('/path/to/repo').sha('origin/dev');
 */
export function createGit(cwd: string): LocalGit {
	const git = (...args: string[]) => run('git', args, { cwd });
	const tryGit = (...args: string[]) => {
		try {
			return git(...args);
		} catch {
			return null;
		}
	};
	const lines = (text: string) => text.split('\n').filter((line) => line !== '');
	const commits = (range: string, extra: string[]): Commit[] =>
		lines(git('log', '--reverse', '--format=%H%x00%ct%x00%s', ...extra, range)).map(
			(line) => {
				const [sha = '', time = '0', subject = ''] = line.split('\0');
				return { sha, time: Number(time), subject };
			},
		);
	return {
		cwd,
		tags: (ref) => lines(git('tag', '--merged', ref)),
		diffNames: (from, to, path) =>
			lines(git('diff', '--name-only', from, to, '--', path)),
		show: (rev, path) => tryGit('show', `${rev}:${path}`),
		listFiles: (rev, path) => lines(git('ls-tree', '-r', '--name-only', rev, '--', path)),
		firstParents: (from, to) => commits(`${from}..${to}`, ['--first-parent']),
		blobId: (rev, path) => tryGit('rev-parse', `${rev}:${path}`),
		remoteBranches: () =>
			lines(
				git('for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin'),
			).filter((name) => name !== 'HEAD'),
		tagsWithDates: () =>
			lines(
				git(
					'for-each-ref',
					'--format=%(refname:lstrip=2)%00%(creatordate:iso-strict)',
					'refs/tags',
				),
			).map((line) => {
				const [tag = '', date = ''] = line.split('\0');
				return { tag, date: new Date(date) };
			}),
		sha: (rev) => git('rev-parse', `${rev}^{commit}`),
		isAncestor: (ancestor, descendant) =>
			tryGit('merge-base', '--is-ancestor', ancestor, descendant) !== null,
		currentBranch: () => tryGit('symbolic-ref', '--short', '-q', 'HEAD'),
		messages: (from, to) =>
			git('log', '--reverse', '--format=%H%x00%B%x01', `${from}..${to}`)
				.split('\u0001')
				.map((entry) => entry.replace(/^\n/, ''))
				.filter((entry) => entry !== '')
				.map((entry) => {
					const [sha = '', message = ''] = entry.split('\0');
					return { sha, message: message.trim() };
				}),
		raw: (...args) => git(...args),
		pushAs: (token, repository, refspec) => {
			git(...pushArgs(token, repository, refspec));
		},
	};
}
