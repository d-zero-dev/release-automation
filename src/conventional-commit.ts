/**
 * The parts of a Conventional Commits message that release decisions read.
 * @example
 * const commit: ParsedCommit = { type: 'fix', scope: 'deps', breaking: false };
 */
export interface ParsedCommit {
	/** The type, lowercased; `null` when the subject does not follow the format. */
	readonly type: string | null;
	readonly scope: string | null;
	/** Whether the commit marks a breaking change (`!` or a `BREAKING CHANGE:` footer). */
	readonly breaking: boolean;
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: \S/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

/**
 * Parses a commit message.
 * @param message - The full commit message
 * @returns The type, scope and breaking marker
 * @example
 * parseCommit('feat(core)!: drop Node 20'); // { type: 'feat', scope: 'core', breaking: true }
 */
export function parseCommit(message: string): ParsedCommit {
	const [subject = '', ...rest] = message.split('\n');
	const match = HEADER.exec(subject);
	if (!match?.groups) {
		return { type: null, scope: null, breaking: BREAKING_FOOTER.test(rest.join('\n')) };
	}
	return {
		type: match.groups['type']?.toLowerCase() ?? null,
		scope: match.groups['scope'] ?? null,
		breaking: match.groups['bang'] === '!' || BREAKING_FOOTER.test(rest.join('\n')),
	};
}

/** The types whose commits reach users and so count toward a release. */
export const RELEASE_TYPES = ['feat', 'fix', 'perf', 'revert'] as const;

/**
 * Tells whether a commit counts toward a release: a type in
 * {@link RELEASE_TYPES}, or a breaking change.
 * @param commit - A parsed commit
 * @returns Whether it counts
 * @example
 * countsForRelease(parseCommit('chore: update lockfile')); // false
 */
export function countsForRelease(commit: ParsedCommit): boolean {
	return (
		commit.breaking ||
		(commit.type !== null && (RELEASE_TYPES as readonly string[]).includes(commit.type))
	);
}
