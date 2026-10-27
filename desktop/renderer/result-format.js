(function (root) {
  function unwrapLatex(raw) {
    let value = raw.trim().replace(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/, "$1").trim();
    let previous;
    do {
      previous = value;
      for (const [start, end] of [["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"]])
        if (value.startsWith(start) && value.endsWith(end) && value.length >= start.length + end.length) {
          value = value.slice(start.length, -end.length).trim(); break;
        }
    } while (previous !== value);
    return value;
  }
  function splitTranslation(raw) {
    const marked = raw.match(/<<<原文>>>\s*([\s\S]*?)\s*<<<译文>>>\s*([\s\S]*)/);
    if (marked) return { source: marked[1].trim(), translation: marked[2].trim() };
    const lines = raw.trim().split(/\r?\n/);
    const index = lines.findIndex(line => line.trim() === "译文");
    if (index < 0) return null;
    if (lines[0].trim() === "原文") lines.shift();
    const divider = lines.findIndex(line => line.trim() === "译文");
    return { source: lines.slice(0, divider).join("\n").trim(), translation: lines.slice(divider + 1).join("\n").trim() };
  }
  const api = { unwrapLatex, splitTranslation };
  if (typeof module === "object") module.exports = api;
  else root.resultFormat = api;
})(globalThis);
