/**
 * A minimal GitHub REST and GraphQL client for one repository.
 * @example
 * const gh = createGitHub({ token: process.env.GH_TOKEN!, repository: 'owner/name' });
 * await gh.rest('GET', '/repos/{repo}/pulls?state=open');
 */
export interface GitHub {
	readonly repository: string;
	/**
	 * Calls a REST endpoint. `{repo}` in the path is replaced with the repository.
	 * @returns The parsed JSON response, or `null` for an empty one
	 */
	rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
	/** Follows the `next` links of a list endpoint and returns every item. */
	paginate<T = unknown>(path: string): Promise<T[]>;
	/** Calls the GraphQL endpoint. */
	graphql<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T>;
}

/**
 * An error response of the GitHub API.
 * @example
 * if (error instanceof GitHubError && error.status === 404) {}
 */
export class GitHubError extends Error {
	readonly status: number;

	/**
	 * @param status - The HTTP status
	 * @param message - The response body
	 */
	constructor(status: number, message: string) {
		super(`GitHub API ${status}: ${message}`);
		this.status = status;
	}
}

const API = 'https://api.github.com';

/**
 * @param options - The token and the repository
 * @param options.token - A token with the permissions the command needs
 * @param options.repository - `owner/name`
 * @returns The client
 * @example
 * createGitHub({ token, repository: process.env.GITHUB_REPOSITORY! });
 */
export function createGitHub(options: {
	readonly token: string;
	readonly repository: string;
}): GitHub {
	const headers = {
		authorization: `Bearer ${options.token}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': '@d-zero/release-automation',
	};
	const url = (path: string) =>
		path.startsWith('http')
			? path
			: `${API}${path.replaceAll('{repo}', options.repository)}`;

	/**
	 * @param method - The HTTP method
	 * @param path - The path or URL
	 * @param body - The JSON body
	 * @returns The response
	 */
	async function request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		const response = await fetch(url(path), {
			method,
			headers:
				body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok) {
			throw new GitHubError(response.status, await response.text());
		}
		return response;
	}

	return {
		repository: options.repository,
		async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
			const response = await request(method, path, body);
			const text = await response.text();
			return (text === '' ? null : JSON.parse(text)) as T;
		},
		async paginate<T>(path: string): Promise<T[]> {
			const items: T[] = [];
			let next: string | null = url(
				`${path}${path.includes('?') ? '&' : '?'}per_page=100`,
			);
			while (next !== null) {
				const response: Response = await request('GET', next);
				const page = (await response.json()) as T[] | Record<string, unknown>;
				if (Array.isArray(page)) {
					items.push(...page);
				} else {
					const list = Object.values(page).find((value) => Array.isArray(value)) as
						| T[]
						| undefined;
					items.push(...(list ?? []));
				}
				const link = response.headers.get('link') ?? '';
				next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
			}
			return items;
		},
		async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
			const response = await request('POST', '/graphql', { query, variables });
			const result = (await response.json()) as { data?: T; errors?: unknown[] };
			if (result.errors && result.errors.length > 0) {
				throw new Error(`GitHub GraphQL: ${JSON.stringify(result.errors)}`);
			}
			return result.data as T;
		},
	};
}
