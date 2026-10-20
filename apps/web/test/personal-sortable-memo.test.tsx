// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";

// Every render of a row's body asks this once: a count of how often the bodies render.
const bodyRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/personal/lists", async (importActual) => {
  const actual = await importActual<typeof import("../lib/personal/lists")>();
  return {
    ...actual,
    isFromParla: (source: string) => {
      bodyRenders.count++;
      return actual.isFromParla(source);
    },
  };
});
const { moveTodoAction } = vi.hoisted(() => ({ moveTodoAction: vi.fn() }));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction: vi.fn(), updateTodoAction: vi.fn(), deleteTodoAction: vi.fn(), moveTodoAction }));
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T13:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  moveTodoAction.mockReset().mockReturnValue(new Promise(() => {}));
  // jsdom lays nothing out: each row stands 40 px below the one before it.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const li = this.closest("li[data-todo-id]");
    const top = li ? [...document.querySelectorAll("li[data-todo-id]")].indexOf(li) * 40 : 0;
    return { x: 0, y: top, top, left: 0, width: 600, height: li ? 36 : 0, right: 600, bottom: top + (li ? 36 : 0), toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dragging a row", () => {
  it("doesn't render the bodies of the other rows again while it moves", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => todo({ title: `Row ${i + 1}` }));
    window.history.replaceState(null, "", "/personal");
    const user = userEvent.setup();
    render(<PersonalSpace initial={{ today: TODAY, timeZone: "Europe/Rome", todos: rows }} projects={[]} />, { wrapper: TooltipProvider });
    expect(bodyRenders.count).toBeGreaterThanOrEqual(rows.length);

    screen.getByRole("button", { name: "Reorder “Row 1”" }).focus();
    await user.keyboard(" ");
    // Picking up renders each body once (the handles take their drag attributes)...
    const pickedUp = bodyRenders.count;
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    // ...but moving over the other rows renders none: the first row has moved, and no body has rendered for it.
    await waitFor(() => expect(screen.getByText("Row 1").closest("li")?.getAttribute("style")).toContain("translate"));
    expect(bodyRenders.count).toBe(pickedUp);
  });
});
