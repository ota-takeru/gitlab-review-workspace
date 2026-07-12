import assert from "node:assert/strict";
import test from "node:test";
import { applyMarkdownFormat } from "../markdownFormatting";

test("inline formats wrap selected text and retain an inner selection", () => {
  assert.deepEqual(applyMarkdownFormat("before selected after", 7, 15, "bold"), {
    value: "before **selected** after",
    selectionStart: 9,
    selectionEnd: 17
  });
  assert.deepEqual(applyMarkdownFormat("abc", 0, 3, "italic"), {
    value: "_abc_", selectionStart: 1, selectionEnd: 4
  });
  assert.equal(applyMarkdownFormat("abc", 0, 3, "strikethrough").value, "~~abc~~");
  assert.equal(applyMarkdownFormat("abc", 0, 3, "inline-code").value, "`abc`");
});

test("empty inline selections insert and select sensible placeholders", () => {
  assert.deepEqual(applyMarkdownFormat("say ", 4, 4, "bold"), {
    value: "say **text**", selectionStart: 6, selectionEnd: 10
  });
  assert.deepEqual(applyMarkdownFormat("", 0, 0, "inline-code"), {
    value: "`code`", selectionStart: 1, selectionEnd: 5
  });
});

test("links target the URL for selected text and the label when empty", () => {
  assert.deepEqual(applyMarkdownFormat("visit GitLab now", 6, 12, "link"), {
    value: "visit [GitLab](url) now", selectionStart: 15, selectionEnd: 18
  });
  assert.deepEqual(applyMarkdownFormat("visit ", 6, 6, "link"), {
    value: "visit [link text](url)", selectionStart: 7, selectionEnd: 16
  });
});

test("quote prefixes every intersecting line and preserves surrounding content", () => {
  assert.deepEqual(applyMarkdownFormat("header\none\ntwo\nfooter", 9, 12, "quote"), {
    value: "header\n> one\n> two\nfooter",
    selectionStart: 7,
    selectionEnd: 18
  });
});

test("a selection ending at the next line start does not format that next line", () => {
  assert.deepEqual(applyMarkdownFormat("one\ntwo\nthree", 0, 4, "bulleted-list"), {
    value: "- one\ntwo\nthree",
    selectionStart: 0,
    selectionEnd: 5
  });
});

test("empty block selection formats the whole current line", () => {
  assert.deepEqual(applyMarkdownFormat("before\ncurrent\nafter", 10, 10, "bulleted-list"), {
    value: "before\n- current\nafter",
    selectionStart: 7,
    selectionEnd: 16
  });
});

test("numbered lists number selected lines sequentially", () => {
  assert.deepEqual(applyMarkdownFormat("lead\nalpha\nbeta\ngamma\ntail", 5, 21, "numbered-list"), {
    value: "lead\n1. alpha\n2. beta\n3. gamma\ntail",
    selectionStart: 5,
    selectionEnd: 30
  });
});
