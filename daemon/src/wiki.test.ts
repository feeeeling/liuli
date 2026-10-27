import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { expandHome, readWikiPage, resolveUnderWiki, searchWiki } from "./wiki.ts";

function makeWiki(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liuli-wiki-"));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(
    path.join(root, "wiki", "blockchain-oracle.md"),
    "# Oracle\n\nChainlink OCR is a blockchain oracle protocol.\n",
  );
  fs.writeFileSync(
    path.join(root, "wiki", "tieta.md"),
    "# 铁塔\n\n低空飞行管理平台。\n",
  );
  return root;
}

test("wiki search ranks relevant pages", () => {
  const root = makeWiki();
  const hits = searchWiki(root, "oracle chainlink");
  assert.ok(hits.some((h) => h.path.includes("blockchain-oracle")));
});

test("wiki read returns page body", () => {
  const root = makeWiki();
  const body = readWikiPage(root, "wiki/tieta.md");
  assert.match(body, /低空飞行/);
});

test("wiki path cannot escape the root", () => {
  const root = makeWiki();
  assert.throws(() => resolveUnderWiki(root, "../etc/passwd"), /超出/);
});

test("Windows home paths expand like slash-separated home paths", () => {
  assert.equal(expandHome("~\\资料 库"), path.join(os.homedir(), "资料 库"));
  assert.equal(expandHome("~/资料 库"), path.join(os.homedir(), "资料 库"));
});

test("wiki supports Chinese paths, backslashes, uppercase Markdown and CRLF", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liuli-中文 wiki-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "wiki", "知识.MD"),
    "---\r\ntitle: metadata\r\n---\r\n# 知识\r\n\r\nWindows 兼容性\r\n");
  const hits = searchWiki(root, "兼容性");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "wiki/知识.MD");
  assert.equal(hits[0].summary, "# 知识");
  assert.match(readWikiPage(root, "wiki\\知识.MD"), /Windows 兼容性/);
});

test("Windows drive paths and backslash traversal cannot escape the wiki", {
  skip: process.platform !== "win32",
}, () => {
  const root = path.resolve(os.tmpdir(), "liuli-wiki");
  assert.throws(() => resolveUnderWiki(root, "..\\outside.md"), /超出/);
  assert.throws(() => resolveUnderWiki(root, path.resolve(root, "..", "outside.md")), /超出/);
  assert.equal(resolveUnderWiki(root, path.join(root.toUpperCase(), "page.md")),
    path.join(root.toUpperCase(), "page.md"));
});
