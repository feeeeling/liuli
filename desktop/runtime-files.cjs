const path = require("node:path");

const development = new Set([
  ".bin", "@types", "@esbuild", "esbuild", "tsx", "typescript", "undici-types",
]);

function includeRuntimeFile(relative, arch) {
  const parts = relative.split(path.sep);
  if (development.has(parts[0]) || relative.endsWith(".map")) return false;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i - 1] === "@esbuild" && parts[i] !== `win32-${arch}`) return false;
    if (parts[i - 1] === "@mariozechner" && parts[i].startsWith("clipboard-") &&
        !parts[i].startsWith(`clipboard-win32-${arch}-`)) return false;
  }
  return true;
}

module.exports = { includeRuntimeFile };
