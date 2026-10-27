function panelMenuTemplate({ editable, selectedText, action, capture, settings, clipboard }) {
  const items = editable ? [
    { role: "undo" }, { role: "redo" }, { type: "separator" },
    { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    { type: "separator" },
  ] : selectedText ? [{ role: "copy" }, { type: "separator" }] : [];
  items.push(
    { label: "处理方式", submenu: [["translate", "翻译"], ["ocr-translate", "图译"], ["ocr", "OCR"], ["latex", "LaTeX"]]
      .map(([value, label]) => ({ label, click: () => action("mode", value) })) },
    ...[["screenshot", "截图翻译"], ["ocr", "截图 OCR"], ["latex", "公式转 LaTeX"], ["silent", "静默 OCR"]]
      .map(([value, label]) => ({ label, click: () => capture(value) })),
    { type: "separator" },
    { label: "选择图片…", click: () => action("choose-image") },
    { label: "粘贴图片", click: () => action("paste-image") },
    { label: "展开解释与追问", click: () => action("followup") },
    { label: "清空输入", click: () => action("clear") },
    { type: "separator" },
    { label: "剪贴板历史", click: clipboard },
    { label: "设置…", click: settings },
  );
  return items;
}
module.exports = { panelMenuTemplate };
