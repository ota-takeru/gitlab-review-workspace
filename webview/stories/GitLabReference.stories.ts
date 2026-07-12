import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, within } from "storybook/test";
import "./GitLabReference.css";

type ReferenceLink = {
  kind: "Live UI" | "GitLab Docs" | "Pajamas";
  label: string;
  href: string;
};

type Feature = {
  id: string;
  title: string;
  capability: string;
  comparison: string;
  extensionSpecific?: boolean;
  links: ReferenceLink[];
};

type Section = {
  title: string;
  features: Feature[];
};

const sections: Section[] = [
  {
    title: "Connection & workspace",
    features: [
      {
        id: "glab-authentication",
        title: "glab authentication",
        capability: "glab で GitLab へのログイン状態を確認・更新する。",
        comparison: "認証開始、アカウント表示、失効時の再ログイン導線を比較。",
        links: [
          { kind: "GitLab Docs", label: "glab CLI", href: "https://docs.gitlab.com/cli/" },
          { kind: "GitLab Docs", label: "glab auth login", href: "https://docs.gitlab.com/cli/auth/login/" }
        ]
      },
      {
        id: "local-workspace-context",
        title: "Local workspace context",
        capability: "レビュー対象の MR と、現在の branch・dirty 状態・既存 worktree を別の状態として表示する。",
        comparison: "MR を切り替えても自動 checkout せず、明示操作で branch や worktree を開く安全設計を比較。",
        extensionSpecific: true,
        links: [
          { kind: "GitLab Docs", label: "VS Code projects", href: "https://docs.gitlab.com/editor_extensions/visual_studio_code/projects/" },
          { kind: "GitLab Docs", label: "Forking workflow", href: "https://docs.gitlab.com/user/project/repository/forking_workflow/" }
        ]
      },
      {
        id: "merge-request-selection",
        title: "Merge request selection",
        capability: "設定したプロジェクトと IID のマージリクエストを開く。",
        comparison: "MR 一覧からの選択、状態、権限表示を比較。",
        links: [
          { kind: "Live UI", label: "Project merge requests", href: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests" },
          { kind: "GitLab Docs", label: "Merge requests", href: "https://docs.gitlab.com/user/project/merge_requests/" }
        ]
      }
    ]
  },
  {
    title: "Work queue",
    features: [
      {
        id: "my-work-queue",
        title: "My work queue",
        capability: "Todo、担当、レビュー依頼、自分の Draft・Ready MR を Action required / In progress / Waiting に集約する。",
        comparison: "メンション、承認要求、pipeline failure、conflict を含む対応理由と優先順位を比較。",
        links: [
          { kind: "Live UI", label: "Your merge requests", href: "https://gitlab.com/dashboard/merge_requests" },
          { kind: "Live UI", label: "To-do list", href: "https://gitlab.com/dashboard/todos" },
          { kind: "GitLab Docs", label: "To-dos", href: "https://docs.gitlab.com/user/todos/" }
        ]
      },
      {
        id: "mr-candidates",
        title: "MR candidates",
        capability: "GitLab fork の origin へ push 済みで、upstream 向け open MR がない branch を候補として示す。",
        comparison: "origin / upstream、source / target、commit 数を示し、MR 作成は自動実行しない境界を比較。",
        extensionSpecific: true,
        links: [
          { kind: "GitLab Docs", label: "Forking workflow", href: "https://docs.gitlab.com/user/project/repository/forking_workflow/" },
          { kind: "GitLab Docs", label: "Create an MR from a branch", href: "https://docs.gitlab.com/topics/git/merge/" }
        ]
      }
    ]
  },
  {
    title: "Review navigation",
    features: [
      {
        id: "changed-files",
        title: "Changed files",
        capability: "レビュー対象の変更ファイルを一覧し、選択した差分へ移動する。",
        comparison: "追加・削除数、選択状態、discussion badge、折りたたみとファイル階層を比較。",
        links: [
          { kind: "GitLab Docs", label: "MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" },
          { kind: "GitLab Docs", label: "Compare revisions", href: "https://docs.gitlab.com/user/project/repository/compare_revisions/" }
        ]
      },
      {
        id: "commits-and-commit-diff",
        title: "Commits & commit diff",
        capability: "MR のコミット履歴と各コミットの差分を閲覧する。",
        comparison: "コミット順、作者、個別差分への移動を比較。",
        links: [
          { kind: "Live UI", label: "Project commits", href: "https://gitlab.com/gitlab-org/gitlab/-/commits/master" },
          { kind: "GitLab Docs", label: "Compare revisions", href: "https://docs.gitlab.com/user/project/repository/compare_revisions/" }
        ]
      },
      {
        id: "branch-file-tree",
        title: "Branch file tree",
        capability: "ブランチ上のファイルツリーからレビューするファイルを開く。",
        comparison: "ブランチ選択、ツリー階層、ファイル表示を比較。",
        links: [
          { kind: "Live UI", label: "Repository tree", href: "https://gitlab.com/gitlab-org/gitlab/-/tree/master" },
          { kind: "Live UI", label: "Branches", href: "https://gitlab.com/gitlab-org/gitlab/-/branches" },
          { kind: "GitLab Docs", label: "Repository files", href: "https://docs.gitlab.com/user/project/repository/files/" },
          { kind: "GitLab Docs", label: "Branches", href: "https://docs.gitlab.com/user/project/repository/branches/" }
        ]
      }
    ]
  },
  {
    title: "Diff & local editing",
    features: [
      {
        id: "diff-review",
        title: "Diff review",
        capability: "MR 差分と commit 差分で同じ viewer を共有し、行または範囲を選択してコメントする。",
        comparison: "旧・新行番号、全文展開、選択範囲、diff 上の discussion 位置を比較。",
        links: [
          { kind: "GitLab Docs", label: "MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" },
          { kind: "GitLab Docs", label: "Compare revisions", href: "https://docs.gitlab.com/user/project/repository/compare_revisions/" }
        ]
      },
      {
        id: "local-review-drafts",
        title: "Local review drafts",
        capability: "MR のファイル内容に対するローカル編集を保存し、MR 差分とは別の Local changes として表示する。",
        comparison: "source branch が現在の workspace で開かれている場合だけ編集を許可し、保存・破棄を明示操作にする。",
        extensionSpecific: true,
        links: [
          { kind: "GitLab Docs", label: "Compare revisions", href: "https://docs.gitlab.com/user/project/repository/compare_revisions/" },
          { kind: "GitLab Docs", label: "VS Code projects", href: "https://docs.gitlab.com/editor_extensions/visual_studio_code/projects/" }
        ]
      }
    ]
  },
  {
    title: "Discussions & content",
    features: [
      {
        id: "inline-discussions",
        title: "Inline discussions",
        capability: "差分の行に紐付くスレッドを表示・返信する。",
        comparison: "行へのアンカー、返信、参加者表示を比較。",
        links: [
          { kind: "GitLab Docs", label: "Discussions", href: "https://docs.gitlab.com/user/discussions/" },
          { kind: "GitLab Docs", label: "MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" }
        ]
      },
      {
        id: "thread-lifecycle",
        title: "Thread lifecycle",
        capability: "スレッドの未解決・解決済み状態を更新し、レビュー進行を追う。",
        comparison: "解決操作、再オープン、承認前の残件を比較。",
        links: [
          { kind: "GitLab Docs", label: "Discussions", href: "https://docs.gitlab.com/user/discussions/" },
          { kind: "GitLab Docs", label: "Approvals", href: "https://docs.gitlab.com/user/project/merge_requests/approvals/" }
        ]
      },
      {
        id: "markdown-comments",
        title: "Markdown comments",
        capability: "コメント入力中に太字、引用、code、link、list を即時装飾し、保存後も Markdown として描画する。",
        comparison: "GitLab の rich text editor と GLFM の意味・表示を比較。",
        links: [
          { kind: "GitLab Docs", label: "Markdown", href: "https://docs.gitlab.com/user/markdown/" },
          { kind: "GitLab Docs", label: "Discussions", href: "https://docs.gitlab.com/user/discussions/" }
        ]
      },
      {
        id: "comment-images",
        title: "Comment images",
        capability: "コメントに画像を添付し、レビュー文脈で共有する。",
        comparison: "アップロード、貼り付け、表示、アクセス制御を比較。",
        links: [
          { kind: "GitLab Docs", label: "Markdown", href: "https://docs.gitlab.com/user/markdown/" },
          { kind: "GitLab Docs", label: "User file uploads", href: "https://docs.gitlab.com/security/user_file_uploads/" },
          { kind: "GitLab Docs", label: "Markdown uploads API", href: "https://docs.gitlab.com/api/project_markdown_uploads/" }
        ]
      }
    ]
  },
  {
    title: "Feedback & visual language",
    features: [
      {
        id: "async-cache-states",
        title: "Async & cache states",
        capability: "読み込み中、キャッシュ表示、更新失敗、再試行を明示する。",
        comparison: "待機、失敗、古いデータ、再読み込みの伝え方を比較。",
        links: [
          { kind: "Pajamas", label: "Spinner", href: "https://design.gitlab.com/components/spinner/" },
          { kind: "Pajamas", label: "Components and feedback", href: "https://design.gitlab.com/components/" }
        ]
      },
      {
        id: "visual-system",
        title: "Visual system",
        capability: "VS Code テーマ上で GitLab らしい色、バッジ、状態表現を揃える。",
        comparison: "色の役割、バッジ、コントラスト、テーマ切替を比較。",
        links: [
          { kind: "Pajamas", label: "Components", href: "https://design.gitlab.com/components/" },
          { kind: "Pajamas", label: "Badge", href: "https://design.gitlab.com/components/badge/" },
          { kind: "Pajamas", label: "Color", href: "https://design.gitlab.com/product-foundations/color/" }
        ]
      }
    ]
  }
];

const expectedFeatureIds = [
  "glab-authentication", "local-workspace-context", "merge-request-selection", "my-work-queue",
  "mr-candidates", "changed-files", "commits-and-commit-diff", "branch-file-tree", "diff-review",
  "local-review-drafts", "inline-discussions", "thread-lifecycle", "markdown-comments", "comment-images",
  "async-cache-states", "visual-system"
];

const criticalUrls = [
  "https://gitlab.com/dashboard/todos",
  "https://docs.gitlab.com/user/project/merge_requests/reviews/",
  "https://docs.gitlab.com/api/project_markdown_uploads/",
  "https://gitlab.com/gitlab-org/gitlab/-/branches",
  "https://design.gitlab.com/product-foundations/color/"
];

const meta = {
  title: "References/GitLab",
  render: () => ({
    setup() {
      return { sections, featureCount: expectedFeatureIds.length };
    },
    template: `
      <main class="gitlab-reference" aria-labelledby="gitlab-reference-title">
        <header class="gitlab-reference__header">
          <p class="gitlab-reference__eyebrow">Design reference</p>
          <div class="gitlab-reference__title-row">
            <div>
              <h1 id="gitlab-reference-title">GitLab reference</h1>
              <p class="gitlab-reference__intro">拡張機能の全ユーザー向け機能を、GitLab のライブ UI、公式ドキュメント、Pajamas と比較するためのカタログです。</p>
            </div>
            <p class="gitlab-reference__summary" aria-label="Coverage summary">{{ featureCount }} capabilities · {{ sections.length }} sections</p>
          </div>
        </header>
        <section v-for="section in sections" :key="section.title" class="gitlab-reference__section" :aria-labelledby="'section-' + section.title">
          <h2 :id="'section-' + section.title">{{ section.title }}</h2>
          <ul class="gitlab-reference__cards" :aria-label="section.title + ' reference cards'">
            <li v-for="feature in section.features" :key="feature.id" class="gitlab-reference__card" :data-feature-id="feature.id">
              <div class="gitlab-reference__card-heading">
                <h3>{{ feature.title }}</h3>
                <span v-if="feature.extensionSpecific" class="gitlab-reference__badge">Extension-specific</span>
              </div>
              <p><strong>Capability:</strong> {{ feature.capability }}</p>
              <p><strong>比較:</strong> {{ feature.comparison }}</p>
              <div class="gitlab-reference__links" :aria-label="feature.title + ' official references'">
                <a v-for="link in feature.links" :key="link.href" :href="link.href" target="_blank" rel="noopener noreferrer">
                  <span class="gitlab-reference__link-kind">{{ link.kind }}</span>{{ link.label }}
                </a>
              </div>
            </li>
          </ul>
        </section>
      </main>
    `
  }),
  parameters: { layout: "fullscreen" }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "GitLab reference" })).toBeVisible();
    await expect(canvas.getByLabelText("Coverage summary")).toBeVisible();

    for (const section of sections) {
      await expect(canvas.getByRole("heading", { name: section.title })).toBeVisible();
    }

    const cards = Array.from(canvasElement.querySelectorAll("[data-feature-id]")) as HTMLElement[];
    await expect(cards).toHaveLength(expectedFeatureIds.length);
    for (const id of expectedFeatureIds) {
      await expect(canvasElement.querySelectorAll(`[data-feature-id="${id}"]`)).toHaveLength(1);
    }

    for (const card of cards) {
      const links = Array.from(card.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      await expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
    }

    const hrefs = (Array.from(canvasElement.querySelectorAll("a[href]")) as HTMLAnchorElement[]).map((link) => link.href);
    for (const url of criticalUrls) {
      await expect(hrefs).toContain(url);
    }
  }
};
