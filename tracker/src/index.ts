import { loadConfig } from "./config.ts";
import { TrackerDatabase } from "./database.ts";
import { startServer } from "./server.ts";
import { IrvinTracker } from "./tracker.ts";

const config = loadConfig();
const database = new TrackerDatabase(config.databasePath);
const tracker = new IrvinTracker(config, database);

const once = Bun.argv.includes("--once");

if (once) {
  try {
    await tracker.triggerSync("command", Bun.argv.includes("--drain"));
    console.log(JSON.stringify(database.getSummary(), null, 2));
  } finally {
    database.close();
  }
} else {
  const server = startServer(config, database, tracker);
  console.log(
    `[tracker] tracking ${config.username} at http://${config.host}:${server.port}`,
  );
  console.log(`[tracker] database: ${config.databasePath}`);
  tracker.start();

  const shutdown = () => {
    tracker.stop();
    server.stop(true);
    database.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
