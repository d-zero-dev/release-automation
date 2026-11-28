/**
 * Whether a value can name the dist-tag of a line in the lines file: a string
 * that starts with a letter (so it is not a number or a version, which npm
 * refuses as a dist-tag), has only letters, digits, `.`, `_` and `-`, does not
 * begin like a version (`v1.2.3`), and is not `next`, which rule 43 forbids.
 * @param value - The value to check
 * @returns Whether it is a usable dist-tag name
 * @example
 * isDistTagName('v3-legacy'); // true
 * isDistTagName('next'); // false
 * isDistTagName('1.0.0'); // false
 */
export function isDistTagName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z][\w.-]*$/.test(value) &&
		!/^v\d+\.\d+\.\d+/.test(value) &&
		value !== 'next'
	);
}
