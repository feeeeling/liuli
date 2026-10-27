const test = require("node:test");
const assert = require("node:assert/strict");
const { unwrapLatex, splitTranslation } = require("../renderer/result-format.js");
const katex = require("katex");
test("LaTeX copy removes wrappers and renders aligned equations without trusted HTML", () => {
  const value = unwrapLatex('```latex\n$$\\begin{aligned}a&=\\frac{1}{2}\\\\b&=\\sqrt{x}\\end{aligned}$$\n```');
  assert.ok(value.startsWith("\\begin{aligned}"));
  assert.ok(katex.renderToString(value, { trust: false }).includes("katex-mathml"));
  assert.ok(!katex.renderToString(String.raw`\href{javascript:alert(1)}{x}`, { trust: false, throwOnError: false }).includes('href="javascript:'));
  assert.equal(unwrapLatex("\\[x^2\\]"), "x^2");
});
test("OCR translation splits both daemon markers and legacy labels", () => {
  assert.deepEqual(splitTranslation("<<<原文>>>\nHello\n<<<译文>>>\n你好"), { source: "Hello", translation: "你好" });
  assert.deepEqual(splitTranslation("原文\r\nHello\r\n译文\r\n你好"), { source: "Hello", translation: "你好" });
  assert.equal(splitTranslation("没有分隔标记的正常结果"), null);
});
