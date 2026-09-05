# GitLab Review Workspace

GitLabのMerge Requestを、VS Codeから離れずに確認・レビューするための拡張機能です。変更ファイル、コミット、ディスカッション、ローカル編集を1つのレビュー環境にまとめます。

> [!NOTE]
> 現在はGitHub ReleasesでVSIXを配布しています。Visual Studio Marketplaceには未公開です。

## 主な機能

- Activity Barの`GitLab Review`からMRを選択・更新
- 変更ファイルと差分統計をツリー表示
- MR全体またはコミット単位で変更を確認
- 新しいpushを検出し、前回のheadから追加された変更だけを比較
- コミット差分を閲覧し、現在のMR差分へ戻ってコメント
- 差分行のクリック・ドラッグ選択からディスカッションを作成
- VS Code標準diff editorでMR差分を開き、Comment APIからディスカッションを作成・返信
- コメントの返信、編集、Resolve/Reopen
- Changed filesをパスと状態（新規push・未解決・ローカル編集）で絞り込み
- MR内のレビューコメントを本文・投稿者・ファイルパスで検索
- GitLab Todo通知から対象MRへ移動
- ソース/ターゲットブランチのファイルツリーを閲覧
- レビュー用のローカル編集を保存し、MR差分と区別して表示
- 通信失敗時にも直近のレビューを表示する限定キャッシュ

## 画面構成

- **My work**: 自分の作業一覧からレビューするMRを選択
- **Sidebar**: 選択したMRの変更ファイル、コミット、レビュースレッドを移動
- **VS Code diff editor**: 主なレビュー画面。標準のコードナビゲーションとComment APIによるインラインディスカッション
- **Review file panel（Legacy Viewer）**: MR差分・コミット差分、ローカル差分、インラインディスカッション、ローカル編集
- **Branch file editor**: GitLab上のブランチファイルを読み取り専用で表示

サイドバーの変更ファイルまたはレビュースレッドを選ぶと、標準diff editorで対象ファイルを開き、スレッドの行までスクロールします。従来のReview file panelも残してあり、`GitLab Review: Open Review File in Legacy Viewer`から開けます。

標準diff editorのコメント入力ではMarkdownを利用できます。画像は入力欄への貼り付けでGitLabへアップロードしてMarkdownを挿入するほか、`Attach Image and Comment`でファイルを選択し、現在の本文と画像をまとめて投稿できます。

異なるMRや差分版の入力を保持していて貼り付け先を確定できない場合、画像貼り付けは無効になります。その場合は投稿先の入力欄で`Attach Image and Comment`を使用してください。

表示中の差分は接続先・MR・SHAに固定されます。接続先や差分が変わった場合は古い入力からの投稿を止め、本文を残します。過去コミットは閲覧用で、現在のMR差分を開いてから新規コメントを作成します。レビュー進捗の割合や確認済み管理は現在の画面には表示しません。

旧バージョンのホスト未分離キャッシュは自動移行せず、MRを再取得します。保存済みの旧ローカル編集は削除しません。`GitLab Review: Recover Local Drafts from Earlier Versions`で内容を開き、対象を確認してコピーできます。

## 必要環境

- VS Code 1.97以降
- Node.jsとnpm
- [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli)
- `glab auth login`済みのGitLabアカウント

拡張機能はGitLabトークンを保存しません。認証は`glab`とOSの資格情報ストアに委ねます。

## インストール

