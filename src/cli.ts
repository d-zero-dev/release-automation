#!/usr/bin/env node
import type { Promotion } from './next-version.js';

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { approveRenovateCommand } from './commands/approve-renovate.js';
import {
	classifyCommand,
	commitCheckCommand,
	guardCommand,
	linesCheckCommand,
} from './commands/local.js';
import {
	auditReportCommand,
	nightlyDispatchCommand,
	nightlyReportCommand,
} from './commands/nightly.js';
import { publishCommand } from './commands/publish.js';
import { releasePrCommand } from './commands/release-pr.js';
import { verifyReleasePrCommand } from './commands/verify-release-pr.js';

/**
 * The commands and their flags. Workflows and agents call the CLI, not people,
 * so there is no help text: the README lists the commands.
 */
const COMMANDS = {
	classify: { json: { type: 'boolean' } },
	'lines-check': {},
	guard: {},
	'commit-check': { base: { type: 'string' } },
	'release-pr': {
		line: { type: 'string' },
		manual: { type: 'boolean' },
		promote: { type: 'string' },
		'dry-run': { type: 'boolean' },
	},
	'verify-release-pr': { pr: { type: 'string' } },
	publish: { 'dry-run': { type: 'boolean' } },
	'nightly-dispatch': { force: { type: 'boolean' } },
	'nightly-report': {},
	'audit-report': {
		line: { type: 'string' },
		file: { type: 'string' },
		'exit-code': { type: 'string' },
	},
	'approve-renovate': { pr: { type: 'string' } },
} as const;

const PROMOTIONS = new Set(['beta', 'rc', 'stable']);

/**
 * @param values - The parsed flags
 * @param name - A flag that must be given
 * @returns Its value
 */
function required(values: Record<string, unknown>, name: string): string {
	const value = values[name];
	if (typeof value !== 'string' || value === '') {
		throw new Error(`--${name} is required`);
	}
	return value;
}

/**
 * @param values - The parsed flags
 * @returns The value of `--pr` as a pull request number
 */
function prNumber(values: Record<string, unknown>): number {
	const value = Number(required(values, 'pr'));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error('--pr takes a pull request number');
	}
	return value;
}

/**
 * @param values - The parsed flags
 * @returns The value of `--exit-code` as a number, or null when it is not given
 */
function exitCode(values: Record<string, unknown>): number | null {
	const value = values['exit-code'];
	if (value === undefined) {
		return null;
	}
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw new Error(
			`--exit-code takes the exit code of yarn npm audit, but got ${JSON.stringify(value)}`,
		);
	}
	return Number(value);
}

try {
	const [command, ...rest] = process.argv.slice(2);
	if (command === undefined || !Object.hasOwn(COMMANDS, command)) {
		throw new Error(
			`Unknown command: ${command ?? '(none)'}. Commands: ${Object.keys(COMMANDS).join(', ')}`,
		);
	}
	const name = command as keyof typeof COMMANDS;
	const { values } = parseArgs({ args: rest, options: COMMANDS[name], strict: true });
	const flags = values as Record<string, unknown>;

	switch (name) {
		case 'classify': {
			process.exitCode = classifyCommand({ json: flags['json'] === true });
			break;
		}
		case 'lines-check': {
			process.exitCode = await linesCheckCommand();
			break;
		}
		case 'guard': {
			process.exitCode = guardCommand();
			break;
		}
		case 'commit-check': {
			process.exitCode = await commitCheckCommand({ base: required(flags, 'base') });
			break;
		}
		case 'release-pr': {
			const promote = typeof flags['promote'] === 'string' ? flags['promote'] : null;
			if (promote !== null && !PROMOTIONS.has(promote)) {
				throw new Error('--promote takes beta, rc or stable');
			}
			await releasePrCommand({
				...(typeof flags['line'] === 'string' ? { line: flags['line'] } : {}),
				manual: flags['manual'] === true,
				promote: promote as Promotion | null,
				dryRun: flags['dry-run'] === true,
			});
			break;
		}
		case 'verify-release-pr': {
			await verifyReleasePrCommand({ pr: prNumber(flags) });
			break;
		}
		case 'publish': {
			await publishCommand({ dryRun: flags['dry-run'] === true });
			break;
		}
		case 'nightly-dispatch': {
			await nightlyDispatchCommand({ force: flags['force'] === true });
			break;
		}
		case 'nightly-report': {
			await nightlyReportCommand();
			break;
		}
		case 'audit-report': {
			process.exitCode = await auditReportCommand({
				line: required(flags, 'line'),
				output: readFileSync(required(flags, 'file'), 'utf8'),
				exitCode: exitCode(flags),
			});
			break;
		}
		case 'approve-renovate': {
			await approveRenovateCommand({ pr: prNumber(flags) });
			break;
		}
	}
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
