import assert from "node:assert/strict";
import test from "node:test";
import { buildContinuePrompt, buildUserPrompt, languageName } from "./prompts.ts";
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

test("parseTask reads explain action and keepSession", () => {
  const task = parseTask(
    JSON.stringify({
      mode: "translate",
      action: "explain",
      keepSession: true,
      context: "hello",
      reading: "Safari",
      wikiRoot: "/tmp/wiki",
    }),
  );
  assert.equal(task.action, "explain");
  assert.equal(task.keepSession, true);
  assert.equal(task.context, "hello");
  assert.equal(task.reading, "Safari");
  assert.equal(task.wikiRoot, "/tmp/wiki");
});

test("explain prompt is brief and can seed context", () => {
  const prompt = buildContinuePrompt({
    action: "explain",
    context: "Hello world",
    seedContext: true,
    targetLang: "zh",
  });
  assert.match(prompt, /两三句/);
  assert.match(prompt, /Hello world/);
  assert.match(prompt, /简体中文/);
});

test("followup prompt uses the question and skips seed when session exists", () => {
  const prompt = buildContinuePrompt({
    action: "followup",
    text: "这个词是什么意思？",
    context: "should not appear",
    seedContext: false,
    targetLang: "zh",
  });
  assert.match(prompt, /这个词是什么意思？/);
  assert.doesNotMatch(prompt, /should not appear/);
});

test("continue prompt mentions wiki tools without injecting pages", () => {
  const prompt = buildContinuePrompt({
    action: "followup",
    text: "和预言机有什么关系？",
    seedContext: false,
    reading: "应用：Safari\n网址：https://example.com/oracle",
    wikiAvailable: true,
    targetLang: "zh",
  });
  assert.match(prompt, /Safari/);
  assert.match(prompt, /wiki_search/);
  assert.match(prompt, /wiki_read/);
  assert.match(prompt, /多轮/);
  assert.doesNotMatch(prompt, /Chainlink/);
  assert.match(prompt, /和预言机有什么关系？/);
});
