import lintStagedConfigGenerator from '@d-zero/lint-staged-config';

/**
 * The extensions this repository has, from `@d-zero/lint-staged-config`'s
 * oxlint / oxfmt mapping. The oxlint run here has no type information: the
 * type-aware rules are first reported by `yarn lint:check` in CI.
 */
const mapping = {
	js: ['oxlint', 'oxfmt'],
	json: ['oxfmt'],
	md: ['oxfmt', 'textlint'],
	mjs: ['oxlint', 'oxfmt'],
	mts: ['oxlint', 'oxfmt'],
	ts: ['oxlint', 'oxfmt'],
	yaml: ['oxfmt'],
	yml: ['oxfmt'],
};

export default lintStagedConfigGenerator(
	{ ignore: [{ textlint: 'CHANGELOG.md' }] },
	mapping,
);
