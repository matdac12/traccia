// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";
import type { PersonalSpaceData, SelectedTodo } from "../lib/personal/lists";
import type { ProjectOption } from "../lib/personal/project-autocomplete";

const { createTodoAction, updateTodoAction, deleteTodoAction } = vi.hoisted(() => ({ createTodoAction: vi.fn(), updateTodoAction: vi.fn(), deleteTodoAction: vi.fn() }));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction, updateTodoAction, deleteTodoAction }));

// Next's `useSearchParams` follows `history.pushState` and back/forward; this stand-in does the same over jsdom's history.
vi.mock("next/navigation", async () => {
  const { useMemo, useSyncExternalStore } = await import("react");
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    push(...args);
    notify();
  };
  window.addEventListener("popstate", notify);
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    useSearchParams: () => {
      const search = useSyncExternalStore(subscribe, () => window.location.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});

// Saturday 17 October 2026, 15:00 in Rome.
const TODAY = "2026-10-17";
const UPDATED = "2026-10-01T08:00:00.000Z";
const NOW = new Date("2026-10-17T13:00:00Z");

let n = 0;
function todo(over: Partial<Todo> = {}): Todo {
  n++;
  return {
    id: `t${n}`,
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
    updatedAt: UPDATED,
    ...over,
  };
}
const projects: ProjectOption[] = [{ id: "p-crm", key: "CRM", name: "CRM rebuild", status: "active" }];
const page = (todos: Todo[], selected?: SelectedTodo): PersonalSpaceData => ({ today: TODAY, timeZone: "Europe/Rome", todos, ...(selected ? { selected } : {}) });

function setup(data: PersonalSpaceData, url = "/personal") {
  window.history.replaceState(null, "", url);
  const view = render(<PersonalSpace initial={data} projects={projects} />, { wrapper: TooltipProvider });
  // What the server action's revalidation (or the poll) does: the page renders again with the API's data.
  const serverSends = (next: PersonalSpaceData) => view.rerender(<PersonalSpace initial={next} projects={projects} />);
  return { user: userEvent.setup(), serverSends };
}
const panel = () => screen.getByRole("complementary", { name: "To-do details" });
const row = (title: string) => within(screen.getByRole("region", { name: /^Today/ })).getByText(title).closest("li") as HTMLElement;
const ok = (t: Todo) => ({ ok: true, data: { todo: t } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The poll stays quiet unless a test answers it.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  for (const action of [createTodoAction, updateTodoAction, deleteTodoAction]) action.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selecting a To-do", () => {
  it("opens the panel from a row click and puts it in the URL; Close and back/forward follow the URL", async () => {
    const t = todo({ title: "Call the bank", details: "Ask about the rate" });
    const { user } = setup(page([t]));
    expect(screen.queryByRole("complementary", { name: "To-do details" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open “Call the bank”" }));
    expect(window.location.search).toBe(`?todo=${t.id}`);
    expect(within(panel()).getByRole("heading", { name: "Call the bank" })).toBeInTheDocument();
    expect(within(panel()).getByLabelText("Details")).toHaveValue("Ask about the rate");
    expect(row("Call the bank")).toHaveAttribute("data-selected", "true");

    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("complementary", { name: "To-do details" })).toBeNull();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(`?todo=${t.id}`));
    expect(await screen.findByRole("complementary", { name: "To-do details" })).toBeInTheDocument();
  });

  it("leaves the row's own controls alone: the check, the Reminder time, the day, the menu and the chips don't select", async () => {
    const t = todo({ title: "Ship @CRM", references: [{ key: "CRM", projectId: "p-crm", projectDeleted: false }] });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user } = setup(page([t]));
    const r = row("Ship");
    await user.click(within(r).getByRole("button", { name: "Add a Reminder" }));
    await user.keyboard("{Escape}");
    await user.click(within(r).getByRole("button", { name: "Change Planned day" }));
    await user.keyboard("{Escape}");
    await user.click(within(r).getByRole("button", { name: "Actions for Ship @CRM" }));
    await user.keyboard("{Escape}");
    fireEvent.click(within(r).getByRole("link", { name: "CRM" }));
    expect(window.location.search).toBe("");
    await user.click(within(r).getByRole("button", { name: "Mark “Ship @CRM” done" }));
    expect(window.location.search).toBe("");
    // The check writes once the strike has drawn.
    await waitFor(() => expect(updateTodoAction).toHaveBeenCalledWith(t.id, { state: "done" }, UPDATED));
  });

  it("opens a deep link to a To-do closed on an earlier day, which the lists don't show", () => {
    const old = todo({ title: "Renew the passport", day: "2026-10-02", state: "done", closedAt: "2026-10-02T09:00:00Z" });
    setup(page([], { id: old.id, extra: [old] }), `/personal?todo=${old.id}`);
    expect(within(panel()).getByRole("heading", { name: "Renew the passport" })).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Reopen “Renew the passport”" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Closed today" })).toBeNull();
  });

  it("says a To-do that no longer exists, with a link back that closes the panel", async () => {
    const { user } = setup(page([], { id: "gone", extra: [] }), "/personal?todo=gone");
    expect(panel()).toHaveTextContent("This To-do no longer exists");
    await user.click(within(panel()).getByRole("link", { name: "Back to the list" }));
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("complementary", { name: "To-do details" })).toBeNull();
  });

  it("reads a To-do it doesn't hold yet at once, through the poll with ?todo=", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => page([], { id: "x9", extra: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    setup(page([]), "/personal");
    act(() => window.history.pushState(null, "", "?todo=x9"));
    expect(panel()).toHaveTextContent("Loading");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/todos?todo=x9", expect.anything()));
    expect(await within(panel()).findByText("This To-do no longer exists")).toBeInTheDocument();
  });

  it("opens as a dialog below 1180 px", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const t = todo({ title: "Pack" });
    const { user } = setup(page([t]));
    await user.click(screen.getByRole("button", { name: "Open “Pack”" }));
    const dialog = await screen.findByRole("dialog", { name: "Pack" });
    expect(within(dialog).getByLabelText("Details")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(window.location.search).toBe("");
  });
});

