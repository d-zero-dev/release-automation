/**
 * Adds a release to the top of a changelog, under its title. The result
 * ends with exactly one newline and has one blank line between blocks, the
 * shape Markdown formatters (oxfmt, Prettier) leave unchanged, so the
 * format check of the Release PR passes.
 * @param previous - The current changelog, or `null` when there is none
 * @param release - The release
 * @param release.version - The version
 * @param release.date - The date, `YYYY-MM-DD`
 * @param release.entries - One line per change, without the leading `- `
 * @returns The new changelog
 * @example
 * prependRelease(null, { version: '0.0.1', date: '2026-11-26', entries: ['fix: x (abc1234)'] });
 * // '# Changelog\n\n## 0.0.1 (2026-11-26)\n\n- fix: x (abc1234)\n'
 */
export function prependRelease(
	previous: string | null,
	release: {
		readonly version: string;
		readonly date: string;
		readonly entries: readonly string[];
	},
): string {
	const [title = '# Changelog', ...rest] = (previous ?? '# Changelog\n').split('\n');
	const body = rest.join('\n').trim();
	const entry = [
		`## ${release.version} (${release.date})`,
		release.entries.map((line) => `- ${line}`).join('\n'),
	]
		.filter((block) => block !== '')
		.join('\n\n');
	return `${[title, entry, body].filter((block) => block !== '').join('\n\n')}\n`;
}