1. [GitHub Releases](https://github.com/ota-takeru/gitlab-review-workspace/releases)から最新の`.vsix`をダウンロードします。
2. VS CodeのExtensionsビューで右上の`…`を開き、`Install from VSIX...`を選択します。
3. ダウンロードしたVSIXを選択し、必要に応じてVS Codeを再読み込みします。

コマンドラインからインストールする場合は次を実行します。

```bash
code --install-extension gitlab-review-workspace-0.0.7.vsix
```

インストール後、`glab auth login`を実行してからActivity Barの`GitLab Review`を開いてください。

## セットアップ

```bash
npm ci
npm run check
npm test
```

VS Codeでこのフォルダを開き、`Run and Debug`から`Run Extension`を実行します。起動したExtension Development HostでActivity Barの`GitLab Review`を開いてください。

`glab`が未ログインの場合は、サイドバーの`Sign in`から統合ターミナルでログインを開始できます。

## 設定

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `gitlabReview.gitlabBaseUrl` | `https://gitlab.com` | GitLabインスタンスURL（任意。カスタムドメイン、ポート、サブパスに対応） |
| `gitlabReview.projectId` | 空 | 初期表示するプロジェクトIDまたはURLエンコード済みパス |
| `gitlabReview.mergeRequestIid` | 空 | 初期表示するMR IID |

保存済みの選択も`projectId`・`mergeRequestIid`の指定もない場合は、`Open My work`から対象MRを選択します。

`gitlabReview.gitlabBaseUrl`を設定しない場合は、`glab auth status --all`で認証済みのホストを自動検出します。複数のホストがある場合は、ワークスペースのGitリモートと一致するホストを優先します。必要に応じて、`https://gitlab.example.com:8443/gitlab`のようなURLを明示設定することもできます。

## 開発コマンド

| コマンド | 用途 |
| --- | --- |
| `npm run check` | Extension HostとVueの型チェック。通常の編集後に最初に実行 |
| `npm run compile` | Hostコードと3つのWebviewをビルド |
| `npm test` | クリーンビルド後に全Nodeテストを実行 |
| `npm run watch` | HostとWebviewを監視ビルド |
| `npm run storybook -- --no-open` | UI状態カタログを`localhost:6006`で起動 |
| `npm run test:storybook` | Chromiumでstory・interaction・a11yテストを実行 |
| `npm run build:storybook` | Storybookのproduction build |
| `npm run ui:capture` | 固定Storybook状態を撮影し、light/dark比較用デザインボードを生成 |
| `npm run ui:verify` | 型、Storybook、a11y、production build、UI撮影を一括検証 |
| `npm run clean` | `out/`を削除 |

`out/`と`media/webview/`のJavaScript/CSSは生成物です。直接編集せず、`src/`または`webview/`を変更して再ビルドしてください。

## プロジェクト構成

```text
src/
  extension.ts            VS Code拡張のエントリーポイント
  reviewStore.ts          MR状態、更新、キャッシュ、楽観的更新
  gitlabApi.ts            glab経由のGitLab APIアクセス
  sidebarProvider.ts      Sidebar Webviewのホスト
  reviewFilePanel.ts      レビューファイルパネルのホスト
  nativeReviewEditor.ts   VS Code標準diffとComment APIのホスト
  commitDiffPanel.ts      コミット差分パネルのホスト
  webviewProtocol.ts      HostとWebview間のメッセージ契約
  test/                   Nodeテスト
webview/
  sidebar/                Sidebar Vueアプリ
  review-file/            レビュー差分Vueアプリ
  commit-diff/            コミット差分Vueアプリ
  common/                 共通コンポーネント、テーマ、VS Code APIラッパー
media/
  gitlab-review.svg       Activity Barアイコン
  webview/                Vite生成物
docs/
  DEVELOPMENT.md          開発・デバッグ・検証手順
  UI_DESIGN.md            UI設計契約と視覚QA基準
  CODEX_TASKS.md          新規Codexチャット用の依頼テンプレート
```

## アーキテクチャ

```mermaid
flowchart LR
  VSCode["VS Code commands / views"] --> Host["Extension Host"]
  Host --> Store["ReviewStore"]
  Store --> API["GitLabReviewClient"]
  API --> Glab["glab CLI"]
  Glab --> GitLab["GitLab API"]
  Store --> Protocol["Typed webview messages"]
  Store --> Native["VS Code diff / Comment API"]
  Protocol --> Sidebar["Sidebar Vue app"]
  Protocol --> Review["Review file Vue app (MR / commit diff)"]
```

HostとWebview間では`src/webviewProtocol.ts`の型付きメッセージのみを使います。HTML断片や認証情報をWebviewへ渡さないでください。

## Codexで作業する場合

リポジトリ直下の[`AGENTS.md`](./AGENTS.md)は、新規Codexチャットで自動的に読み込まれる永続ガイダンスです。タスク固有の目的、再現手順、制約、完了条件だけを新しいチャットで追加してください。

依頼文の例は[`docs/CODEX_TASKS.md`](./docs/CODEX_TASKS.md)にあります。UI変更では[`docs/ui/project-profile.yaml`](./docs/ui/project-profile.yaml)、[`docs/ui/visual-quality.md`](./docs/ui/visual-quality.md)、該当する[画面ブリーフ](./docs/ui/screens/)を読み、`$ui-review`による変更前の独立評価、上位3件までの修正、`npm run ui:capture`が生成するデザインボードでの同条件比較を依頼してください。

## 詳細ドキュメント

- [開発・検証ガイド](./docs/DEVELOPMENT.md)
- [UIデザイン契約](./docs/UI_DESIGN.md)
- [プロジェクトUIプロファイル](./docs/ui/project-profile.yaml)
- [視覚品質契約](./docs/ui/visual-quality.md)
- [画面別UIブリーフ](./docs/ui/screens/)
- [Storybook・エージェントUI検証](./docs/STORYBOOK.md)
- [Codexタスクテンプレート](./docs/CODEX_TASKS.md)
