const clamp = (value, min, max) => Math.max(Math.min(min, max), Math.min(Math.round(value), max));
function heightLimit(preferredHeight, area) {
  // A dragged height is the preferred reading size, with a little room for
  // incoming text before scrolling. Never grow beyond the monitor's work area.
  const preferred = preferredHeight || 640;
  return Math.min(preferredHeight ? Math.max(preferred, Math.min(preferred + 180, 760)) : preferred, area.height - 24);
}
function constrain(bounds, area) {
  const width = clamp(bounds.width, 360, Math.min(1000, area.width - 24));
  const height = clamp(bounds.height, 140, area.height - 24);
  return { x: clamp(bounds.x, area.x + 12, area.x + area.width - width - 12),
    y: clamp(bounds.y, area.y + 12, area.y + area.height - height - 12), width, height };
}
function fromEdge(start, edge, delta, area) {
  const next = { ...start };
  const right = start.x + start.width, bottom = start.y + start.height;
  // Limit only the edge being dragged. Repositioning the whole rectangle here
  // makes the opposite edge jump when the cursor reaches a screen boundary.
  if (edge.includes("e") || edge.includes("w")) {
    const west = edge.includes("w");
    const maximum = Math.min(1000, west ? right - area.x - 12 : area.x + area.width - 12 - start.x);
    next.width = clamp(start.width + (west ? -delta.x : delta.x), 360, maximum);
    if (west) next.x = right - next.width;
  }
  if (edge.includes("n") || edge.includes("s")) {
    const north = edge.includes("n");
    const maximum = north ? bottom - area.y - 12 : area.y + area.height - 12 - start.y;
    next.height = clamp(start.height + (north ? -delta.y : delta.y), 140, maximum);
    if (north) next.y = bottom - next.height;
  }
  return next;
}
module.exports = { constrain, fromEdge, heightLimit };
