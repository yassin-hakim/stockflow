import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxRelay } from "../src/infrastructure/outbox-relay";
import type { PublishPendingEvents } from "../src/application/publish-pending-events";

afterEach(() => vi.useRealTimers());

describe("outbox shutdown", () => {
  it("awaits the active publication and prevents further polls", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<{ published: []; failures: [] }>((resolve) => {
          complete = () => resolve({ published: [], failures: [] });
        }),
    );
    const relay = new OutboxRelay({
      execute,
    } as unknown as PublishPendingEvents);
    relay.onModuleInit();
    await vi.advanceTimersByTimeAsync(500);
    let stopped = false;
    const shutdown = relay.onModuleDestroy().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(stopped).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    complete();
    await shutdown;
    await vi.advanceTimersByTimeAsync(1500);
    expect(stopped).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });
});
