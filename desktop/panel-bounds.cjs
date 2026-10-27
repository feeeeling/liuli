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
  const width = start.width + (edge.includes("e") ? delta.x : edge.includes("w") ? -delta.x : 0);
  const height = start.height + (edge.includes("s") ? delta.y : edge.includes("n") ? -delta.y : 0);
  const size = constrain({ ...start, width, height }, area);
  return constrain({ ...size,
    x: edge.includes("w") ? start.x + start.width - size.width : start.x,
    y: edge.includes("n") ? start.y + start.height - size.height : start.y,
  }, area);
}
module.exports = { constrain, fromEdge, heightLimit };