describe("the title", () => {
  it("edits with Enter, cancels with Esc, and keeps an edit in progress through a refresh", async () => {
    const t = todo({ title: "Call Luca" });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user, serverSends } = setup(page([t]), `/personal?todo=${t.id}`);

    await user.click(within(panel()).getByRole("button", { name: "Edit title" }));
    const input = within(panel()).getByRole("combobox", { name: "Title" });
    await user.clear(input);
    await user.type(input, "Call Marco");
    await user.keyboard("{Escape}");
    expect(updateTodoAction).not.toHaveBeenCalled();
    expect(within(panel()).getByRole("heading", { name: "Call Luca" })).toBeInTheDocument();

    await user.click(within(panel()).getByRole("button", { name: "Edit title" }));
    await user.type(within(panel()).getByRole("combobox", { name: "Title" }), " @CR");
    // The `@` list offers the Project; Enter picks it.
    expect(await screen.findByRole("option", { name: /CRM rebuild/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    // The poll lands mid-edit with a newer copy: the edit stays.
    serverSends(page([{ ...t, details: "from Parla", updatedAt: "2026-10-17T12:00:00.000Z" }]));
    expect(within(panel()).getByRole("combobox", { name: "Title" })).toHaveValue("Call Luca @CRM ");
    await user.keyboard("{Enter}");
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { title: "Call Luca @CRM" }, "2026-10-17T12:00:00.000Z");
    expect(within(panel()).getByRole("heading", { name: "Call Luca @CRM" })).toBeInTheDocument();
  });

  it("re-derives the chips from the API's answer", async () => {
    const t = todo({ title: "Call Luca" });
    const saved = { ...t, title: "Call Luca @crm", references: [{ key: "CRM", projectId: "p-crm", projectDeleted: false }] };
    updateTodoAction.mockResolvedValue(ok(saved));
    const { user, serverSends } = setup(page([t]), `/personal?todo=${t.id}`);
    await user.click(within(panel()).getByRole("button", { name: "Edit title" }));
    await user.type(within(panel()).getByRole("combobox", { name: "Title" }), " @crm");
    // Blur saves too.
    await user.click(within(panel()).getByLabelText("Details"));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { title: "Call Luca @crm" }, UPDATED);
    serverSends(page([saved]));
    expect(within(panel()).getByRole("link", { name: "CRM" })).toHaveAttribute("href", "/projects/p-crm");
  });
});

