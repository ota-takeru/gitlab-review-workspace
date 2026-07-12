import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../markdownRenderer";

test("renders supported inline Markdown as semantic HTML", () => {
  assert.equal(
    renderMarkdown("**bold** _italic_ ~~removed~~ `code`"),
    "<p><strong>bold</strong> <em>italic</em> <del>removed</del> <code>code</code></p>"
  );
});

test("renders links, quotes, and lists", () => {
  assert.equal(
    renderMarkdown("> note\n\n- one\n- two\n\n1. first\n2. second\n\n[GitLab](https://gitlab.com)"),
    "<blockquote>note</blockquote><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol><p><a href=\"https://gitlab.com\" target=\"_blank\" rel=\"noopener noreferrer\">GitLab</a></p>"
  );
});

test("renders safe image Markdown and refuses unsafe image schemes", () => {
  assert.equal(
    renderMarkdown("![Screenshot](data:image/png;base64,AAAA) ![Logo](https://example.com/logo.png)"),
    "<p><img src=\"data:image/png;base64,AAAA\" alt=\"Screenshot\" loading=\"lazy\"> <img src=\"https://example.com/logo.png\" alt=\"Logo\" loading=\"lazy\"></p>"
  );
  assert.doesNotMatch(renderMarkdown("![bad](javascript:alert(1))"), /<img /);
});

test("marks GitLab upload images for host-side resolution", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  assert.equal(
    renderMarkdown(`![Screenshot](/uploads/${secret}/screenshot.png)`),
    `<p><img data-comment-image-path=\"/uploads/${secret}/screenshot.png\" alt=\"Screenshot\" loading=\"lazy\"></p>`
  );
  assert.equal(
    renderMarkdown(`![image\\[1\\] *raw*](/uploads/${secret}/image.png)`),
    `<p><img data-comment-image-path=\"/uploads/${secret}/image.png\" alt=\"image[1] *raw*\" loading=\"lazy\"></p>`
  );
});

test("escapes untrusted text and refuses unsafe link schemes", () => {
  assert.equal(
    renderMarkdown("<img src=x onerror=alert(1)> [bad](javascript:alert(1))"),
    "<p>&lt;img src=x onerror=alert(1)&gt; [bad](javascript:alert(1))</p>"
  );
  assert.doesNotMatch(renderMarkdown("[bad](https://example.com/\" onmouseover=alert(1))"), /<a /);
});

test("preserves line breaks inside paragraphs", () => {
  assert.equal(renderMarkdown("first line\nsecond line"), "<p>first line<br>second line</p>");
});
