// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";

// Every render of a row's body asks this once for its To-do: a count of how often each body renders.
const bodyRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("../lib/personal/lists", async (importActual) => {
  const actual = await importActual<typeof import("../lib/personal/lists")>();
  return {
    ...actual,
    hasPendingReminder: (todo: Todo) => {
      bodyRenders.set(todo.id, (bodyRenders.get(todo.id) ?? 0) + 1);
      return actual.hasPendingReminder(todo);
    },
  };
});
const { updateTodoAction } = vi.hoisted(() => ({ updateTodoAction: vi.fn() }));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction: vi.fn(), updateTodoAction, deleteTodoAction: vi.fn(), moveTodoAction: vi.fn(), restoreTodoAction: vi.fn() }));
vi.mock("next/navigation", () => import("./history-navigation"));

const TODAY = "2026-10-17";
let n = 0;
function todo(over: Partial<Todo> = {}): Todo {
  n++;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    title: `To-do ${n}`,
    references: [],
    day: TODAY,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: { done: 0, total: 0 },
    position: n,
    details: null,
    source: "dashboard",
    url: "",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

/** Holds the strike's 300 ms timer until `release()`, so the test can look at the page while the line draws. */
function holdStrike() {
  const held: (() => void)[] = [];
  const real = globalThis.setTimeout;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== 300) return real(fn, ms, ...args);
    held.push(fn);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  return {
    release: () =>
      act(async () => {
        for (const fn of held.splice(0)) fn();
      }),
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T13:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  updateTodoAction.mockReset();
  bodyRenders.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a strike", () => {
  it("renders only the struck row's body when it starts and when it ends", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => todo({ title: `Row ${i + 1}` }));
    const [struck, ...others] = rows as [Todo, ...Todo[]];
    // The API refuses the write: the preview ends together with the rollback, the case where nothing else changes.
    updateTodoAction.mockResolvedValue({ ok: false, error: "Could not reach the API.", fieldErrors: {} });
    window.history.replaceState(null, "", "/personal");
    const strike = holdStrike();
    try {
      render(<PersonalSpace initial={{ today: TODAY, timeZone: "Europe/Rome", todos: rows }} projects={[]} />, { wrapper: TooltipProvider });
      const user = userEvent.setup();
      const rendered = () => others.map((t) => bodyRenders.get(t.id));
      expect(rendered().every((count) => count !== undefined)).toBe(true);
      const before = rendered();
      const struckBefore = bodyRenders.get(struck.id) ?? 0;

      await user.click(screen.getByRole("button", { name: "Mark “Row 1” done" }));
      // Started: the line draws on Row 1 alone.
      expect(screen.getByText("Row 1").parentElement).toHaveAttribute("data-struck", "true");
      expect(bodyRenders.get(struck.id)).toBeGreaterThan(struckBefore);
      expect(rendered()).toEqual(before);

      await strike.release();
      // Ended: refused, so Row 1 is back with the error under it, and still nobody else has rendered.
      await waitFor(() => expect(within(screen.getByText("Row 1").closest("li") as HTMLElement).getByRole("alert")).toHaveTextContent("Could not reach the API."));
      expect(screen.getByText("Row 1").parentElement).not.toHaveAttribute("data-struck", "true");
      expect(rendered()).toEqual(before);
    } finally {
      strike.restore();
    }
  });
});
