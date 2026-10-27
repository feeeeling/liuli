// A native region clips the desktop backdrop too; CSS rounding alone cannot do that.
function roundedRegion(width, height, radius = 16) {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
  const rects = [];
  for (let y = 0; y < r; y++) {
    const inset = Math.max(0, Math.ceil(r - Math.sqrt(r * r - (r - y - .5) ** 2) - .5));
    rects.push({ x: inset, y, width: width - inset * 2, height: 1 });
    rects.push({ x: inset, y: height - y - 1, width: width - inset * 2, height: 1 });
  }
  if (height > r * 2) rects.push({ x: 0, y: r, width, height: height - r * 2 });
  return rects;
}
module.exports = { roundedRegion };
