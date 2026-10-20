// @vitest-environment jsdom
import type { ProjectOption, Todo } from "@traccia/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";
import type { LogbookPage, PersonalSpaceData, SelectedTodo } from "../lib/personal/lists";

const { createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction } = vi.hoisted(() => ({
  createTodoAction: vi.fn(),
  updateTodoAction: vi.fn(),
  deleteTodoAction: vi.fn(),
  moveTodoAction: vi.fn(),
}));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction }));
vi.mock("next/navigation", () => import("./history-navigation"));

// Saturday 17 October 2026, 15:00 in Rome.
const TODAY = "2026-10-17";
const UPDATED = "2026-10-01T08:00:00.000Z";
const NOW = new Date("2026-10-17T13:00:00Z");

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
    updatedAt: UPDATED,
    ...over,
  };
}
// A write that stays on its way until the test ends. React entangles pending transitions, so one left hanging would
// hold every later test's rollbacks back.
const hanging: (() => void)[] = [];
function hang() {
  return new Promise((resolve) => hanging.push(() => resolve({ ok: false, error: "", fieldErrors: {} })));
}

const projects: ProjectOption[] = [{ id: "p-crm", key: "CRM", name: "CRM rebuild", status: "active" }];
const crm = { key: "CRM", projectId: "p-crm", projectDeleted: false };
const page = (todos: Todo[], selected?: SelectedTodo): PersonalSpaceData => ({ today: TODAY, timeZone: "Europe/Rome", todos, ...(selected ? { selected } : {}) });

