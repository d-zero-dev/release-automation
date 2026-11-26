import { execFileSync } from 'node:child_process';

/**
 * Hides the credentials in a text: a token in a URL (`https://x-access-token:<token>@…`).
 * Pushes pass the token in the remote URL, and a failed command's error
 * repeats its arguments, so every error from {@link run} goes through this.
 * @param text - Any text
 * @returns The text with the credentials replaced by `***`
 * @example
 * redact('https://x-access-token:ghs_abc@github.com/o/r.git'); // 'https://x-access-token:***@github.com/o/r.git'
 */
export function redact(text: string): string {
	return text.replaceAll(/(https?:\/\/[^:/@\s]+:)[^@\s]+@/g, '$1***@');
}

/**
 * Runs a program and returns its standard output.
 * @param file - The program
 * @param args - Its arguments
 * @param options - Where to run it and extra environment variables
 * @param options.cwd - The working directory
 * @param options.env - Variables added to the environment
 * @returns The standard output, without the trailing newline
 * @throws {Error} When the program exits with a non-zero code; the message
 *   names the command and its standard error, with credentials redacted
 * @example
 * run('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
 */
export function run(
	file: string,
	args: readonly string[],
	options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
): string {
	try {
		return execFileSync(file, args, {
			cwd: options.cwd,
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			env: { ...process.env, ...options.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		}).replace(/\n$/, '');
	} catch (error) {
		const stderr =
			typeof error === 'object' && error !== null && 'stderr' in error
				? String(error.stderr)
				: '';
		// The original error is not attached as `cause`: its message repeats the
		// arguments unredacted.
		throw new Error(redact(`${file} ${args.join(' ')} failed\n${stderr}`.trim()));
	}
}

/**
 * Runs a program with its output passed through, for long commands such as a publish.
 * @param command - A shell command line
 * @param cwd - The working directory
 * @throws {Error} When the command exits with a non-zero code
 * @example
 * runShell('yarn build', process.cwd());
 */
export function runShell(command: string, cwd: string): void {
	execFileSync('sh', ['-c', command], { cwd, stdio: 'inherit' });
}
