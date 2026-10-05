// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextDelay, POLL_INTERVAL_MS, POLL_MAX_BACKOFF_MS, usePoll } from "../lib/polling/use-poll";

let hidden = false;
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

describe("nextDelay", () => {
  it("doubles per failure and caps", () => {
    expect([0, 1, 2, 3].map((n) => nextDelay(n, 10_000, 120_000))).toEqual([10_000, 20_000, 40_000, 80_000]);
    expect(nextDelay(10, 10_000, 120_000)).toBe(120_000);
  });
});

describe("usePoll", () => {
  it("fires on the interval and records when it last succeeded", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoll(tick));
    expect(tick).not.toHaveBeenCalled();
    await advance(POLL_INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    await advance(1);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(result.current.lastUpdated).not.toBeNull();
    await advance(POLL_INTERVAL_MS * 2);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("makes no requests while the tab is hidden, and polls again as soon as it is visible", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePoll(tick));
    act(() => setHidden(true));
    await advance(POLL_INTERVAL_MS * 5);
    expect(tick).not.toHaveBeenCalled();
    act(() => setHidden(false));
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("revalidates on window focus, but not twice within the minimum gap", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePoll(tick));
    await advance(5_000);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(2_000);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("backs off while ticks fail, and resets after one succeeds", async () => {
    const tick = vi.fn().mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => usePoll(tick, { intervalMs: 1_000, maxBackoffMs: 4_000 }));
    await advance(1_000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(result.current.failures).toBe(1);
    await advance(1_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await advance(4_000);
    expect(tick).toHaveBeenCalledTimes(3);
    await advance(4_000); // capped at 4 s, not 8 s
    expect(tick).toHaveBeenCalledTimes(4);
    tick.mockResolvedValue(undefined);
    await advance(4_000);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(result.current.failures).toBe(0);
    await advance(1_000);
    expect(tick).toHaveBeenCalledTimes(6);
  });

  it("reconnecting forgets the backoff and polls now", async () => {
    const tick = vi.fn().mockRejectedValue(new Error("offline"));
    renderHook(() => usePoll(tick, { intervalMs: 1_000, maxBackoffMs: 60_000 }));
    await advance(1_000 + 2_000 + 4_000);
    expect(tick).toHaveBeenCalledTimes(3);
    await advance(3_000);
    act(() => { window.dispatchEvent(new Event("online")); });
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(4);
    await advance(2_000); // failure count restarted: the next wait is 2 s again, not 16 s
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it("never overlaps polls", async () => {
    let release!: () => void;
    const tick = vi.fn(() => new Promise<void>((r) => { release = r; }));
    renderHook(() => usePoll(tick));
    await advance(POLL_INTERVAL_MS);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await advance(POLL_MAX_BACKOFF_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("does nothing when disabled and stops on unmount", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const off = renderHook(() => usePoll(tick, { enabled: false }));
    await advance(POLL_INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
    off.unmount();
    const on = renderHook(() => usePoll(tick));
    on.unmount();
    await advance(POLL_INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
  });
});
