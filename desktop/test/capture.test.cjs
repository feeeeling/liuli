const test = require("node:test");
const assert = require("node:assert/strict");
const { cropBounds } = require("../capture-bounds.cjs");
test("screenshot crop uses actual pixels on a mixed-DPI monitor with negative origin", () => {
  const display = { x: -1920, y: -200, width: 1920, height: 1080 };
  assert.deepEqual(cropBounds({ x: 100, y: 20, width: 400, height: 200 }, display, { width: 2880, height: 1620 }),
    { x: 150, y: 30, width: 600, height: 300 });
  assert.deepEqual(cropBounds({ x: 500, y: 220, width: -400, height: -200 }, display, { width: 2880, height: 1620 }),
    { x: 150, y: 30, width: 600, height: 300 });
  assert.throws(() => cropBounds({ x: NaN, y: 0, width: 20, height: 20 }, display, { width: 1, height: 1 }));
  assert.throws(() => cropBounds({ x: 0, y: 0, width: 3, height: 20 }, display, { width: 1, height: 1 }));
});
test("screenshot crops clamp to screen edges without off-by-one pixels", () => {
  assert.deepEqual(cropBounds({ x: -10, y: -10, width: 1100, height: 1100 }, { width: 1000, height: 1000 }, { width: 1499, height: 1499 }),
    { x: 0, y: 0, width: 1499, height: 1499 });
});
