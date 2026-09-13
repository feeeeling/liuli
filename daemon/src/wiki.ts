import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const MAX_SNIPPET = 220;
const MAX_READ = 8000;
const MAX_HITS = 8;

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function resolveUnderWiki(root: string, rel: string): string {
  const base = path.resolve(expandHome(root));
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(base, cleaned);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(prefix)) {
    throw new Error("路径超出 wiki 目录");
  }
  return target;
}

export interface WikiHit {
  path: string;
  score: number;
  summary: string;
  snippet: string;
}

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "raw") continue;
      walkMarkdown(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

function scoreText(haystack: string, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const text = haystack.toLowerCase();
  let score = 0;
  if (text.includes(q)) score += 8;
  for (const token of q.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2)) {
    if (text.includes(token)) score += token.length >= 4 ? 3 : 1;
  }
  return score;
}

export function searchWiki(root: string, query: string, limit = MAX_HITS): WikiHit[] {
  const base = path.resolve(expandHome(root));
  const wikiDir = fs.existsSync(path.join(base, "wiki"))
    ? path.join(base, "wiki")
    : base;
  const files = walkMarkdown(wikiDir);
  const hits: WikiHit[] = [];
  for (const file of files) {
    const rel = path.relative(base, file).replaceAll(path.sep, "/");
    if (rel === "wiki/log.md" || rel === "log.md") continue;
    let body = "";
    try {
      body = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const score = scoreText(`${rel}\n${body.slice(0, 4000)}`, query);
    if (score <= 0) continue;
    const snippet = body
      .replace(/^---[\s\S]*?---\n/, "")
      .trim()
      .slice(0, MAX_SNIPPET);
    hits.push({
      path: rel,
      score,
      summary: snippet.split("\n").find((line) => line.trim()) ?? "",
      snippet,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, Math.min(limit, MAX_HITS)));
}

export function readWikiPage(root: string, rel: string): string {
  const file = resolveUnderWiki(root, rel);
  if (!file.endsWith(".md")) throw new Error("只能阅读 .md 页面");
  if (!fs.existsSync(file)) throw new Error(`找不到 ${rel}`);
  const body = fs.readFileSync(file, "utf8");
  if (body.length <= MAX_READ) return body;
  return `${body.slice(0, MAX_READ)}\n\n[截断]`;
}

export function createWikiTools(getRoot: () => string) {
  const wikiSearch = defineTool({
    name: "wiki_search",
    label: "Wiki 检索",
    description:
      "在用户本地 llm-wiki 里按关键词检索页面。返回相对路径、摘要和片段。可以多次调用、换关键词再搜。需要正文时用 wiki_read，一次可以读多篇。",
    promptSnippet: "wiki_search: 可多次检索本地 wiki",
    executionMode: "parallel",
    parameters: Type.Object({
      query: Type.String({ description: "检索词，可以是概念、专名或问题关键词" }),
      limit: Type.Optional(Type.Number({ description: "最多返回几条，默认 5" })),
    }),
    async execute(_id, params) {
      const root = getRoot();
      if (!root) {
        return {
          content: [{ type: "text" as const, text: "未配置 wiki 目录" }],
          details: {},
        };
      }
      try {
        const hits = searchWiki(root, params.query, params.limit ?? 5);
        if (hits.length === 0) {
          return {
            content: [{ type: "text" as const, text: "没有命中。可换关键词，或放弃 wiki。" }],
            details: {},
          };
        }
        const text = hits
          .map(
            (hit) =>
              `- ${hit.path} (score ${hit.score})\n  ${hit.snippet.replaceAll("\n", " ")}`,
          )
          .join("\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `检索失败：${message}` }],
          details: {},
        };
      }
    },
  });

  const wikiRead = defineTool({
    name: "wiki_read",
    label: "Wiki 阅读",
    description:
      "阅读 wiki 中的一篇 Markdown。path 用 wiki_search 返回的相对路径，例如 wiki/blockchain-oracle.md。可以一次并读多篇，也可以读完再 search。不能读 wiki 目录之外的文件。",
    promptSnippet: "wiki_read: 可多次阅读 wiki 页面",
    executionMode: "parallel",
    parameters: Type.Object({
      path: Type.String({ description: "相对于 wiki 根目录的 .md 路径" }),
    }),
    async execute(_id, params) {
      const root = getRoot();
      if (!root) {
        return {
          content: [{ type: "text" as const, text: "未配置 wiki 目录" }],
          details: {},
        };
      }
      try {
        const text = readWikiPage(root, params.path);
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `阅读失败：${message}` }],
          details: {},
        };
      }
    },
  });

  return [wikiSearch, wikiRead];
}
