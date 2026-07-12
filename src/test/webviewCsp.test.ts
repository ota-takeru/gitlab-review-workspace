import assert from "node:assert/strict";
import test from "node:test";
import { webviewContentSecurityPolicy } from "../webviewCsp";

test("webview CSP permits extension, data, and HTTPS images without relaxing the default", () => {
  const csp = webviewContentSecurityPolicy("vscode-webview://example");

  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /img-src vscode-webview:\/\/example data: https:/);
  assert.doesNotMatch(csp, /default-src[^;]*data:/);
  assert.doesNotMatch(csp, /img-src[^;]*\bhttp:/);
});
