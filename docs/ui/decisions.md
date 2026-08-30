# UI decisions

Record only decisions that should constrain later UI work. Revisit a decision when product evidence changes, not merely because another visual style is fashionable.

## 2026-07-18: Product and visual sources

**Accepted:** Use VS Code as the host-platform source for themes, focus, surfaces, and density. Use GitLab/Pajamas as the product source for merge-request concepts, discussions, status, and changed-file hierarchy. Use Material Design foundations only for system discipline such as semantic tokens, hierarchy, and complete interaction states.

**Consequence:** Do not pixel-copy GitLab or make the extension look like a standalone Material application. When sources conflict, preserve VS Code behavior and GitLab review meaning.

## 2026-07-18: Meaningful minimum Sidebar width

**Accepted:** Treat 320px as the meaningful minimum Sidebar width. A generic 390px mobile breakpoint is not the primary constraint because this product runs inside the VS Code workbench rather than a mobile browser.

**Consequence:** Maintain canonical 320x844 and 400x900 Sidebar evidence. Add smaller-width support only when a concrete VS Code use case requires it.

## 2026-07-18: Bounded improvement iterations

**Accepted:** Fix no more than three independently reviewed UI issues in one iteration.

**Consequence:** Run a review-only pass first, rank evidence-backed issues, implement the top three approved changes, and recapture the same conditions before starting another iteration.
