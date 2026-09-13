import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readWikiPage, resolveUnderWiki, searchWiki } from "./wiki.ts";

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
