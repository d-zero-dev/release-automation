/**
 * What the registry states about a package.
 * @example
 * const info: Packument = { versions: ['1.0.0'], distTags: { latest: '1.0.0' }, times: {} };
 */
export interface Packument {
	readonly versions: readonly string[];
	readonly distTags: Readonly<Record<string, string>>;
	/** The publish time of each version. */
	readonly times: Readonly<Record<string, string>>;
}

/**
 * Reads a package from the npm registry, bypassing caches.
 * @param name - The package name
 * @returns Its versions and dist-tags, or `null` when it was never published
 * @throws {Error} For a registry error other than "not found"
 * @example
 * await fetchPackument('@d-zero/roar');
 */
export async function fetchPackument(name: string): Promise<Packument | null> {
	const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
		headers: { accept: 'application/json', 'cache-control': 'no-cache' },
	});
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`npm registry ${response.status} for ${name}`);
	}
	const body = (await response.json()) as {
		versions?: Record<string, unknown>;
		'dist-tags'?: Record<string, string>;
		time?: Record<string, string>;
	};
	return {
		versions: Object.keys(body.versions ?? {}),
		distTags: body['dist-tags'] ?? {},
		times: body.time ?? {},
	};
}
