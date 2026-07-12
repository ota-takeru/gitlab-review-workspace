import * as vscode from "vscode";
import { webviewContentSecurityPolicy } from "./webviewCsp";

export type WebviewApp = "sidebar" | "review-file" | "commit-diff";

export function configureWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  app: WebviewApp,
  additionalLocalResourceRoots: readonly vscode.Uri[] = []
): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media", "webview"), ...additionalLocalResourceRoots]
  };
  webview.html = webviewShell(webview, extensionUri, app);
}

function webviewShell(webview: vscode.Webview, extensionUri: vscode.Uri, app: WebviewApp): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", `${app}.js`));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", "style.css"));
  const contentSecurityPolicy = webviewContentSecurityPolicy(webview.cspSource);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><link rel="stylesheet" href="${styleUri}"><title>GitLab Review</title></head><body><div id="app"></div><script type="module" src="${scriptUri}"></script></body></html>`;
}
