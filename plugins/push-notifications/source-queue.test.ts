import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSourceQueue } from "./source-queue.js";

const notice = {
  title: "#Research · Atlas",
  body: "Ready",
  kind: "turn-finished",
  threadId: "hidden",
  projectId: "project",
  path: "/plugins/bots/channels/room",
};

describe("durable source notification queue", () => {
  it("recovers queued events after reload and deduplicates delivered events", async () => {
    const host = createFakePluginHost({ pluginId: "push-notifications" });
    host.harness.inspection.sdk.stub(
      "plugins.callRpc",
      async <T>(args: { outputSchema: z.ZodType<T> }) =>
        args.outputSchema.parse(notice),
    );
    const deliver = vi.fn(async () => undefined);
    let timestamp = 1000;
    const options = { coalesceMs: 10, now: () => timestamp };
    let queue = createSourceQueue(host.bb, deliver, options);
    try {
      queue.start();
      queue.enqueue("bots", "reply:1");
      await queue.stop();
      timestamp += 20;
      queue = createSourceQueue(host.bb, deliver, options);
      queue.start();
      await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
      expect(deliver).toHaveBeenCalledWith(
        notice,
        "plugin:bots:reply:1",
        expect.any(AbortSignal),
      );
      await queue.stop();
      queue = createSourceQueue(host.bb, deliver, options);
      queue.start();
      queue.enqueue("bots", "reply:1");
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(deliver).toHaveBeenCalledTimes(1);
    } finally {
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });

  it("retries unavailable sources after restart and drops expired events", async () => {
    const host = createFakePluginHost({ pluginId: "push-notifications" });
    const deliver = vi.fn(async () => undefined);
    let timestamp = 1000;
    const options = { coalesceMs: 10, now: () => timestamp };
    let queue = createSourceQueue(host.bb, deliver, options);
    try {
      queue.enqueue("bots", "reply:1");
      timestamp += 20;
      queue.start();
      await vi.waitFor(() =>
        expect(
          host.harness.inspection.sdk.callsTo("plugins.callRpc"),
        ).toHaveLength(1),
      );
      await queue.stop();
      host.harness.inspection.sdk.stub(
        "plugins.callRpc",
        async <T>(args: { outputSchema: z.ZodType<T> }) =>
          args.outputSchema.parse(notice),
      );
      timestamp += 30001;
      queue = createSourceQueue(host.bb, deliver, options);
      queue.start();
      await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
      await queue.stop();
      queue.enqueue("bots", "old");
      timestamp += 86400001;
      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(deliver).toHaveBeenCalledTimes(1);
    } finally {
      await queue.stop();
      await host.harness.lifecycle.dispose();
    }
  });
});

it("coalesces one channel with pending input ahead of errors and replies", async () => {
  const host = createFakePluginHost({ pluginId: "push-notifications" });
  host.harness.inspection.sdk.stub(
    "plugins.callRpc",
    async <T>(args: { input?: unknown; outputSchema: z.ZodType<T> }) => {
      const { eventId } = z
        .object({
          eventId: z.enum([
            "turn-finished",
            "thread-error",
            "pending-interaction",
          ]),
        })
        .parse(args.input);
      return args.outputSchema.parse({
        ...notice,
        kind: eventId,
        coalesceKey: "room",
      });
    },
  );
  const deliver = vi.fn(async () => undefined);
  let timestamp = 1000;
  const queue = createSourceQueue(host.bb, deliver, {
    coalesceMs: 10,
    now: () => timestamp,
  });
  try {
    for (const id of ["turn-finished", "thread-error", "pending-interaction"])
      queue.enqueue("bots", id);
    timestamp += 20;
    queue.start();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(deliver.mock.calls[0]).toEqual([
      expect.objectContaining({ kind: "pending-interaction" }),
      "plugin:bots:pending-interaction",
      expect.any(AbortSignal),
    ]);
    expect(
      host.bb.storage
        .database()
        .prepare(
          "SELECT count(*) AS n FROM notification_sources WHERE delivered_at IS NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    await queue.stop();
    await host.harness.lifecycle.dispose();
  }
});

it("aborts a stuck source lookup when stopping", async () => {
  const host = createFakePluginHost({ pluginId: "push-notifications" });
  host.harness.inspection.sdk.stub(
    "plugins.callRpc",
    async (args: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        args.signal?.addEventListener(
          "abort",
          () => reject(args.signal?.reason),
          { once: true },
        );
      }),
  );
  const queue = createSourceQueue(host.bb, async () => undefined, {
    coalesceMs: 10,
    now: Date.now,
  });
  try {
    queue.enqueue("bots", "pending");
    queue.start();
    await vi.waitFor(() =>
      expect(
        host.harness.inspection.sdk.callsTo("plugins.callRpc"),
      ).toHaveLength(1),
    );
    await queue.stop();
    expect(
      host.bb.storage
        .database()
        .prepare("SELECT delivered_at FROM notification_sources")
        .get(),
    ).toEqual({ delivered_at: null });
  } finally {
    await queue.stop();
    await host.harness.lifecycle.dispose();
  }
});
