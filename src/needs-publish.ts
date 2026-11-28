import type { PublishMode } from './types.js';

/**
 * Decides whether the publish command has to run. A run of `publish` that
 * starts again after the registry took the packages (for example because the
 * registry was slow to show them) must not publish over them: `npm publish`
 * fails on a version that exists, so only the Lerna modes would survive a
 * second run. Nothing to publish means the command is
 * skipped and the run goes on with the verification and the return to `dev`.
 * The registry says nothing about a custom command, so it always runs.
 * Implements the idempotent re-run of rule 26.
 * @param input - What the registry showed before the publish
 * @param input.mode - The publishing mode
 * @param input.unpublishedCount - How many public packages are not on the registry at their version
 * @returns Whether to run the publish command
 * @example
 * needsPublish({ mode: 'npm-single', unpublishedCount: 0 }); // false
 * needsPublish({ mode: 'npm-single', unpublishedCount: 1 }); // true
 * needsPublish({ mode: 'custom', unpublishedCount: 0 }); // true
 */
export function needsPublish(input: {
	readonly mode: PublishMode;
	readonly unpublishedCount: number;
}): boolean {
	return input.mode === 'custom' || input.unpublishedCount > 0;
}
