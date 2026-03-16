import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function appendNodeOption(existing, option) {
  const normalizedExisting = typeof existing === "string" ? existing.trim() : "";
  return normalizedExisting.length > 0 ? `${normalizedExisting} ${option}` : option;
}

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[fly-runner] ${name} exited with ${detail}`);
    shutdown(code ?? 1);
  });

  children.push({ name, child });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  const forceKillTimer = setTimeout(() => {
    for (const { child } of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }, 10000);

  forceKillTimer.unref();

  Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve(undefined);
            return;
          }

          child.once("exit", () => resolve(undefined));
        })
    )
  ).finally(() => {
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const workerMaxOldSpaceMbytes = parsePositiveInteger(
  process.env.WORKER_MAX_OLD_SPACE_MBYTES,
  3072
);
const workerEnv = {
  ...process.env,
  NODE_OPTIONS: appendNodeOption(
    process.env.NODE_OPTIONS,
    `--max-old-space-size=${workerMaxOldSpaceMbytes}`
  ),
};

start("web", "node", ["server.js"]);
start("worker", "npx", ["tsx", "src/workers/start-all.ts"], { env: workerEnv });
