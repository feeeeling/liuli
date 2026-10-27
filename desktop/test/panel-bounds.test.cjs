const assert = require("node:assert/strict");
const test = require("node:test");
const { constrain, fromEdge, heightLimit } = require("../panel-bounds.cjs");
const area = { x: -1920, y: 0, width: 1920, height: 1040 };
test("long content can extend a preferred height within a finite work-area limit", () => {
  assert.equal(heightLimit(undefined, area), 640);
  assert.equal(heightLimit(390, area), 570);
  assert.equal(heightLimit(700, area), 760);
  assert.equal(heightLimit(900, area), 900);
  assert.equal(heightLimit(390, { ...area, height: 464 }), 440);
});
test("manual resizing stays inside a monitor with a negative desktop origin", () => {
  assert.deepEqual(constrain({ x: -3000, y: 2000, width: 5000, height: 5000 }, area),
    { x: -1908, y: 12, width: 1000, height: 1016 });
  assert.deepEqual(constrain({ x: -1500, y: 300, width: 20, height: 20 }, area),
    { x: -1500, y: 300, width: 360, height: 140 });
});
test("dragging north/west edges keeps the opposite edge anchored even at minimum size", () => {
  const start = { x: -1400, y: 200, width: 500, height: 500 };
  const next = fromEdge(start, "nw", { x: 300, y: 300 }, area);
  assert.equal(next.x + next.width, start.x + start.width);
  assert.equal(next.y + next.height, start.y + start.height);
  assert.equal(next.width, 360);
  assert.equal(next.height, 200);
  assert.deepEqual(fromEdge(start, "se", { x: 100, y: 80 }, area),
    { ...start, width: 600, height: 580 });
  assert.equal(fromEdge({ ...start, height: 170 }, "e", { x: 80, y: 0 }, area).height, 170,
    "a horizontal drag must not force a compact card to a taller minimum");
});

test("every resize edge keeps untouched edges fixed at screen and size limits", () => {
  const start = { x: -1500, y: 200, width: 500, height: 300 };
  for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    for (const dx of [-10000, -50, 0, 50, 10000]) for (const dy of [-10000, -50, 0, 50, 10000]) {
      const next = fromEdge(start, edge, { x: dx, y: dy }, area);
      const right = b => b.x + b.width, bottom = b => b.y + b.height;
      if (!edge.includes("w")) assert.equal(next.x, start.x, `${edge}: left`);
      if (!edge.includes("e")) assert.equal(right(next), right(start), `${edge}: right`);
      if (!edge.includes("n")) assert.equal(next.y, start.y, `${edge}: top`);
      if (!edge.includes("s")) assert.equal(bottom(next), bottom(start), `${edge}: bottom`);
      assert.ok(next.x >= area.x + 12 && right(next) <= area.x + area.width - 12);
      assert.ok(next.y >= area.y + 12 && bottom(next) <= area.y + area.height - 12);
    }
  }
});
