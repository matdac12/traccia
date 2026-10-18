import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../src/api-client";
import { FOLD_MS, STRIKE_MS, useLeaving } from "../src/leaving";
import { todo } from "./todos";

type Props = { todos: Todo[] | null; shown: boolean };

function mount(props: Props) {
  return renderHook((p: Props) => useLeaving(p.todos, p.shown), {
    initialProps: props,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLeaving", () => {
  const gym = todo({ id: "gym" });
  const done = { ...gym, state: "done" as const };

  it("strikes a row that closes, folds it after a beat, then lets it go", () => {
    const { result, rerender } = mount({ todos: [gym], shown: true });
    expect(result.current.size).toBe(0);

    rerender({ todos: [done], shown: true });
    expect(result.current.get("gym")).toBe("strike");
    act(() => vi.advanceTimersByTime(STRIKE_MS));
    expect(result.current.get("gym")).toBe("fold");
    act(() => vi.advanceTimersByTime(FOLD_MS));
    expect(result.current.has("gym")).toBe(false);
  });

  it("never moves a To-do first seen closed, like today's done ones from a fetch", () => {
    const { result, rerender } = mount({ todos: null, shown: true });
    rerender({ todos: [done], shown: true });
    expect(result.current.size).toBe(0);
  });

  it("stops when the row is reopened before it has gone", () => {
    const { result, rerender } = mount({ todos: [gym], shown: true });
    rerender({ todos: [done], shown: true });
    rerender({ todos: [gym], shown: true });
    expect(result.current.has("gym")).toBe(false);
    act(() => vi.advanceTimersByTime(STRIKE_MS + FOLD_MS));
    expect(result.current.has("gym")).toBe(false);
  });

  it("forgets every leaving row when the window hides", () => {
    const { result, rerender } = mount({ todos: [gym], shown: true });
    rerender({ todos: [done], shown: true });
    rerender({ todos: [done], shown: false });
    expect(result.current.size).toBe(0);
  });
});
