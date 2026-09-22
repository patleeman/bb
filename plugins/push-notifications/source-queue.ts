import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  notificationKindPriority,
  sourceNotificationSchema,
  type SourceNotification,
} from "./contract.js";

type Row = { plugin_id: string; event_id: string; created_at: number };
const RETENTION_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 30_000;

export function createSourceQueue(
  bb: BbPluginApi,
  deliver: (
    notification: SourceNotification,
    id: string,
    signal: AbortSignal,
  ) => Promise<void>,
  options: { coalesceMs: number; now: () => number },
) {
  const db = bb.storage.database();
  db.exec(`CREATE TABLE IF NOT EXISTS notification_sources (
    plugin_id TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL, delivered_at INTEGER,
    PRIMARY KEY(plugin_id,event_id));
    CREATE INDEX IF NOT EXISTS pending_notification_sources ON notification_sources(delivered_at,due_at);`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = 0;
  let running = false;
  let controller = new AbortController();
  let flight: Promise<void> | null = null;

  function schedule(delay: number) {
    if (!running || flight) return;
    const at = options.now() + delay;
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => {
      timer = undefined;
      flight = flush()
        .catch((error) =>
          bb.log.error(`Plugin notification flush failed: ${String(error)}`),
        )
        .finally(() => {
          flight = null;
          const next = db
            .prepare(
              "SELECT MIN(due_at) AS due_at FROM notification_sources WHERE delivered_at IS NULL",
            )
            .get() as { due_at: number | null };
          if (next.due_at !== null)
            schedule(Math.max(1, next.due_at - options.now()));
        });
    }, delay);
    timer.unref?.();
  }

  function delivered(row: Row) {
    db.prepare(
      "UPDATE notification_sources SET delivered_at=? WHERE plugin_id=? AND event_id=?",
    ).run(options.now(), row.plugin_id, row.event_id);
  }
  function retry(row: Row) {
    db.prepare(
      "UPDATE notification_sources SET due_at=? WHERE plugin_id=? AND event_id=?",
    ).run(options.now() + RETRY_MS, row.plugin_id, row.event_id);
  }
  async function resolve(row: Row) {
    const notice = await bb.sdk.plugins.callRpc({
      pluginId: row.plugin_id,
      method: "notifications.resolve",
      input: { eventId: row.event_id },
      outputSchema: sourceNotificationSchema.nullable(),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    });
    if (notice?.path && !notice.path.startsWith(`/plugins/${row.plugin_id}/`))
      throw new Error("Notification path must belong to its source plugin");
    return notice;
  }
  async function flush() {
    db.prepare("DELETE FROM notification_sources WHERE created_at<?").run(
      options.now() - RETENTION_MS,
    );
    const rows = db
      .prepare(
        "SELECT plugin_id,event_id,created_at FROM notification_sources WHERE delivered_at IS NULL AND due_at<=? ORDER BY created_at LIMIT 50",
      )
      .all(options.now()) as Row[];
    const results = await Promise.allSettled(rows.map(resolve));
    if (!running) return;
    const groups = new Map<
      string,
      { row: Row; notice: SourceNotification }[]
    >();
    for (const [index, result] of results.entries()) {
      const row = rows[index]!;
      if (result.status === "rejected") {
        retry(row);
        continue;
      }
      if (!result.value) {
        delivered(row);
        continue;
      }
      const key = JSON.stringify([
        row.plugin_id,
        result.value.coalesceKey ?? row.event_id,
      ]);
      const group = groups.get(key) ?? [];
      group.push({ row, notice: result.value });
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (!running) return;
      group.sort(
        (a, b) =>
          notificationKindPriority.indexOf(a.notice.kind) -
            notificationKindPriority.indexOf(b.notice.kind) ||
          b.row.created_at - a.row.created_at,
      );
      try {
        for (const selected of group) {
          const current = await resolve(selected.row);
          if (!running) return;
          if (!current) continue;
          await deliver(
            current,
            `plugin:${selected.row.plugin_id}:${selected.row.event_id}`,
            AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          );
          break;
        }
        if (!running) return;
        db.transaction(() => {
          for (const { row } of group) delivered(row);
        })();
      } catch {
        for (const { row } of group) retry(row);
      }
    }
  }

  return {
    enqueue(pluginId: string, eventId: string) {
      const timestamp = options.now();
      db.prepare(
        "INSERT OR IGNORE INTO notification_sources(plugin_id,event_id,created_at,due_at) VALUES (?,?,?,?)",
      ).run(pluginId, eventId, timestamp, timestamp + options.coalesceMs);
      schedule(options.coalesceMs);
      return { ok: true as const };
    },
    start() {
      if (running) return;
      running = true;
      controller = new AbortController();
      schedule(options.coalesceMs);
    },
    async stop() {
      running = false;
      controller.abort();
      if (timer) clearTimeout(timer);
      timer = undefined;
      await flight;
    },
  };
}
