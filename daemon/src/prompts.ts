import type { TaskAction, TaskMode } from "./types.ts";

export const SYSTEM_PROMPT = `你是琉璃（Liuli），macOS 全局翻译 / OCR / 公式识别引擎。
你的回复会直接显示在一块很小的悬浮玻璃面板里，必须遵守：

- 不要寒暄、不要解释步骤、不要道歉、不要加标题
- 不要重复用户已经提供的原文（面板会单独显示原文）
- 专有名词、代码、变量、路径、URL 保持原样
- 若目标语言和原文相同，做克制润色，不要强行改写
- 除 LaTeX 模式外，不要使用 markdown 代码块
`;

const LANG_NAMES: Record<string, string> = {
  zh: "简体中文",
  "zh-Hans": "简体中文",
  "zh-CN": "简体中文",
  "zh-Hant": "繁体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  auto: "与原文相对的语言（中文原文译成英文，其它语言译成简体中文）",
};

export function languageName(code: string | undefined): string {
  if (!code) return LANG_NAMES.auto;
  return LANG_NAMES[code] ?? code;
}

export function buildUserPrompt(input: {
  mode: TaskMode;
  text?: string;
  hasImage: boolean;
  targetLang?: string;
  sourceLang?: string;
}): string {
  const lang = languageName(input.targetLang);
  const sourceHint = input.sourceLang
    ? `源语言提示：${input.sourceLang}\n`
    : "";
  const textBlock = input.text?.trim() ? input.text.trim() : "";
  const imageHint = input.hasImage ? "（图已附上）\n" : "";

  switch (input.mode) {
    case "translate":
      return `${sourceHint}将下列文本译为${lang}。只输出译文。\n\n${textBlock || "（见附图）"}`;
    case "ocr":
      return `${imageHint}${textBlock ? `本地 OCR 草稿（可能有误，请以图像为准纠错）：\n${textBlock}\n\n` : ""}识别图中全部文字，保持原有换行与阅读顺序。只输出识别结果。`;
    case "ocr-translate":
      return `${imageHint}${sourceHint}${textBlock ? `本地 OCR 草稿（可能有误，请以图像为准）：\n${textBlock}\n\n` : ""}识别图中文字并译为${lang}。
严格按下面两行标记输出，不要其它内容：
<<<原文>>>
识别出的原文
<<<译文>>>
对应的译文`;
    case "latex":
      return `${imageHint}把图中的数学公式转为 LaTeX。忽略本地 OCR 草稿。
规则：
- 只输出公式本身，不要解释、不要 markdown 代码块
- 独立公式用 $$...$$
- 概率/采样条件里上下两行赋值，用 \\begin{array}{l}...\\\\ ...\\end{array}，不要用 aligned、gather、substack
- 花体用 \\mathcal，无衬线用 \\mathsf，直立函数名用 \\mathrm 或 \\Pr
- 高大括号用 \\left \\right
- 上标下标一律用大括号：1^{\\kappa}、g^{x}
- 不要 tikz、不要 \\scalebox、不要中文说明`;
  }
}

export function buildContinuePrompt(input: {
  action: TaskAction;
  text?: string;
  context?: string;
  reading?: string;
  wikiAvailable?: boolean;
  seedContext: boolean;
  targetLang?: string;
}): string {
  const lang = languageName(input.targetLang);
  const parts: string[] = [];
  if (input.seedContext && input.context?.trim()) {
    parts.push(`这是用户正在看的内容：\n${input.context.trim()}`);
  }
  if (input.reading?.trim()) {
    parts.push(`用户当前阅读环境：\n${input.reading.trim()}`);
  }
  if (input.wikiAvailable) {
    parts.push(
      `用户有一份本地 llm-wiki。需要背景时用工具，可以多轮、也可以一次并读多页：先 wiki_search(query) 找候选，再 wiki_read(path) 读最相关的几篇；不够就换关键词再 search，或继续 read。引用写相对路径。不要编造 wiki 里没有的内容。不需要背景就不要搜。`,
    );
  }
  const extra = parts.length > 0 ? `${parts.join("\n\n")}\n\n` : "";
  if (input.action === "explain") {
    return `${extra}用${lang}两三句话简要解释。点出关键意思、可能的歧义和必要背景。不要复述原文或译文，不要标题，不要列表，不要 markdown。`;
  }
  const question = input.text?.trim() || "请继续解释。";
  return `${extra}用户追问（小面板里简短作答，不要标题，不要 markdown）：\n${question}`;
}
