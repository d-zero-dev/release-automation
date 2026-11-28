# Changelog

## 0.1.0 (2026-11-28)

- fix: make publish safe to run again and wait longer for the registry (3cc2fb6)
- feat: let a release line name the dist-tag it is published under (2212562)

## 0.0.5 (2026-11-27)

- fix: generate a release on a local branch, not a detached HEAD (020d3f5)

## 0.0.4 (2026-11-27)

- fix: read the version of dev from origin/dev on a previous line (9ef7048)

## 0.0.3 (2026-11-27)

- fix: count a Nightly that never ran from when its workflow was added (10ea03a)

## 0.0.2 (2026-11-27)

- fix: report only vulnerabilities in the audit and keep its Issue when the audit fails (daef0ee)

## 0.0.1 (2026-11-26)

- fix: redact credentials from failed command errors (d316b47)
- fix: check a pull request against the lines it proposes (d133cbb)
- fix: push as the GitHub App, not as the workflow's token (bc68a33)
- fix: write a changelog that ends with one newline (c57baa4)
