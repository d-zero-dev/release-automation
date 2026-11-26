import { execFileSync } from 'node:child_process';

/**
 * Runs a program and returns its standard output.
 * @param file - The program
 * @param args - Its arguments
 * @param options - Where to run it and extra environment variables
 * @param options.cwd - The working directory
 * @param options.env - Variables added to the environment
 * @returns The standard output, without the trailing newline
 * @throws {Error} When the program exits with a non-zero code
 * @example
 * run('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
 */
export function run(
	file: string,
	args: readonly string[],
	options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
): string {
	return execFileSync(file, args, {
		cwd: options.cwd,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, ...options.env },
		stdio: ['ignore', 'pipe', 'pipe'],
	}).replace(/\n$/, '');
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
