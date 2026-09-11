# GitLab Review Workspace

[English](./README.md) | **日本語**

GitLabのMerge Requestを、VS Codeから離れずに確認・レビューするための拡張機能です。変更ファイル、コミット、ディスカッション、ローカル編集を1つのレビュー環境にまとめます。

> [!NOTE]
> GitLab Review Workspaceはコミュニティ製の非公式拡張です。GitLab Inc.による公式製品ではありません。

## 主な機能

- Activity Barの`GitLab Review`からMRを選択・更新
- 変更ファイルと差分統計をツリー表示
- MR全体またはコミット単位で変更を確認
- 新しいpushを検出し、前回のheadから追加された変更だけを比較
- VS Code標準diff editorでMR差分を表示
- GitLabディスカッションの作成、返信、編集、Resolve/Reopen
- 差分行の選択からディスカッションを作成
- コメントへの画像貼り付け・添付
- Changed filesをパスやレビュー状態で絞り込み
- レビューコメントを本文・投稿者・ファイルパスで検索
- GitLab Todo通知から対象MRへ移動
- ソース/ターゲットブランチのファイルを閲覧
- レビュー用ローカル編集をMR差分と分離して保存
- 一時的な通信失敗時に直近のレビューをキャッシュ表示

## 画面構成

- **My work**: 自分の作業一覧からレビュー対象MRを選択
- **Sidebar**: 変更ファイル、コミット、レビュースレッドを移動
- **VS Code diff editor**: 主なレビュー画面。標準コードナビゲーションとインラインディスカッションに対応
- **Review file panel（Legacy Viewer）**: MR差分・コミット差分・ローカル差分を確認する代替ビュー
- **Branch file editor**: GitLab上のブランチファイルを読み取り専用で表示

サイドバーの変更ファイルまたはレビュースレッドを選ぶと、標準diff editorで対象ファイルを開き、該当行まで移動します。

コメント入力ではMarkdownを利用できます。画像は入力欄へ直接貼り付けるか、`Attach Image and Comment`から添付できます。

表示中の差分はGitLab接続先・MR・SHAに固定されます。レビューコンテキストが変わった場合、古い下書きは保持しつつ、誤ったMRや差分への投稿を防ぎます。

## 必要環境

- VS Code 1.97以降
- [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli)
- `glab auth login`済みのGitLabアカウント

拡張機能はGitLabアクセストークンを保存しません。認証は`glab`とOSの資格情報ストアに委ねます。

## インストール

Visual Studio Marketplaceから **GitLab Review Workspace** をインストールします。

コマンドラインからインストールする場合:

```bash
code --install-extension ota-takeru.gitlab-review-workspace
```

GitHub Releasesの`.vsix`を使う場合は、VS CodeのExtensionsビューから **Install from VSIX...** を選択してください。

インストール後、`glab auth login`を実行してからActivity Barの`GitLab Review`を開いてください。

## 設定

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `gitlabReview.gitlabBaseUrl` | `https://gitlab.com` | GitLabインスタンスURL。カスタムドメイン、ポート、サブパスに対応 |
| `gitlabReview.projectId` | 空 | 初期表示するGitLabプロジェクトIDまたはURLエンコード済みパス |
| `gitlabReview.mergeRequestIid` | 空 | 初期表示するMR IID |

`gitlabReview.gitlabBaseUrl`を明示設定しない場合は、`glab auth status --all`から認証済みホストを自動検出します。複数ある場合は、現在のワークスペースのGitリモートと一致するホストを優先します。

## サポート

不具合報告・機能要望は[GitHub Issues](https://github.com/ota-takeru/gitlab-review-workspace/issues)へお願いします。アクセストークン、Authorizationヘッダー、認証情報、非公開MRの内容は貼り付けないでください。

詳細は[`SUPPORT.md`](./SUPPORT.md)を参照してください。

## 開発者向け情報

ビルド、テスト、Storybook、UI検証などの開発情報は、Marketplace向けREADMEではなく開発ドキュメント側にまとめています。

- [開発・検証ガイド](./docs/DEVELOPMENT.md)
- [UIデザインガイド](./docs/UI_DESIGN.md)
- [Storybookガイド](./docs/STORYBOOK.md)
- [変更履歴](./CHANGELOG.md)
- [MIT License](./LICENSE)
