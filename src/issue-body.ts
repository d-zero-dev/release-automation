/**
 * An Issue to open. The body starts with the marker, which finds the Issue
 * again on later runs.
 * @example
 * const issue: IssueDraft = { marker: '<!-- release-automation:audit:dev -->', title: 'Vulnerable dependencies on dev', body: '<!-- release-automation:audit:dev -->\n' };
 */
export interface IssueDraft {
	readonly marker: string;
	readonly title: string;
	readonly body: string;
}

/**
 * Picks the open Issues whose body differs from the latest report, for the
 * Issues that are rewritten with each run. Line endings and trailing
 * whitespace are ignored, since GitHub may store the body with CRLF or trim it.
 * @param open - The open Issues with the report's marker
 * @param body - The latest body
 * @returns The numbers of the Issues to rewrite
 * @example
 * issuesToRewrite([{ number: 1, body: 'old' }], 'new\n'); // [1]
 */
export function issuesToRewrite(
	open: readonly { readonly number: number; readonly body: string | null }[],
	body: string,
): number[] {
	const latest = normalize(body);
	return open
		.filter((issue) => normalize(issue.body ?? '') !== latest)
		.map((issue) => issue.number);
}

/**
 * The body with LF line endings and no trailing whitespace.
 * @param body - The body
 */
function normalize(body: string): string {
	return body.replaceAll('\r\n', '\n').trimEnd();
}
