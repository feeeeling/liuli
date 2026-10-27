// Renderer selection coordinates are DIPs. Thumbnail dimensions are pixels and
// may differ from the requested size, particularly on mixed-DPI displays.
function cropBounds(rect, display, pixels) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
    throw new Error("无效截图选区。");
  const left = Math.max(0, Math.min(display.width, Math.min(rect.x, rect.x + rect.width)));
  const top = Math.max(0, Math.min(display.height, Math.min(rect.y, rect.y + rect.height)));
  const right = Math.max(left, Math.min(display.width, Math.max(rect.x, rect.x + rect.width)));
  const bottom = Math.max(top, Math.min(display.height, Math.max(rect.y, rect.y + rect.height)));
  if (right - left < 4 || bottom - top < 4) throw new Error("请框选更大的区域。");
  const x = Math.floor(left * pixels.width / display.width);
  const y = Math.floor(top * pixels.height / display.height);
  return { x, y, width: Math.min(pixels.width - x, Math.ceil(right * pixels.width / display.width) - x),
    height: Math.min(pixels.height - y, Math.ceil(bottom * pixels.height / display.height) - y) };
}
module.exports = { cropBounds };
