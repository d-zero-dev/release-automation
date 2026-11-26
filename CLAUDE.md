# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

D-ZERO のリポジトリ運用ルールが要求する自動処理を実行する CLI（`@d-zero/release-automation`）。各リポジトリは devDependencies に入れ、自分のワークフローから呼び出す。リリース系列の判定、Release PR の作成・更新・差し替えと検証、公開と`dev`への反映、Nightly と`release-blocker`、Renovate の PR の Approve を担う。

保守はすべて AI エージェントが行う。人間は計画の合意、ルールの変更、リポジトリ外への書き込みの承認だけを行う。

このコードは各リポジトリの GitHub Actions の中で、GitHub App のトークンを持って動き、npm に公開する。不具合は全リポジトリの公開経路と保護の穴になる。

## ルールの正

振る舞いの正は、オーケストレーションリポジトリ`d-zero-dev/repos-manager`（非公開）の`repository-policy.md`。このパッケージはその実装で、JSDoc や Issue では「ルールN」の番号で参照する。

```sh
gh api repos/d-zero-dev/repos-manager/contents/repository-policy.md -H "Accept: application/vnd.github.raw"
```

- 各リポジトリに置くワークフローのテンプレートは、同じリポジトリの`.claude/skills/repo-setup/references/workflows.md`。コマンド・フラグ・環境変数・チェック名はテンプレートと一致させる
- **ルール文書と食い違う実装にしない**。ルール文書が決めていない振る舞いや、ルール文書を変える必要がある変更は、ユーザーに聞く（`impl`の spec silent）。ルール文書とテンプレートの更新は、このリポジトリではなく`repos-manager`側の作業になる

## プロジェクト構成

作業前に以下を確認すること:

- `package.json` — scripts、依存、`exports`、`bin`、`packageManager`と`volta`
- `README.md` — コマンド・系列定義ファイル・環境変数の一覧（利用者向けの正）
- `src/types.ts` — 系列定義ファイルの型と既定値
- `.claude/rules/commands.md` — `src/commands/`・`src/io/`・`src/cli.ts`を触るときの安全と互換性の契約

コードは3層に分かれている：

- `src/*.ts` — 判定の純粋関数（`classify`、`decideReleasePr`、`nextVersion`、`distTag`、`nightlyAction`、`checkLines`、`releaseContent`等）。すべてユニットテストがある
- `src/commands/` — 事実を集めて判定に渡し、結果を実行する。ユニットテストはない
- `src/io/` — git・GitHub API・npm registry とのやり取り

## コマンド

- `yarn build` — ビルド（`dist/`）
- `yarn test` — テスト（Vitest）
- `yarn lint` — oxlint（型情報あり）・textlint・oxfmt を書き換えつきで実行。**型情報ルールが`dist/*.d.ts`を読むため、先に`yarn build`**
- `yarn lint:check` — 書き換えずに同じ検査（CI 用）
- `yarn clean` — ビルド成果物の削除

### コマンド制約

- **yarn のみ使用**: npm/pnpm/bun/deno によるコマンド実行は禁止（`npm pack --dry-run`での`bin`の確認だけは例外）
- **build / lint / test は全体実行**: `tsc`・`oxlint`・`oxfmt`の単発実行・ファイルスコープ実行は禁止
- **コマンドの連続実行禁止**: `&&`、`;`、改行によるコマンド連結をしない。1回の Bash 呼び出しで1コマンドのみ実行する。連結されたコマンドは settings.json の permissions でパターンマッチできず、毎回ユーザーの手動承認が必要になる
- **main / dev ブランチでの作業・コミット禁止**: 作業開始前に`git branch --show-current`で現ブランチを確認し、`main`/`dev`にいる場合は`git switch -c <topic>`でトピックブランチを作ってから作業する

## 動作確認

`src/commands/`と`src/io/`にはユニットテストがないので、変更したら実際のリポジトリで確かめる。オーケストレーションディレクトリの`repos/`にクローンされたリポジトリで、`git fetch --tags origin`の後に実行する：

- `node <このリポジトリ>/dist/cli.js classify` — 読み取りのみ
- `node <このリポジトリ>/dist/cli.js lines-check` — 読み取りのみ
- `release-pr --dry-run`・`publish --dry-run` — GitHub に書き込まない。ただしトークンの環境変数が要る

GitHub や npm に書き込む実行（`--dry-run`なし）は、対象と内容を示してユーザーの承認を得てから行う。

## 自分自身のリリース

このリポジトリも運用ルールの対象で、自分の Release PR・公開をこの CLI で行う。ワークフローは npm に公開された版ではなく、そのコミットでビルドした`node dist/cli.js`を呼ぶ。壊れた版を公開しても、直したコミットのコードで次のリリースを出せるようにするため。

## 互換性

各リポジトリのワークフローと、すでに開いている PR・Issue が頼っているもの（コマンド、フラグ、環境変数、ラベル、チェック名、本文のマーカー、Renovate のルールの`description`、系列定義ファイルの書式、`exports`）を変える・消すのは破壊的変更。一覧は`.claude/rules/commands.md`。破壊的変更の扱いは git スキルの「破壊的変更と振る舞いの変更」に従い、利用側の移行手順を PR の`## 振る舞いの変更`に書く。

## ドキュメント原則

情報は置き場で役割が決まる。**コードには How、テストコードには What、コミットログには Why、コードコメントには Why not**（Why が必要なときは Why も書く）。

