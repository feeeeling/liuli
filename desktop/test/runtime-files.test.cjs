const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { includeRuntimeFile } = require("../runtime-files.cjs");

test("packaging preserves SDK clipboard helpers and Windows native dependencies", () => {
  for (const parts of [
    ["@earendil-works", "pi-coding-agent", "dist", "utils", "clipboard-image.js"],
    ["@earendil-works", "pi-coding-agent", "node_modules", "@esbuild", "win32-x64", "esbuild.exe"],
    ["@mariozechner", "clipboard-win32-x64-msvc", "index.node"],
    ["undici", "index.js"],
  ]) assert.equal(includeRuntimeFile(path.join(...parts), "x64"), true);
});

test("packaging drops build tools and only foreign native package variants", () => {
  for (const parts of [
    ["tsx", "dist", "cli.mjs"], ["typescript", "bin", "tsc"],
    ["@esbuild", "win32-x64"],
    ["@earendil-works", "pi-coding-agent", "node_modules", "@esbuild", "darwin-arm64"],
    ["@mariozechner", "clipboard-linux-x64-gnu", "index.node"],
    ["@mariozechner", "clipboard-win32-arm64-msvc", "index.node"],
  ]) assert.equal(includeRuntimeFile(path.join(...parts), "x64"), false);
});
