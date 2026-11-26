---
paths:
  - 'src/cli.ts'
  - 'src/commands/**'
  - 'src/io/**'
---

# コマンドと外部とのやり取り

このディレクトリのコードは、各リポジトリの GitHub Actions の中で、GitHub App のトークンを持って動く。間違いは、全リポジトリの公開経路と保護の穴になる。

## 安全

- **PR のコードを実行しない**。`pull_request_target`で動くコマンド（`verify-release-pr`、`approve-renovate`）は、PR の情報を API から読むだけにする。`verify-release-pr`が実行してよいのは、保護された系列のブランチにすでにあるコミット（Release PR の親）だけで、その確認（`isAncestor`）を実行の前に置く
- **トークンを出力しない**。トークンは環境変数から読み、URL に入れるときは`run()`（`redact()`を通す）だけで扱う。`console.log`・ジョブサマリー・Issue 本文・例外のメッセージにトークンや秘密鍵を入れない。`runShell()`はトークンを含むコマンドに使わない
- **作者で判断するときは API の値を使う**。PR のタイトル・本文・ラベル・ブランチ名は、書き込み権限のある人なら誰でも変えられる。正当性の根拠にしない（ルール文書のルール63）
- **force push は Release PR のブランチ（`release/<branch>`）と`sync/<sha>`にだけ**。系列のブランチ・`main`・タグには force push しない

## 判定は純粋関数に置く

何をするか・しないかの判定は、`src/`直下の純粋関数に置いてテストする。`src/commands/`は、事実を集めて判定に渡し、結果を実行するだけにする。判定をここに書き足したくなったら、純粋関数に移す。

## 互換性の契約

各リポジトリのワークフローと、すでに開いている PR・Issue が頼っているもの。変える・消すのは破壊的変更（ルート`CLAUDE.md`）。

| 種類                             | 定義している場所                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| コマンドとフラグ                 | `src/cli.ts`の`COMMANDS`                                                                                                                                                           |
| 環境変数                         | `requireEnv()`の呼び出し                                                                                                                                                           |
| ラベル                           | `src/commands/context.ts`（`release`、`release-replaced`、`release-blocker`）、`src/commands/release-pr.ts`（`security`）、`src/pr-checks.ts`（`manual-review`）                   |
| チェック名・ワークフロー名       | `src/commands/context.ts`（`release-pr-verified`、`full-ci.yml`）、`src/lines-check.ts`（`ci-ok`）、`src/commands/publish.ts`（`ci-ok`を待つ）                                     |
| 本文のマーカー                   | `release-automation:line:`・`fingerprint:`・`promote:`（Release PR）、`release-blocker:`・`release-automation:eol:`・`rotation:`・`age-gate:`・`audit:`・`nightly-stale:`（Issue） |
| Renovate のルールの`description` | `src/lines-check.ts`の`PREVIOUS_LINES_RULE`・`LOCKFILE_STOP_RULE`                                                                                                                  |
| 系列定義ファイルの書式           | `src/types.ts`の`LinesFile`、`src/io/repo.ts`の`parseLinesFile`                                                                                                                    |
| ブランチ名                       | `release/<branch>`、`sync/<sha>`                                                                                                                                                   |

マーカーを変える場合は、古いマーカーの PR・Issue も読めるようにするか、移行手順を`## 振る舞いの変更`に書く。