- **JSDoc = 公開 API（export）の API ユーザー向け文書**: WHAT/HOW/WHY を適切に書き、`@example`を必須とする。判定関数の JSDoc には、実装しているルールの番号と、その判定の順序・境界を書く
- **非公開 API の JSDoc は必須にしない**: ただし複雑な内部の設計 WHY/Why not はファイルレベル JSDoc に書く
- **README は利用者向け**: コマンド・フラグ・系列定義ファイル・環境変数。内部実装は書かない
- **計画相対概念の禁止**: 実装計画に由来する相対概念（Phase/Step 番号、「本 PR」「今回」「旧実装」「導入予定」）を JSDoc・テスト名・ドキュメントに書かない。コードコメント・JSDoc・テスト名に issue/PR 番号も書かず、理由そのものを書く（例外は PR 本文とコミットメッセージ）
- **ドキュメントと実装の矛盾**: README と実装の矛盾は実装を正として README を直す。ルール文書と実装の矛盾は、実装の誤りかルール文書の不足かをユーザーに聞く

## 判断基準

- **変更・修正・レビュー指摘を採用するかは3つで決める**: ルール文書のとおりに動くこと、互換性の契約を壊さないこと（壊すなら移行まで含めること）、`.claude/rules/commands.md`の安全を守ること。製品の振る舞いでない変更（tooling・docs・CI・skills）では「宣言した意図に対する正しさ」と「既存コードとの一貫性」。実装コスト、diff の大きさ、影響件数、「軽微」は基準ではなく、スキップ・先送り・質問の理由にならない
- **基準が決めることは聞かずにやる**。質問は、基準が決めないことと、リポジトリ外への書き込みのためにある（質問の種別は`impl`スキルが定める）。Claude は「持ち越す」「スキップする」「そのままにする」を自分で決めない。それらは質問に対するユーザーの回答としてだけ存在する
- **レビュー指摘は直すか、証拠を添えてユーザーに出す**。「false positive」「元からあった」「意図どおり」はユーザーに対して主張することであって、Claude が1人で指摘を閉じる手段ではない

## 依存関係の追加

- 実行時の依存（`dependencies`）は最小に保つ。このコードはトークンを持って動くので、依存が1つ増えるごとに、全リポジトリの公開経路に入るコードが増える。Node.js の標準モジュールで足りるものに依存を足さない
- バージョンは固定で追加する（`yarn add foo@1.2.3`）。`^`/`~`を付けない（`.yarnrc.yml`の`defaultSemverRangePrefix: ''`）
- 追加したら`.github/renovate.json`の`packageRules`を確認し、片方だけ上がるとビルドや型検査が通らない依存は同じ`groupName`にまとめる

## セキュリティ

### 機密情報の取り扱い

- `.env`、`.env.*`等の機密ファイルを読み取り・編集・コミットしない（機密ファイルの判断は`.gitignore`を参考にすること）
- コミット前に`git diff --staged`で機密情報（API キー、トークン、パスワード、企業名、顧客情報）が含まれていないか確認する
- **サンプル値は予約済み慣例に従う**: ドメインは`example.com`/`*.example`/`*.test`等（RFC 2606/6761）、IP は TEST-NET。実在の無関係ドメイン、未取得の創作ドメイン、案件識別子、実データ・実コーパスの断片を成果物に残さない（詳細は`.claude/skills/git/SKILL.md`のサンプル値慣例チェック）
- 環境変数やシークレットをコード内にハードコードしない

### サプライチェーン保護

- **yarn dlx は完全禁止**: ローカルパッケージを使わずリモートから直接実行するため、サプライチェーン攻撃に脆弱
- **npx は原則使わない**: package.json の scripts で定義されたコマンドを`yarn <script>`で実行すること
- 新しい依存パッケージの追加は慎重に。既存の依存で解決できないか先に確認する
- `yarn add`する前にパッケージの信頼性（ダウンロード数、メンテナンス状況、既知の脆弱性）を確認する
- `yarn add`する場合はバージョンを固定する（例: `yarn add foo@1.2.3`）
- lockfile（yarn.lock）の手動編集は禁止
- **`.yarnrc.yml`の保護設定を無効化しない**: `enableScripts: false`と`npmMinimalAgeGate: 3d`

## スキル

| スキル          | パス                                      | 用途                                                                       |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Grill me        | `.claude/skills/grill-me/SKILL.md`        | 計画・設計の前提を掘り下げて合意形成する                                   |
| Impl            | `.claude/skills/impl/SKILL.md`            | 合意済み計画の実装・検証・持ち越しの Issue 化・PR 作成・マージ後の台帳確認 |
| Git             | `.claude/skills/git/SKILL.md`             | コミット規約・コミット前コンテンツチェック・破壊的変更の扱い               |
| PR              | `.claude/skills/pr/SKILL.md`              | PR 作成フロー（base 追従・本文の節構成・push はユーザー実行・CI 監視）     |
| Merged          | `.claude/skills/merged/SKILL.md`          | マージ後の手順                                                             |
| Create issue    | `.claude/skills/create-issue/SKILL.md`    | 原因まで調べて Issue を起票する                                            |
| Product Manager | `.claude/skills/product-manager/SKILL.md` | ドキュメント整合チェック、PR レビュー                                      |
| QA Engineer     | `.claude/skills/qa-engineer/SKILL.md`     | テスト品質チェック                                                         |

コミットは必ず`.claude/skills/git/SKILL.md`、PR 作成は`.claude/skills/pr/SKILL.md`の手順に従うこと。
