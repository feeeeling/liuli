import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, languageName } from "./prompts.ts";
import { isAuthKind, isTaskMode, parseTask } from "./types.ts";

test("parseTask accepts translate payload", () => {
  const task = parseTask(
    JSON.stringify({ mode: "translate", text: "hello", targetLang: "zh" }),
  );
  assert.equal(task.mode, "translate");
  assert.equal(task.text, "hello");
  assert.equal(task.targetLang, "zh");
});

test("parseTask rejects unknown mode", () => {
  assert.throws(() => parseTask(JSON.stringify({ mode: "chat" })), /无效 mode/);
});

test("guards", () => {
  assert.equal(isTaskMode("ocr-translate"), true);
  assert.equal(isTaskMode("foo"), false);
  assert.equal(isAuthKind("oauth"), true);
  assert.equal(isAuthKind("password"), false);
});

test("translate prompt is terse", () => {
  const prompt = buildUserPrompt({
    mode: "translate",
    text: "Hello",
    hasImage: false,
    targetLang: "zh",
  });
  assert.match(prompt, /只输出译文/);
  assert.match(prompt, /Hello/);
  assert.equal(languageName("ja"), "日本語");
});

test("latex prompt prefers array not aligned", () => {
  const prompt = buildUserPrompt({
    mode: "latex",
    hasImage: true,
  });
  assert.match(prompt, /array/);
  assert.match(prompt, /不要 markdown/);
});

test("ocr-translate asks for two sections", () => {
  const prompt = buildUserPrompt({
    mode: "ocr-translate",
    text: "draft",
    hasImage: true,
    targetLang: "en",
  });
  assert.match(prompt, /<<<原文>>>/);
  assert.match(prompt, /<<<译文>>>/);
});