/** The dashboard routes the page reads, by path: the poll (`/api/todos`, quiet unless given) and the Logbook's pages by cursor. */
function serveRoutes(routes: { poll?: PersonalSpaceData; logbook?: Record<string, LogbookPage> }) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, "http://dash");
    if (url.pathname === "/api/todos/logbook") {
      const answer = routes.logbook?.[url.searchParams.get("cursor") ?? ""];
      return answer ? new Response(JSON.stringify(answer)) : new Response("{}", { status: 500 });
    }
    return routes.poll ? new Response(JSON.stringify(routes.poll)) : new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setup(data: PersonalSpaceData, url = "/personal") {
  window.history.replaceState(null, "", url);
  const view = render(<PersonalSpace initial={data} projects={projects} />, { wrapper: TooltipProvider });
  // What the server action's revalidation (or the poll) does: the page renders again with the API's data.
  const serverSends = (next: PersonalSpaceData) => view.rerender(<PersonalSpace initial={next} projects={projects} />);
  return { user: userEvent.setup(), serverSends };
}
const menu = () => screen.getByRole("navigation", { name: "Personal lists" });
// The list's own heading comes first (an empty state and the panel have their own).
const heading = () => screen.getAllByRole("heading", { level: 2 })[0] as HTMLElement;
const panel = () => screen.getByRole("complementary", { name: "To-do details" });
const section = (name: string | RegExp) => screen.getByRole("region", { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  serveRoutes({});
  for (const action of [createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction]) action.mockReset();
});
afterEach(async () => {
  await act(async () => {
    for (const settle of hanging.splice(0)) settle();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the list in the URL", () => {
  it("puts the chosen list in ?list=, and back and forward move between lists", async () => {
    const { user } = setup(page([todo({ day: null, title: "Someday" })]));
    expect(heading()).toHaveTextContent("Saturday");
    await user.click(within(menu()).getByRole("button", { name: /Anytime/ }));
    expect(window.location.search).toBe("?list=anytime");
    expect(heading()).toHaveTextContent("Anytime");
    await user.click(within(menu()).getByRole("button", { name: /Upcoming/ }));
    expect(window.location.search).toBe("?list=upcoming");
    act(() => window.history.back());
    await waitFor(() => expect(heading()).toHaveTextContent("Anytime"));
    act(() => window.history.back());
    await waitFor(() => expect(heading()).toHaveTextContent("Saturday"));
  });

  it("opens the list a fresh load names, and keeps it when a To-do is selected and the panel closed", async () => {
    const t = todo({ day: null, title: "Someday" });
    const { user } = setup(page([t]), "/personal?list=anytime");
    expect(heading()).toHaveTextContent("Anytime");
    await user.click(screen.getByRole("button", { name: "Open “Someday”" }));
    expect(window.location.search).toBe(`?list=anytime&todo=${t.id}`);
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(window.location.search).toBe("?list=anytime");
    expect(heading()).toHaveTextContent("Anytime");
  });

  it("opens a link to an Anytime To-do over Anytime with the panel, and writes that list into the same history entry", () => {
    const t = todo({ day: null, title: "Call the plumber" });
    const length = window.history.length;
    setup(page([t]), `/personal?todo=${t.id}`);
    expect(heading()).toHaveTextContent("Anytime");
    expect(within(panel()).getByRole("heading", { name: "Call the plumber" })).toBeInTheDocument();
    expect(window.location.search).toBe(`?list=anytime&todo=${t.id}`);
    expect(window.history.length).toBe(length);
  });

  it("picks the list again for each link that back and forward return to", async () => {
    const later = todo({ day: "2026-10-20", title: "Dentist" });
    const someday = todo({ day: null, title: "Paint the fence" });
    setup(page([later, someday]), `/personal?todo=${someday.id}`);
    expect(heading()).toHaveTextContent("Anytime");
    // A link that only names the To-do, as a Reminder's does.
    act(() => window.history.pushState(null, "", `?todo=${later.id}`));
    await waitFor(() => expect(heading()).toHaveTextContent("Upcoming"));
    expect(window.location.search).toBe(`?list=upcoming&todo=${later.id}`);
    act(() => window.history.back());
    await waitFor(() => expect(heading()).toHaveTextContent("Anytime"));
  });

  it("opens a To-do closed on an earlier day over the Logbook", () => {
    const old = todo({ title: "Renew the passport", state: "done", closedAt: "2026-10-02T09:00:00Z" });
    setup(page([], { id: old.id, extra: [old] }), `/personal?todo=${old.id}`);
    expect(heading()).toHaveTextContent("Logbook");
    expect(within(panel()).getByRole("heading", { name: "Renew the passport" })).toBeInTheDocument();
  });

  it("opens an undated Sub-to-do over its parent's list", () => {
    const parent = todo({ day: "2026-10-22", title: "Move house", subTodos: { done: 0, total: 1 } });
    const sub = todo({ day: null, parentId: parent.id, title: "Book the van", subTodos: null });
    setup(page([parent, sub]), `/personal?todo=${sub.id}`);
    expect(heading()).toHaveTextContent("Upcoming");
  });

  it("keeps the list while the selected To-do changes: closing it from Today doesn't jump to the Logbook", async () => {
    const t = todo({ title: "Pay rent" });
    updateTodoAction.mockImplementation(hang);
    const { user } = setup(page([t]), `/personal?todo=${t.id}`);
    await user.click(within(panel()).getByRole("button", { name: "Mark “Pay rent” done" }));
    await waitFor(() => expect(updateTodoAction).toHaveBeenCalled());
    expect(heading()).toHaveTextContent("Saturday");
  });
});

describe("Upcoming", () => {
  it("shows the next 14 days, empty ones dimmed with Nothing planned, then Later by day, with no day on the rows", () => {
    const tomorrow = todo({ day: "2026-10-18", title: "Gym" });
    const far = todo({ day: "2026-11-20", title: "Renew the car insurance" });
    const nextYear = todo({ day: "2027-01-05", title: "Tax return" });
    setup(page([tomorrow, far, nextYear, todo({ title: "Today's" }), todo({ day: null, title: "Someday" })]), "/personal?list=upcoming");
    const gym = within(section("Tomorrow")).getByText("Gym").closest("li") as HTMLElement;
    expect(within(gym).queryByRole("button", { name: /Change Planned day \(/ })).toBeNull();
    const empty = section(/^Mon 19 Oct/);
    expect(empty).toHaveTextContent("Nothing planned");
    expect(empty).toHaveClass("opacity-60");
    expect(section(/^Sat 31 Oct/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Sun 1 Nov/ })).toBeNull();
    const later = section(/^Later/);
    expect(within(later).getByRole("region", { name: "Fri 20 Nov" })).toHaveTextContent("Renew the car insurance");
    expect(within(later).getByRole("region", { name: "Tue 5 Jan 2027" })).toHaveTextContent("Tax return");
    expect(screen.queryByText("Today's")).toBeNull();
    expect(screen.queryByText("Someday")).toBeNull();
  });

  it("shows a Sub-to-do added as “Call the electrician tomorrow 09:30” in tomorrow's section", async () => {
    const parent = todo({ day: null, title: "Fix the kitchen" });
    createTodoAction.mockResolvedValue({ ok: true, data: { id: "new" } });
    const { user, serverSends } = setup(page([parent]), `/personal?list=upcoming&todo=${parent.id}`);
    await user.type(within(panel()).getByRole("combobox", { name: "Add a Sub-to-do" }), "Call the electrician tomorrow 09:30{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Call the electrician", day: "2026-10-18", time: "09:30", parentId: parent.id });
    const added = todo({ title: "Call the electrician", parentId: parent.id, day: "2026-10-18", reminder: { time: "09:30", status: "pending", failure: null, sentAt: null }, subTodos: null });
    serverSends(page([{ ...parent, subTodos: { done: 0, total: 1 } }, added], { id: parent.id, extra: [] }));
    const row = within(section("Tomorrow")).getByText("Call the electrician").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("09:30");
  });
});

describe("Anytime", () => {
  it("adds with no day, and lists the To-dos without one, each parent with its Sub-to-dos indented under it", async () => {
    const parent = todo({ day: null, title: "Plan the trip", subTodos: { done: 0, total: 2 } });
    const sub = todo({ day: null, parentId: parent.id, title: "Book flights", subTodos: null });
    const dated = todo({ day: "2026-10-20", parentId: parent.id, title: "Call the hotel", subTodos: null });
    const other = todo({ day: null, title: "Read the manual" });
    createTodoAction.mockResolvedValue({ ok: true, data: { id: "new" } });
    const { user } = setup(page([parent, sub, dated, other, todo({ title: "Today's" })]), "/personal?list=anytime");
    const list = screen.getByRole("list", { name: "Anytime" });
    const parentRow = within(list).getByText("Plan the trip").closest("li") as HTMLElement;
    const subs = within(parentRow).getByRole("list", { name: "Sub-to-dos of Plan the trip" });
    expect(within(subs).getByText("Book flights")).toBeInTheDocument();
    expect(within(subs).getByText("Call the hotel").closest("li")).toHaveTextContent("Tue 20 Oct");
    expect(within(list).getByText("Read the manual")).toBeInTheDocument();
    expect(screen.queryByText("Today's")).toBeNull();

    await user.type(screen.getByRole("combobox", { name: "New To-do" }), "Water the plants{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Water the plants", day: null, time: null, parentId: undefined });
  });
});

