import { db, advance } from "../lib/server";
// Run as a long-lived service, independent of browsers and the Next.js process.
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log("SCRAM authoritative worker running (1 second cadence)");
async function main() {
  while (!stopping) {
    const began = Date.now();
    try {
      const client = db();
      const { error: heartbeat } = await client
        .from("scram_worker")
        .upsert({ id: 1, at: new Date().toISOString() });
      if (heartbeat) throw heartbeat;
      const { data, error } = await client
        .from("scram_state")
        .select("id")
        .eq("state->>status", "active");
      if (error) throw error;
      for (let i = 0; i < (data?.length || 0); i += 8) {
        await Promise.all(
          data!.slice(i, i + 8).map(async (row) => {
            try {
              await advance(row.id);
            } catch (e) {
              console.error(
                "Match tick failed",
                e instanceof Error ? e.message : "Database error",
              );
            }
          }),
        );
      }
    } catch {
      console.error("Worker database unavailable; retrying");
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(100, 1000 - (Date.now() - began))),
    );
  }
}
main().catch(() => {
  process.exitCode = 1;
});
