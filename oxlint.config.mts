import config from '@d-zero/oxlint-config';

/**
 * Type-aware rules read the built `dist/*.d.ts`, so run `yarn build` before
 * `yarn lint`.
 */
export default {
	...config,
	rules: {
		...config.rules,
		// The types live in TypeScript; do not make JSDoc restate them.
		'jsdoc/require-param-type': 'off',
		'jsdoc/require-param-description': 'off',
		'jsdoc/require-returns': 'off',
		'jsdoc/require-returns-type': 'off',
		'jsdoc/require-returns-description': 'off',
		// oxfmt always lowercases hex digits; this rule wants uppercase.
		'unicorn/number-literal-case': 'off',
		'typescript/no-floating-promises': 'error',
	},
	ignorePatterns: [...config.ignorePatterns, '**/dist/**'],
	overrides: [
		{
			// Skill scripts are CLI tools: stdout is their interface.
			files: ['.claude/skills/*/scripts/**'],
			rules: {
				'no-console': 'off',
			},
		},
		{
			// `.textlintrc.js` is CommonJS.
			files: ['.textlintrc.js'],
			rules: {
				'typescript/no-require-imports': 'off',
				'typescript/no-var-requires': 'off',
				'unicorn/prefer-module': 'off',
			},
		},
	],
};