describe("By project", () => {
  it("heads the list with the key chip and the Project's name, and lists its open To-dos by day, Anytime last", async () => {
    const someday = todo({ day: null, title: "Sketch @CRM", references: [crm] });
    const soon = todo({ day: "2026-10-19", title: "Demo @CRM", references: [crm] });
    const late = todo({ day: "2026-10-12", title: "Invoice @CRM", references: [crm] });
    const { user } = setup(page([someday, soon, late, todo({ title: "Unrelated" })]));
    await user.click(within(menu()).getByRole("button", { name: "CRM, 3 open" }));
    expect(window.location.search).toBe("?list=project:CRM");
    expect(heading()).toHaveTextContent("CRMCRM rebuild");
    expect(within(heading()).getByRole("link", { name: "CRM rebuild" })).toHaveAttribute("href", "/projects/p-crm");
    const rows = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-todo-id"));
    expect(rows.map((li) => li.getAttribute("data-todo-id"))).toEqual([late.id, soon.id, someday.id]);
    expect(rows[0]).toHaveTextContent("Mon 12 Oct");
  });
});

describe("Logbook", () => {
  const closed = (title: string, closedAt: string) => todo({ title, state: "done", closedAt });

  it("reads its own pages: grouped by close day, newest first, the next page on demand, and never on the poll", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const today = closed("Paid the bill", "2026-10-17T08:00:00.000Z");
    const yesterday = closed("Booked the dentist", "2026-10-16T09:00:00.000Z");
    const older = closed("Renewed the passport", "2026-10-02T09:00:00.000Z");
    const fetchMock = serveRoutes({
      poll: page([today]),
      logbook: { "": { items: [today, yesterday], nextCursor: "c2" }, c2: { items: [older], nextCursor: null } },
    });
    const { user } = setup(page([today]), "/personal?list=logbook");
    expect(await screen.findByRole("region", { name: "Today" })).toHaveTextContent("Paid the bill");
    expect(section("Yesterday")).toHaveTextContent("Booked the dentist");
    expect(screen.queryByText("Renewed the passport")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show older" }));
    expect(await screen.findByRole("region", { name: "Fri 2 Oct" })).toHaveTextContent("Renewed the passport");
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
    const logbookReads = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/todos/logbook"));
    expect(logbookReads()).toEqual(["/api/todos/logbook", "/api/todos/logbook?cursor=c2"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/todos", expect.anything());
    expect(logbookReads()).toHaveLength(2);
  });

  it("reopens a row closed on an earlier day, which then leaves the Logbook", async () => {
    const old = closed("Booked the dentist", "2026-10-16T09:00:00.000Z");
    serveRoutes({ logbook: { "": { items: [old], nextCursor: null } } });
    const reopened = { ...old, state: "open" as const, closedAt: null };
    updateTodoAction.mockResolvedValue({ ok: true, data: { todo: reopened } });
    const { user, serverSends } = setup(page([]), "/personal?list=logbook");
    await user.click(await screen.findByRole("button", { name: "Reopen “Booked the dentist”" }));
    await waitFor(() => expect(updateTodoAction).toHaveBeenCalledWith(old.id, { state: "open" }, UPDATED));
    serverSends(page([reopened]));
    await waitFor(() => expect(screen.queryByText("Booked the dentist")).toBeNull());
    expect(screen.getByText("Nothing done yet")).toBeInTheDocument();
  });

  it("drops a deleted To-do and its Sub-to-dos from the pages it holds, and keeps them out", async () => {
    const parent = closed("Fix the kitchen", "2026-10-16T09:00:00.000Z");
    const sub = { ...closed("Buy tiles", "2026-10-16T09:00:00.000Z"), parentId: parent.id };
    const other = closed("Booked the dentist", "2026-10-16T08:00:00.000Z");
    serveRoutes({ logbook: { "": { items: [parent, sub, other], nextCursor: null } } });
    deleteTodoAction.mockResolvedValue({ ok: true, data: undefined });
    const { user, serverSends } = setup(page([]), "/personal?list=logbook");
    await screen.findByText("Fix the kitchen");
    await user.click(screen.getByRole("button", { name: "Actions for Fix the kitchen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Fix the kitchen")).toBeNull());
    expect(screen.queryByText("Buy tiles")).toBeNull();
    // A render with the same data (the delete's revalidation) doesn't bring them back.
    serverSends(page([]));
    expect(screen.queryByText("Fix the kitchen")).toBeNull();
    expect(screen.getByText("Booked the dentist")).toBeInTheDocument();
  });

  it("says when a page could not be read, and tries again", async () => {
    serveRoutes({ logbook: {} });
    const { user } = setup(page([]), "/personal?list=logbook");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the Logbook.");
    serveRoutes({ logbook: { "": { items: [], nextCursor: null } } });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing done yet")).toBeInTheDocument();
  });
});

describe("drag to reorder", () => {
  // jsdom lays nothing out: each row stands 40 px below the one before it, in document order, as on screen.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const li = this.closest("li[data-todo-id]");
      const rows = [...document.querySelectorAll("li[data-todo-id]")];
      const top = li ? rows.indexOf(li) * 40 : 0;
      return { x: 0, y: top, top, left: 0, width: 600, height: li ? 36 : 0, right: 600, bottom: top + (li ? 36 : 0), toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("moves a Today row with the keyboard: it shows at once, and the API gets its new neighbour", async () => {
    const [a, b, c] = [todo({ title: "Alpha" }), todo({ title: "Bravo" }), todo({ title: "Charlie" })];
    moveTodoAction.mockImplementation(hang);
    const { user } = setup(page([a, b, c]));
    screen.getByRole("button", { name: "Reorder “Alpha”" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveTodoAction).toHaveBeenCalledWith(a.id, { afterId: b.id }));
    const order = within(section(/^Today/)).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"));
    expect(order).toEqual([b.id, a.id, c.id]);
  });

  it("puts it back, with the API's reason under the row, when the API refuses", async () => {
    const [a, b] = [todo({ title: "Alpha" }), todo({ title: "Bravo" })];
    moveTodoAction.mockResolvedValue({ ok: false, error: "Invalid request", fieldErrors: { afterId: "must be in the same bucket" } });
    const { user } = setup(page([a, b]));
    screen.getByRole("button", { name: "Reorder “Alpha”" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveTodoAction).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reorder it. Must be in the same bucket");
    expect(within(section(/^Today/)).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"))).toEqual([a.id, b.id]);
  });

  it("keeps today's Sub-to-dos in a block after the top-level rows, so the top-level rows drag among themselves", async () => {
    const parent = todo({ day: null, title: "Kitchen" });
    const sub = todo({ title: "Buy tiles", parentId: parent.id, position: 1, subTodos: null });
    const a = todo({ title: "Alpha", position: 2 });
    const b = todo({ title: "Bravo", position: 3 });
    moveTodoAction.mockImplementation(hang);
    const { user } = setup(page([parent, sub, a, b]));
    // Position can't be compared across buckets: the Sub-to-do's 1 doesn't put it first.
    expect(within(section(/^Today/)).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"))).toEqual([a.id, b.id, sub.id]);
    expect(within(section(/^Today/)).getByRole("button", { name: "Open “Buy tiles”" }).closest("li")).toHaveTextContent("Kitchen ›");
    screen.getByRole("button", { name: "Reorder “Alpha”" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveTodoAction).toHaveBeenCalledWith(a.id, { afterId: b.id }));
    // Dragged past the end of its block, the row lands where it was released: the Sub-to-do's block doesn't count.
    expect(within(section(/^Today/)).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"))).toEqual([b.id, a.id, sub.id]);
  });

  it("drags a Sub-to-do among its own parent's, in a block of its own", async () => {
    const [p1, p2] = [todo({ day: null, title: "Kitchen", position: 1 }), todo({ day: null, title: "Garden", position: 2 })];
    const s1 = todo({ title: "Buy tiles", parentId: p1.id, position: 5, subTodos: null });
    const s2 = todo({ title: "Grout", parentId: p1.id, position: 6, subTodos: null });
    const s3 = todo({ title: "Mow", parentId: p2.id, position: 1, subTodos: null });
    moveTodoAction.mockImplementation(hang);
    const { user } = setup(page([p2, p1, s3, s2, s1]));
    // By parent (Kitchen, then Garden), each parent's by Position.
    expect(within(section(/^Today/)).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"))).toEqual([s1.id, s2.id, s3.id]);
    screen.getByRole("button", { name: "Reorder “Buy tiles”" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveTodoAction).toHaveBeenCalledWith(s1.id, { afterId: s2.id }));
  });

  describe("Move up and Move down in the … menu", () => {
    const items = (section: HTMLElement) => within(section).getAllByRole("listitem").map((li) => li.getAttribute("data-todo-id"));
    const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
      await user.click(screen.getByRole("button", { name: `Actions for ${title}` }));
      await screen.findByRole("menu");
    };

    it("moves a Today row one step, through the position endpoint with its neighbour", async () => {
      const [a, b, c] = [todo({ title: "Alpha" }), todo({ title: "Bravo" }), todo({ title: "Charlie" })];
      moveTodoAction.mockImplementation(hang);
      const { user } = setup(page([a, b, c]));
      await openMenu(user, "Bravo");
      await user.click(screen.getByRole("menuitem", { name: "Move down" }));
      expect(moveTodoAction).toHaveBeenCalledWith(b.id, { afterId: c.id });
      await waitFor(() => expect(items(section(/^Today/))).toEqual([a.id, c.id, b.id]));
    });

    it("disables Move up on the first row and Move down on the last", async () => {
      const [a, b] = [todo({ title: "Alpha" }), todo({ title: "Bravo" })];
      const { user } = setup(page([a, b]));
      await openMenu(user, "Alpha");
      expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute("aria-disabled");
      await user.keyboard("{Escape}");
      await openMenu(user, "Bravo");
      expect(screen.getByRole("menuitem", { name: "Move down" })).toHaveAttribute("aria-disabled", "true");
    });

    it("steps a Sub-to-do among its parent's only, and offers none on an Overdue row", async () => {
      const parent = todo({ day: null, title: "Kitchen" });
      const s1 = todo({ title: "Buy tiles", parentId: parent.id, subTodos: null });
      const s2 = todo({ title: "Grout", parentId: parent.id, subTodos: null });
      const late = todo({ title: "Old one", day: "2026-10-15" });
      moveTodoAction.mockImplementation(hang);
      const { user } = setup(page([parent, s1, s2, late]));
      await openMenu(user, "Grout");
      await user.click(screen.getByRole("menuitem", { name: "Move up" }));
      expect(moveTodoAction).toHaveBeenCalledWith(s2.id, { beforeId: s1.id });
      await openMenu(user, "Old one");
      expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    });

    it("works in Anytime, and not on a dated Sub-to-do shown under its parent", async () => {
      const p = todo({ day: null, title: "Plan the trip", subTodos: { done: 0, total: 1 } });
      const q = todo({ day: null, title: "Read the manual" });
      const dated = todo({ day: "2026-10-20", parentId: p.id, title: "Call the hotel", subTodos: null });
      moveTodoAction.mockImplementation(hang);
      const { user } = setup(page([p, q, dated]), "/personal?list=anytime");
      await openMenu(user, "Read the manual");
      await user.click(screen.getByRole("menuitem", { name: "Move up" }));
      expect(moveTodoAction).toHaveBeenCalledWith(q.id, { beforeId: p.id });
      await openMenu(user, "Call the hotel");
      expect(screen.queryByRole("menuitem", { name: "Move down" })).toBeNull();
    });
  });

  it("reorders Anytime, and a parent's undated Sub-to-dos among themselves", async () => {
    const p = todo({ day: null, title: "Plan the trip", subTodos: { done: 0, total: 2 } });
    const s1 = todo({ day: null, parentId: p.id, title: "Book flights", subTodos: null });
    const s2 = todo({ day: null, parentId: p.id, title: "Pack", subTodos: null });
    const q = todo({ day: null, title: "Read the manual" });
    moveTodoAction.mockImplementation(hang);
    const { user } = setup(page([p, s1, s2, q]), "/personal?list=anytime");
    screen.getByRole("button", { name: "Reorder “Pack”" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveTodoAction).toHaveBeenCalledWith(s2.id, { beforeId: s1.id }));
  });
});
