// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TodayList } from "../components/personal/today-list";
import { type TodoActions, TodoActionsProvider } from "../components/personal/todo-actions";
import { TodoRow } from "../components/personal/todo-row";
import { TooltipProvider } from "../components/ui/tooltip";

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
    subTodos: null,
    position: n,
    details: null,
    source: "dashboard",
    url: "",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}
const reminder = (status: "pending" | "sent" | "failed" | "skipped", time = "15:00") => ({ time, status, failure: null, sentAt: null });
const actions: TodoActions = { today: TODAY, timeZone: "Europe/Rome", update: async () => {}, move: async () => {}, deleteTodo: () => {}, dismissError: () => {} };
// Rows write through the page's actions; linked chips use the app's TooltipProvider (root layout).
function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <TodoActionsProvider value={actions}>{children}</TodoActionsProvider>
    </TooltipProvider>
  );
}
// A row's text, without the `––:––` placeholder of a To-do that has no Reminder.
const text = (el: Element) => el.textContent?.replace(" ––:––", "");
const titles = (el: HTMLElement) => within(el).queryAllByRole("listitem").map(text);

describe("TodayList", () => {
  it("shows the weekday masthead with the date, the open count and the Reminders still to come", () => {
    render(<TodayList today={TODAY} timeZone="Europe/Rome" todos={[todo({ reminder: reminder("pending") }), todo(), todo({ reminder: reminder("sent") })]} />, { wrapper: Providers });
    expect(screen.getByRole("heading", { level: 2, name: "Saturday" })).toBeInTheDocument();
    expect(screen.getByText("17 October · 3 open · 1 Reminder still to come")).toBeInTheDocument();
  });

  it("lists Overdue with each row's day, then Today in Position order, then today's closed To-dos", () => {
    const todos = [
      todo({ title: "Second", position: 20 }),
      todo({ title: "Late", day: "2026-10-15" }),
      todo({ title: "First", position: 10 }),
      todo({ title: "Paid the bill", state: "done", closedAt: "2026-10-17T07:00:00Z" }),
    ];
    render(<TodayList today={TODAY} timeZone="Europe/Rome" todos={todos} />, { wrapper: Providers });
    const overdue = screen.getByRole("region", { name: /Overdue/ });
    expect(titles(overdue)).toEqual(["LateThu 15 Oct"]);
    const today = screen.getByRole("region", { name: /Today/ });
    expect(titles(today)).toEqual(["First", "Second", "Paid the bill"]);
    expect(within(screen.getByRole("list", { name: "Closed today" })).getByRole("button", { name: "Reopen “Paid the bill”" })).toBeInTheDocument();
  });

  it("says nothing is planned when the day is empty", () => {
    render(<TodayList today={TODAY} timeZone="Europe/Rome" todos={[todo({ day: null }), todo({ day: "2026-10-18" })]} />, { wrapper: Providers });
    expect(screen.getByText("Nothing planned for today")).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("TodoRow", () => {
  const renderRow = (t: Todo, showDay = false) =>
    render(<ul><TodoRow todo={t} showDay={showDay} /></ul>, { wrapper: Providers }).container;

  it("shows the Reminder time by status: pending in the accent, sent dimmed, failed red with a crossed bell", () => {
    renderRow(todo({ reminder: reminder("pending", "15:00") }));
    renderRow(todo({ reminder: reminder("sent", "09:00") }));
    renderRow(todo({ reminder: reminder("failed", "17:00") }));
    expect(screen.getByText("Reminder at 15:00").parentElement).toHaveClass("text-primary");
    expect(screen.getByText("Reminder sent at 09:00").parentElement).toHaveClass("text-muted-foreground/70");
    const failed = screen.getByText("Reminder failed to send at 17:00").parentElement as HTMLElement;
    expect(failed).toHaveClass("text-destructive");
    expect(failed.querySelector(".lucide-bell-off")).not.toBeNull();
  });

  it("dims a pending Reminder once the To-do is closed", () => {
    renderRow(todo({ state: "done", closedAt: "2026-10-17T07:00:00Z", reminder: reminder("pending") }));
    expect(screen.getByText("Reminder at 15:00").parentElement).not.toHaveClass("text-primary");
  });

  it("renders Project chips, the Details dot, the Sub-to-do count and via Parla", () => {
    renderRow({
      ...todo({ title: "Ship @crm with @OLD", references: [{ key: "CRM", projectId: "p1", projectDeleted: false }, { key: "OLD", projectId: "p2", projectDeleted: true }], details: "notes", source: "parla" }),
      subTodos: { done: 1, total: 3 },
    });
    expect(screen.getByText("CRM")).not.toHaveClass("border-dashed");
    expect(screen.getByText("OLD")).toHaveClass("border-dashed");
    expect(screen.getByRole("img", { name: "Has details" })).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("via Parla")).toBeInTheDocument();
  });

  it("hides the count when a parent has no live Sub-to-dos, and the day unless asked", () => {
    const el = renderRow({ ...todo({ day: "2026-10-15" }), subTodos: { done: 0, total: 0 } });
    expect(text(el)).toBe(`To-do ${n}`);
  });

  it("strikes done and dropped titles, and shows an Overdue day in red", () => {
    renderRow(todo({ title: "Paid", state: "done", closedAt: "2026-10-17T07:00:00Z" }));
    renderRow(todo({ title: "Skipped it", state: "dropped", closedAt: "2026-10-17T07:00:00Z" }));
    expect(screen.getByText("Paid").parentElement).toHaveAttribute("data-struck", "true");
    expect(screen.getByText("Skipped it").parentElement).toHaveAttribute("data-struck", "true");
    renderRow(todo({ title: "Late", day: "2026-10-16" }), true);
    expect(screen.getByText("Yesterday")).toHaveClass("text-destructive");
    expect(screen.getByText("Late").parentElement).not.toHaveAttribute("data-struck");
  });
});

describe("PersonalSpace", () => {
  beforeEach(() => window.history.replaceState(null, "", "/personal"));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a To-do created elsewhere after one polling cycle, and rolls over to the new day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fresh = [todo({ title: "Created by curl", day: "2026-10-18" })];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ today: "2026-10-18", timeZone: "Europe/Rome", todos: fresh })));
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonalSpace initial={{ today: TODAY, timeZone: "Europe/Rome", todos: [todo({ title: "Already here" })] }} projects={[]} />);
    expect(screen.getByText("Already here")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/todos", expect.anything());
    expect(screen.getByText("Created by curl")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sunday" })).toBeInTheDocument();
  });

  it("counts Today and Anytime in the list menu and opens the other lists", async () => {
    render(<PersonalSpace initial={{ today: TODAY, timeZone: "Europe/Rome", todos: [todo(), todo({ day: "2026-10-10" }), todo({ day: null, references: [{ key: "CRM", projectId: "p1", projectDeleted: false }] })] }} projects={[]} />);
    const menu = screen.getByRole("navigation", { name: "Personal lists" });
    expect(within(menu).getByRole("button", { name: /Today/ })).toHaveTextContent("Today2");
    expect(within(menu).getByRole("button", { name: /Anytime/ })).toHaveTextContent("Anytime1");
    await userEvent.click(within(menu).getByRole("button", { name: "CRM, 1 open" }));
    expect(within(menu).getByRole("button", { name: "CRM, 1 open" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { level: 2, name: "Saturday" })).toBeNull();
  });
});
