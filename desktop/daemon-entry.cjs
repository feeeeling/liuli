const path = require("node:path");
const { pathToFileURL } = require("node:url");

process.parentPort.on("message", ({ data }) => {
  if (data === "shutdown") process.emit("SIGTERM");
});

// Packaged apps keep the daemon outside app.asar, including its native modules.
const daemonDir = process.env.LIULI_DESKTOP_DAEMON;
import(pathToFileURL(path.join(daemonDir, "dist", "index.mjs")).href).catch(
  (error) => {
    console.error(`[liuli] ${error.message}`);
    process.exit(1);
  },
);