describe("the fields", () => {
  it("saves Details on blur, and keeps typing through a refresh", async () => {
    const t = todo({ title: "Taxes" });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user, serverSends } = setup(page([t]), `/personal?todo=${t.id}`);
    const details = within(panel()).getByLabelText("Details");
    await user.type(details, "Bring the receipts");
    serverSends(page([{ ...t, title: "Taxes 2026" }]));
    expect(details).toHaveValue("Bring the receipts");
    await user.tab();
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { details: "Bring the receipts" }, UPDATED);
  });

  it("saves a Details draft when back or forward moves away with no blur", async () => {
    const a = todo({ title: "Taxes" });
    const b = todo({ title: "Gym" });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user } = setup(page([a, b]), `/personal?todo=${b.id}`);
    act(() => window.history.pushState(null, "", `?todo=${a.id}`));
    await user.type(within(panel()).getByLabelText("Details"), "Bring the receipts");
    act(() => window.history.back());
    await waitFor(() => expect(within(panel()).getByRole("heading", { name: "Gym" })).toBeInTheDocument());
    expect(updateTodoAction).toHaveBeenCalledWith(a.id, { details: "Bring the receipts" }, UPDATED);
  });

  it("shows the Planned day and the Reminder, which open the pickers, and the source", async () => {
    const t = todo({ title: "Gym", reminder: { time: "18:00", status: "pending", failure: null, sentAt: null }, source: "parla" });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user } = setup(page([t]), `/personal?todo=${t.id}`);
    expect(panel()).toHaveTextContent(/Createds*via Parla/);
    await user.click(within(panel()).getByRole("button", { name: /^Planned day/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Planned day" })).getByRole("button", { name: "Tomorrow" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { day: "2026-10-18" }, UPDATED);
    await user.click(within(panel()).getByRole("button", { name: /^Change Reminder/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reminder" })).getByRole("button", { name: "20:30" }));
    expect(updateTodoAction).toHaveBeenLastCalledWith(t.id, { time: "20:30" }, UPDATED);
  });

  it("explains a failed Reminder", () => {
    const t = todo({ reminder: { time: "09:00", status: "failed", failure: "telegram_forbidden", sentAt: null } });
    setup(page([t]), `/personal?todo=${t.id}`);
    expect(panel()).toHaveTextContent("Telegram refused it. Check the bot settings.");
    expect(panel()).toHaveTextContent(/Createds*in the dashboard/);
  });
});

describe("Sub-to-dos", () => {
  it("lists them with their own rows, closed ones from earlier days included, and adds one with a day and a time", async () => {
    const parent = todo({ title: "Fix the kitchen", subTodos: { done: 1, total: 2 } });
    const open = todo({ title: "Buy tiles", parentId: parent.id, day: null, subTodos: null });
    const old = todo({ title: "Measure the wall", parentId: parent.id, day: null, state: "done", closedAt: "2026-10-05T10:00:00Z", subTodos: null });
    createTodoAction.mockResolvedValue({ ok: true, data: { id: "new" } });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user, serverSends } = setup(page([parent, open], { id: parent.id, extra: [old] }), `/personal?todo=${parent.id}`);

    const list = within(panel()).getByRole("list", { name: "Sub-to-dos" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Buy tiles"), expect.stringContaining("Measure the wall")]);
    expect(panel()).toHaveTextContent("1/2");
    // Undated Sub-to-dos only show under their parent.
    expect(within(screen.getByRole("region", { name: /^Today/ })).queryByText("Buy tiles")).toBeNull();

    await user.click(within(list).getByRole("button", { name: "Mark “Buy tiles” done" }));
    await waitFor(() => expect(updateTodoAction).toHaveBeenCalledWith(open.id, { state: "done" }, UPDATED));

    await user.type(within(panel()).getByRole("combobox", { name: "Add a Sub-to-do" }), "Call the electrician tomorrow 09:30{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Call the electrician", day: "2026-10-18", time: "09:30", parentId: parent.id });
    // The revalidation brings it back: under the parent, with its day and Reminder.
    const added = todo({ title: "Call the electrician", parentId: parent.id, day: "2026-10-18", reminder: { time: "09:30", status: "pending", failure: null, sentAt: null }, subTodos: null });
    serverSends(page([{ ...parent, subTodos: { done: 1, total: 3 } }, open, added], { id: parent.id, extra: [old] }));
    const item = within(within(panel()).getByRole("list", { name: "Sub-to-dos" })).getByText("Call the electrician").closest("li") as HTMLElement;
    expect(item).toHaveTextContent("Tomorrow");
    expect(item).toHaveTextContent("09:30");
  });

  it("opens a Sub-to-do from its row, and goes back to the parent from it", async () => {
    const parent = todo({ title: "Fix the kitchen", subTodos: { done: 0, total: 1 } });
    const sub = todo({ title: "Buy tiles", parentId: parent.id, day: null, subTodos: null });
    const { user } = setup(page([parent, sub]), `/personal?todo=${parent.id}`);
    await user.click(within(panel()).getByRole("button", { name: "Open “Buy tiles”" }));
    expect(window.location.search).toBe(`?todo=${sub.id}`);
    expect(within(panel()).queryByRole("list", { name: "Sub-to-dos" })).toBeNull();
    await user.click(within(panel()).getByRole("button", { name: "Sub-to-do of Fix the kitchen" }));
    expect(window.location.search).toBe(`?todo=${parent.id}`);
  });
});
