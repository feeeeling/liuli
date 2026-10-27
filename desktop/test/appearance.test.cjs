const test = require("node:test");
const assert = require("node:assert/strict");
const { roundedRegion } = require("../window-appearance.cjs");
test("native glass is clipped to rounded corners with no rectangular backdrop halo", () => {
  for (const [width, height] of [[420, 240], [700, 640], [12, 10]]) {
    const region = roundedRegion(width, height);
    assert.ok(region.length);
    assert.ok(region.every(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height));
    assert.equal(region[0].x, region[1].x);
    assert.equal(region[0].y + region[1].y, height - 1);
    assert.ok(region[0].x > 0);
    assert.ok(region.some(r => r.x === 0 && r.width === width));
  }
});
