# @d-zero/release-automation

D-ZERO のリポジトリ運用ルールが要求する自動処理を実行する CLI。リリース系列の判定、Release PR の生成と検証、公開、Nightly、Renovate の PR の Approve を担う。各リポジトリは devDependencies に入れ、自分のワークフローから呼び出す。

## インストール

```sh
yarn add -D @d-zero/release-automation@<version>
```

呼び出すのはワークフローとエージェントだけなので、ヘルプ表示はない。コマンドとフラグは下の表のとおり。

## 系列定義ファイル

`.github/release-lines.json`にリポジトリの系列を書く。

```json
{
	"lines": [
		{ "branch": "dev", "role": "current" },
		{ "branch": "v3", "role": "previous", "successorStable": "2026-04-01" }
	],
	"supportMonths": 12,
	"securityBatchMinutes": 60
}
```

| キー                      | 意味                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `lines[].role`            | `current`（`dev`で開発し`main`から公開）、`next`（次メジャー。`v<N>`で開発・公開）、`previous`（旧メジャー。`v<N>`で保守・公開） |
| `lines[].successorStable` | 旧系列の後継メジャーの正式版の公開日。省略時はタグから読む                                                                       |
| `supportMonths`           | 旧系列のサポート期間。既定は12                                                                                                   |
| `securityBatchMinutes`    | セキュリティ修正をまとめる時間。既定は60                                                                                         |
| `publishCommand`          | npm 公開しないリポジトリの公開コマンド。`DIST_TAG`環境変数を受け取る                                                             |

## コマンド

| コマンド                                                 | 実行場所                 | 内容                                                                         |
| -------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `classify [--json]`                                      | ローカル                 | 系列・公開方式・レビュー方式を判定し、エラーとセットアップの作業を表示する   |
| `lines-check`                                            | CI                       | Renovate・ワークフロー・`SECURITY.md`・pre-commit が系列と一致するか検査する |
| `guard`                                                  | pre-commit               | 系列のブランチと`main`への直接コミットを拒否する                             |
| `commit-check --base <branch>`                           | PR の CI                 | マージ先の系列が受け付けない破壊的変更を拒否する                             |
| `release-pr [--line] [--manual] [--promote] [--dry-run]` | 定期実行・手動           | 各系列の Release PR を作成・更新・差し替えする                               |
| `verify-release-pr --pr <n>`                             | `pull_request_target`    | Release PR が自動生成されたものか検証する                                    |
| `publish [--dry-run]`                                    | 公開ブランチへの push    | Release PR のマージを公開し、`dev`へ反映する                                 |
| `nightly-dispatch [--force]`                             | 定期実行                 | 各系列の Full CI を起動する（同じコミットの成功は再利用）                    |
| `nightly-report`                                         | 定期実行・Full CI 完了時 | `release-blocker`・サポート終了・年齢ゲート例外の Issue を管理する           |
| `audit-report --line <branch> --file <path>`             | 定期実行                 | 依存の監査結果を Issue にする                                                |
| `approve-renovate --pr <n>`                              | `pull_request_target`    | 自動マージ対象の Renovate の PR を Approve する                              |

## 環境変数

| 変数                                    | 使うコマンド                                 |
| --------------------------------------- | -------------------------------------------- |
| `GITHUB_REPOSITORY`、`GITHUB_TOKEN`     | GitHub を読み書きするすべてのコマンド        |
| `RELEASE_APP_TOKEN`、`RELEASE_APP_SLUG` | `release-pr`、`verify-release-pr`、`publish` |
| `PUBLISH_APP_TOKEN`、`PUBLISH_APP_SLUG` | `publish`                                    |
| `APPROVE_APP_TOKEN`                     | `approve-renovate`                           |
