// Starts all BullMQ workers in a single process
// Used by the Docker worker container

console.log("[Workers] Starting all workers...");

import("./crawl-worker").then(() => console.log("[Workers] Crawl worker started"));
import("./post-crawl-worker").then(() => console.log("[Workers] Post-crawl worker started"));
import("./agent-worker").then(() => console.log("[Workers] Agent worker started"));
import("./notification-worker").then(() => console.log("[Workers] Notification worker started"));
import("./qualification-worker").then(() => console.log("[Workers] Qualification worker started"));
import("./webhook-worker").then(() => console.log("[Workers] Webhook worker started"));
import("./scheduler-worker").then(() => console.log("[Workers] Scheduler worker started"));

// Keep process alive
process.on("SIGTERM", () => {
  console.log("[Workers] Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[Workers] Received SIGINT, shutting down...");
  process.exit(0);
});
