
const { spawn } = require("node:child_process");
const path = require("node:path");

const INTERVAL_MINUTES = Number(process.env.ARP_POLL_MINUTES || 5);
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

const crawlerPath = path.join(__dirname, "inspect-network.js");

let isRunning = false;
let stopping = false;
let activeChild = null;

if (!Number.isFinite(INTERVAL_MINUTES) || INTERVAL_MINUTES < 1) {
  console.error("ARP_POLL_MINUTES must be at least 1.");
  process.exit(1);
}

function runCrawler() {
  if (isRunning || stopping) return;

  isRunning = true;

  console.log("\n========================================");
  console.log("Sophos ARP polling cycle started");
  console.log("Time:", new Date().toLocaleString());
  console.log("========================================");

  activeChild = spawn(
    process.execPath,
    [crawlerPath],
    {
      cwd: __dirname,
      stdio: "inherit",
      env: process.env,
      windowsHide: true
    }
  );

  activeChild.on("error", (error) => {
    console.error("Could not start crawler:", error.message);
  });

  activeChild.on("close", (code, signal) => {
    isRunning = false;
    activeChild = null;

    console.log("\nPolling cycle finished:", new Date().toLocaleString());

    if (code === 0) {
      console.log("Crawler completed successfully.");
    } else {
      console.error(
        `Crawler failed (exit code: ${code}, signal: ${signal || "none"}).`
      );
      console.error("The next scheduled cycle will still be attempted.");
    }

    if (!stopping) {
      console.log(
        `Next cycle in ${INTERVAL_MINUTES} minute(s).`
      );
    }
  });
}

function shutdown() {
  if (stopping) return;

  stopping = true;
  console.log("\nStopping Sophos ARP polling...");

  if (activeChild) {
    activeChild.kill();
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start immediately; do not wait five minutes for the first snapshot.
runCrawler();

// Start a new cycle only after the previous cycle has finished,
// followed by the configured waiting interval.
const scheduleNext = () => {
  if (stopping) return;

  if (isRunning) {
    setTimeout(scheduleNext, 1000);
    return;
  }

  setTimeout(() => {
    if (!stopping) runCrawler();
    scheduleNext();
  }, INTERVAL_MS);
};

scheduleNext();
