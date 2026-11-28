/** How many times a publish is tried in all. */
export const PUBLISH_ATTEMPTS = 3;

/**
 * How many times the check that the registry shows a published version is
 * made in all. The registry can take minutes to show a version it accepted, so
 * with the waits doubling from 10 seconds the check gives up after about ten
 * minutes.
 */
export const REGISTRY_VERIFY_ATTEMPTS = 7;

/**
 * Runs a task until it succeeds, at most `attempts` times, waiting longer
 * between each try (`baseDelayMs`, then twice that, and so on).
 * @param task - The task; it receives the attempt number, starting at 1
 * @param options - The limits
 * @param options.attempts - Total tries
 * @param options.baseDelayMs - The first wait
 * @param options.sleep - Waits; replaced in tests
 * @returns The task's result
 * @throws {Error} The last error when every try failed
 * @example
 * await retry((attempt) => publish(), { attempts: 3, baseDelayMs: 30_000 });
 */
export async function retry<T>(
	task: (attempt: number) => Promise<T>,
	options: {
		readonly attempts: number;
		readonly baseDelayMs: number;
		readonly sleep?: (ms: number) => Promise<void>;
	},
): Promise<T> {
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let lastError: unknown;
	for (let attempt = 1; attempt <= options.attempts; attempt++) {
		try {
			return await task(attempt);
		} catch (error) {
			lastError = error;
			if (attempt < options.attempts) {
				await sleep(options.baseDelayMs * 2 ** (attempt - 1));
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
