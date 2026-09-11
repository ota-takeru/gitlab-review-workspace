# Marketplace release checklist

1. Confirm `npm ci`, `npm run check`, and `npm test` pass.
2. Build the package with `npx @vscode/vsce package` or the GitHub Actions packaging workflow.
3. Inspect the generated VSIX before upload.
4. Upload the VSIX to the `ota-takeru` publisher in Visual Studio Marketplace.
5. After publication, verify installation with `code --install-extension ota-takeru.gitlab-review-workspace`.
6. Decide and add an explicit software license before advertising the project as open source. The repository currently does not grant an open-source license.
