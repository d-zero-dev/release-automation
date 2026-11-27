import { describe, expect, test } from 'vitest';

import { auditIssue, auditMarker, auditOutcome, parseAudit } from './audit.js';

describe('parseAudit', () => {
	test('reads an advisory as Yarn prints it', () => {
		const output =
			'{"value":"tmp","children":{"ID":1109537,"Issue":"Symlink write","URL":"https://example.com/advisories/GHSA-0000","Severity":"low","Vulnerable Versions":"<=0.2.3","Tree Versions":["0.0.33"],"Dependents":["external-editor@npm:3.1.0"]}}\n';
		expect(parseAudit(output)).toEqual({
			findings: [
				{
					name: 'tmp',
					issue: 'Symlink write',
					severity: 'low',
					url: 'https://example.com/advisories/GHSA-0000',
				},
			],
			deprecations: 0,
		});
	});

	test('reads an advisory without a URL', () => {
		const output =
			'{"value":"glob","children":{"ID":1244013,"Issue":"Cancellation bypass","Severity":"moderate"}}';
		expect(parseAudit(output).findings).toEqual([
			{ name: 'glob', issue: 'Cancellation bypass', severity: 'moderate', url: '' },
		]);
	});

	test('counts deprecation notices apart, since they are not vulnerabilities', () => {
		const output = [
			'{"value":"inflight","children":{"ID":"inflight (deprecation)","Issue":"This module is not supported","Severity":"moderate"}}',
			'{"value":"tmp","children":{"ID":1109537,"Issue":"Symlink write","Severity":"low"}}',
		].join('\n');
		const result = parseAudit(output);
		expect(result.findings.map((finding) => finding.name)).toEqual(['tmp']);
		expect(result.deprecations).toBe(1);
	});

	test('skips lines that are not findings', () => {
		const output = ['', 'warning: something', '{"type":"info"}', '  '].join('\n');
		expect(parseAudit(output)).toEqual({ findings: [], deprecations: 0 });
	});

	test('names the line it cannot read', () => {
		expect(() => parseAudit('\n{"value":"tmp"')).toThrow('Cannot read line 2');
	});
});

describe('auditOutcome', () => {
	const tmp = { name: 'tmp', issue: 'x', severity: 'low', url: '' };
	const nothing = { findings: [], deprecations: 0 };

	test('reports findings whatever the exit code', () => {
		expect(auditOutcome({ findings: [tmp], deprecations: 0 }, 1)).toBe('report');
		expect(auditOutcome({ findings: [tmp], deprecations: 0 }, null)).toBe('report');
	});

	test('is clean when the audit exited with 0', () => {
		expect(auditOutcome(nothing, 0)).toBe('clean');
	});

	test('is clean when the audit printed only deprecation notices, on which Yarn exits with 1', () => {
		expect(auditOutcome({ findings: [], deprecations: 2 }, 1)).toBe('clean');
	});

	test('fails when the audit printed nothing and exited with other than 0', () => {
		expect(auditOutcome(nothing, 1)).toBe('failed');
	});

	test('cannot tell clean from failed without the exit code', () => {
		expect(auditOutcome(nothing, null)).toBe('unknown');
	});
});

describe('auditIssue', () => {
	test('lists the findings under the line marker', () => {
		const issue = auditIssue('dev', [
			{
				name: 'tmp',
				issue: 'Symlink write',
				severity: 'low',
				url: 'https://example.com/advisories/GHSA-0000',
			},
			{ name: 'glob', issue: 'Cancellation bypass', severity: 'moderate', url: '' },
		]);
		expect(issue).toEqual({
			marker: '<!-- release-automation:audit:dev -->',
			title: 'Vulnerable dependencies on dev',
			body: [
				'<!-- release-automation:audit:dev -->',
				'',
				'The dependency audit of `dev` found:',
				'',
				'- `glob`: Cancellation bypass (moderate)',
				'- `tmp`: Symlink write (low) https://example.com/advisories/GHSA-0000',
				'',
				'This list is rewritten with each audit. Write notes in comments, not here.',
				'',
				'Fix them on the line (a vulnerability fix PR, `resolutions`, or the age gate exception of the repository policy), then this Issue closes after a clean audit.',
				'',
			].join('\n'),
		});
	});

	test('does not depend on the order of the audit output', () => {
		const a = { name: 'a', issue: 'x', severity: 'low', url: '' };
		const b = { name: 'b', issue: 'y', severity: 'high', url: '' };
		expect(auditIssue('dev', [a, b]).body).toBe(auditIssue('dev', [b, a]).body);
	});

	test('changes when the findings change', () => {
		const a = { name: 'a', issue: 'x', severity: 'low', url: '' };
		const b = { name: 'b', issue: 'y', severity: 'high', url: '' };
		expect(auditIssue('dev', [a]).body).not.toBe(auditIssue('dev', [a, b]).body);
	});
});

describe('auditMarker', () => {
	test('names the line', () => {
		expect(auditMarker('v3')).toBe('<!-- release-automation:audit:v3 -->');
	});
});
