import type { IssueDraft } from './issue-body.js';

/**
 * One advisory from the dependency audit.
 * @example
 * const finding: AuditFinding = { name: 'tmp', issue: 'Path traversal', severity: 'high', url: 'https://example.com/advisories/GHSA-0000' };
 */
export interface AuditFinding {
	readonly name: string;
	readonly issue: string;
	readonly severity: string;
	readonly url: string;
}

/**
 * What an audit printed: the advisories, and how many deprecation notices
 * were left out.
 * @example
 * const result: AuditResult = { findings: [], deprecations: 2 };
 */
export interface AuditResult {
	readonly findings: readonly AuditFinding[];
	readonly deprecations: number;
}

/**
 * What the Nightly does with an audit of a line (rule 36).
 * - `report`: open the line's audit Issue, or rewrite it with the findings
 * - `clean`: close the line's audit Issue
 * - `failed`: the audit did not run; keep the Issue and fail the job
 * - `unknown`: no exit code was given, so clean cannot be told from failed; keep the Issue
 */
export type AuditOutcome = 'report' | 'clean' | 'failed' | 'unknown';

/**
 * Reads the output of `yarn npm audit --json` (one JSON object per line).
 * Lines that are not JSON objects with a package name are skipped. Deprecation
 * notices are counted but not taken as findings: rule 36 asks for an audit of
 * vulnerabilities, and a notice never clears while the package stays. A line
 * that starts with `{` but is not JSON throws, since skipping it could make a
 * failed audit look clean.
 * @param output - The audit output
 * @returns The findings, in the order of the output, and the number of deprecation notices
 * @example
 * parseAudit('{"value":"tmp","children":{"ID":1,"Issue":"Path traversal","Severity":"high"}}');
 * // { findings: [{ name: 'tmp', issue: 'Path traversal', severity: 'high', url: '' }], deprecations: 0 }
 */
export function parseAudit(output: string): AuditResult {
	const entries = output
		.split('\n')
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => line.trim().startsWith('{'))
		.map(({ line, number }) => {
			try {
				return JSON.parse(line) as {
					value?: string;
					children?: Record<string, unknown>;
				};
			} catch (error) {
				throw new Error(`Cannot read line ${number} of the audit output`, {
					cause: error,
				});
			}
		})
		.flatMap((entry) =>
			entry.value === undefined ? [] : [{ name: entry.value, children: entry.children }],
		);
	const deprecations = entries.filter((entry) => isDeprecation(entry.children?.['ID']));
	return {
		findings: entries
			.filter((entry) => !deprecations.includes(entry))
			.map((entry) => ({
				name: entry.name,
				issue: text(entry.children?.['Issue']),
				severity: text(entry.children?.['Severity']),
				url: text(entry.children?.['URL']),
			})),
		deprecations: deprecations.length,
	};
}

/**
 * Decides what an audit means (rule 36), in this order:
 * 1. findings are reported, whatever the exit code
 * 2. without the exit code, nothing more can be told
 * 3. exit code 0 is clean
 * 4. deprecation notices alone are clean: Yarn exits with 1 on them, and they
 *    show that the audit reached the registry
 * 5. otherwise the audit failed. `yarn npm audit` prints nothing to standard
 *    output both when it is clean and when it fails (for example, the registry
 *    is unreachable), so only the exit code tells them apart
 * @param result - The result from {@link parseAudit}
 * @param exitCode - The exit code of `yarn npm audit`, or null when the workflow did not pass it
 * @returns The outcome
 * @example
 * auditOutcome({ findings: [], deprecations: 0 }, 0); // 'clean'
 * auditOutcome({ findings: [], deprecations: 0 }, 1); // 'failed'
 */
export function auditOutcome(result: AuditResult, exitCode: number | null): AuditOutcome {
	if (result.findings.length > 0) {
		return 'report';
	}
	if (exitCode === null) {
		return 'unknown';
	}
	if (exitCode === 0 || result.deprecations > 0) {
		return 'clean';
	}
	return 'failed';
}

/**
 * The audit Issue of a line (rule 36). The body holds the latest findings,
 * sorted so that it depends only on the line and the findings, not on the
 * order of the audit output: an unchanged audit gives an unchanged body, and
 * the Nightly rewrites the Issue only when the findings change.
 * @param line - The branch the audit ran on
 * @param findings - The findings
 * @returns The Issue
 * @example
 * auditIssue('dev', parseAudit(output)).marker; // '<!-- release-automation:audit:dev -->'
 */
export function auditIssue(line: string, findings: readonly AuditFinding[]): IssueDraft {
	const marker = auditMarker(line);
	const lines = findings
		.map((finding) =>
			`- \`${finding.name}\`: ${finding.issue} (${finding.severity}) ${finding.url}`.trimEnd(),
		)
		.toSorted();
	return {
		marker,
		title: `Vulnerable dependencies on ${line}`,
		body: [
			marker,
			'',
			`The dependency audit of \`${line}\` found:`,
			'',
			...lines,
			'',
			'This list is rewritten with each audit. Write notes in comments, not here.',
			'',
			'Fix them on the line (a vulnerability fix PR, `resolutions`, or the age gate exception of the repository policy), then this Issue closes after a clean audit.',
			'',
		].join('\n'),
	};
}

/**
 * The marker of a line's audit Issue.
 * @param line - The branch
 * @returns The marker
 * @example
 * auditMarker('v3'); // '<!-- release-automation:audit:v3 -->'
 */
export function auditMarker(line: string): string {
	return `<!-- release-automation:audit:${line} -->`;
}

/**
 * Yarn gives a deprecation notice the ID `<name> (deprecation)`, and an
 * advisory a number.
 * @param id - The `ID` of an entry
 */
function isDeprecation(id: unknown): boolean {
	return typeof id === 'string' && id.endsWith('(deprecation)');
}

/**
 * A field as text, empty when missing.
 * @param value - The field
 */
function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
