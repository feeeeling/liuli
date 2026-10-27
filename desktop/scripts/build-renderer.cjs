const fs = require("node:fs");
const path = require("node:path");
function buildRenderer() {
  const dist = path.join(path.dirname(require.resolve("katex/package.json")), "dist");
  const target = path.resolve(__dirname, "../renderer/vendor/katex");
  fs.mkdirSync(target, { recursive: true });
  for (const file of ["katex.min.js", "katex.min.css", "fonts"])
    fs.cpSync(path.join(dist, file), path.join(target, file), { recursive: true });
  fs.copyFileSync(path.join(dist, "../LICENSE"), path.join(target, "LICENSE"));
}
if (require.main === module) buildRenderer();
module.exports = { buildRenderer };
