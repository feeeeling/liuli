const { execFile } = require("node:child_process");

// A failed Electron startup must not leave CI waiting forever in teardown.
// Only terminate the process tree created by this test after graceful close stalls.
async function closeElectron(application) {
  const child = application.process();
  let timer, forced = false;
  const fallback = new Promise(resolve => {
    timer = setTimeout(() => {
      if (!child?.pid || child.exitCode !== null) return resolve();
      forced = true;
      if (process.platform === "win32") {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, timeout: 5000 }, () => resolve());
      } else { child.kill("SIGKILL"); resolve(); }
    }, 5000);
  });
  try { await Promise.race([application.close().catch(() => {}), fallback]); }
  finally { clearTimeout(timer); }
  return !forced;
}
module.exports = { closeElectron };
