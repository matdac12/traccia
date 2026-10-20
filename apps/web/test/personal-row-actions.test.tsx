// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";

const { updateTodoAction, deleteTodoAction, restoreTodoAction } = vi.hoisted(() => ({ updateTodoAction: vi.fn(), deleteTodoAction: vi.fn(), restoreTodoAction: vi.fn() }));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction: vi.fn(), updateTodoAction, deleteTodoAction, restoreTodoAction }));

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
const pending = (time: string) => ({ time, status: "pending" as const, failure: null, sentAt: null });

/** A promise the test settles, to look at the page while a write is on its way. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// A write that stays on its way until the test ends. React entangles pending transitions, so one left hanging would
// hold every later test's rollbacks back.
const hanging: (() => void)[] = [];
function hang() {
  const write = deferred<unknown>();
  hanging.push(() => write.resolve({ ok: false, error: "", fieldErrors: {} }));
  return write.promise;
}

const page = (todos: Todo[]) => ({ today: TODAY, timeZone: "Europe/Rome", todos });
function setup(todos: Todo[]) {
  const view = render(<PersonalSpace initial={page(todos)} projects={[]} />, { wrapper: TooltipProvider });
  // What the server action's revalidation does: the page renders again with the API's data.
  const serverSends = (next: Todo[]) => view.rerender(<PersonalSpace initial={page(next)} projects={[]} />);
  return { user: userEvent.setup(), serverSends };
}
const region = (name: RegExp) => screen.getByRole("region", { name });
const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const ok = (t: Todo) => ({ ok: true, data: { todo: t } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The poll stays quiet.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  updateTodoAction.mockReset();
  deleteTodoAction.mockReset();
  restoreTodoAction.mockReset();
});
afterEach(async () => {
  await act(async () => {
    for (const settle of hanging.splice(0)) settle();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the check", () => {
  it("strikes the To-do, then marks it done and moves it to the closed ones; a click on a closed one reopens it", async () => {
    const t = todo({ title: "Pay the bill" });
    const write = deferred<unknown>();
    updateTodoAction.mockReturnValueOnce(write.promise);
    const { user, serverSends } = setup([t]);

    await user.click(screen.getByRole("button", { name: "Mark “Pay the bill” done" }));
    // The line draws in place first.
    expect(screen.getByText("Pay the bill").parentElement).toHaveAttribute("data-struck", "true");
    await waitFor(() => expect(updateTodoAction).toHaveBeenCalledWith(t.id, { state: "done" }, UPDATED));
    expect(within(screen.getByRole("list", { name: "Closed today" })).getByText("Pay the bill")).toBeInTheDocument();

    const done = { ...t, state: "done" as const, closedAt: NOW.toISOString() };
    await act(async () => write.resolve(ok(done)));
    serverSends([done]);
    updateTodoAction.mockResolvedValueOnce(ok(t));
    await user.click(screen.getByRole("button", { name: "Reopen “Pay the bill”" }));
    await waitFor(() => expect(updateTodoAction).toHaveBeenLastCalledWith(t.id, { state: "open" }, UPDATED));
  });

  it("puts the To-do back with the API's error under it when the write is refused", async () => {
    const t = todo({ title: "Call Luca" });
    updateTodoAction.mockResolvedValueOnce({ ok: false, error: "Could not reach the API.", fieldErrors: {} });
    const { user } = setup([t]);
    await user.click(screen.getByRole("button", { name: "Mark “Call Luca” done" }));
    await waitFor(() => expect(within(row("Call Luca")).getByRole("alert")).toHaveTextContent("Could not reach the API."));
    expect(within(region(/^Today/)).getByRole("button", { name: "Mark “Call Luca” done" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Closed today" })).toBeNull();
  });
});

describe("a close just after midnight", () => {
  it("stays in Closed today until the page's data rolls over, instead of vanishing", async () => {
    // 00:00:05 on the 18th in Rome: the page still says it is the 17th.
    vi.setSystemTime(new Date("2026-10-17T22:00:05Z"));
    const t = todo({ title: "Pay the bill" });
    updateTodoAction.mockReturnValueOnce(hang());
    const { user } = setup([t]);
    await user.click(screen.getByRole("button", { name: "Mark “Pay the bill” done" }));
    expect(within(await screen.findByRole("list", { name: "Closed today" })).getByText("Pay the bill")).toBeInTheDocument();
  });
});

/**
 * Holds the strike's 300 ms timer until `release()`, so a test can look at the page while the line draws however slow
 * the machine is (user-event's own delays can outlast 300 ms under load).
 */
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

describe("the … menu strikes like the check", () => {
  it.each([
    ["Mark done", "done"],
    ["Drop", "dropped"],
  ] as const)("%s draws the strike in place, then sends the write", async (item, state) => {
    const t = todo({ title: "Pay the bill" });
    updateTodoAction.mockReturnValueOnce(hang());
    const strike = holdStrike();
    try {
      const { user } = setup([t]);
      await user.click(screen.getByRole("button", { name: "Actions for Pay the bill" }));
      await user.click(await screen.findByRole("menuitem", { name: item }));
      // The line draws in place first: the row is still in Today, struck, and nothing is sent yet.
      expect(screen.getByText("Pay the bill").parentElement).toHaveAttribute("data-struck", "true");
      expect(within(region(/^Today/)).getByText("Pay the bill")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Closed today" })).toBeNull();
      expect(updateTodoAction).not.toHaveBeenCalled();
      await strike.release();
      expect(updateTodoAction).toHaveBeenCalledWith(t.id, { state }, UPDATED);
      expect(within(await screen.findByRole("list", { name: "Closed today" })).getByText("Pay the bill")).toBeInTheDocument();
    } finally {
      strike.restore();
    }
  });

  it("sends the write once when it is asked again while the strike draws", async () => {
    const t = todo({ title: "Pay the bill" });
    updateTodoAction.mockReturnValue(hang());
    const strike = holdStrike();
    try {
      const { user } = setup([t]);
      const check = row("Pay the bill").querySelector("[data-todo-check]") as HTMLElement;
      await user.click(check);
      // While the strike draws the check already shows the new state: a second click on it changes nothing.
      await user.click(check);
      await strike.release();
      expect(updateTodoAction).toHaveBeenCalledTimes(1);
    } finally {
      strike.restore();
    }
  });

  it("sends at once, with no preview, under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    const t = todo({ title: "Pay the bill" });
    updateTodoAction.mockReturnValueOnce(hang());
    const { user } = setup([t]);
    await user.click(screen.getByRole("button", { name: "Actions for Pay the bill" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark done" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { state: "done" }, UPDATED);
  });
});

describe("closing a parent", () => {
  it("asks on the API's 409, retries with closeSubTodos, and leaves everything open on cancel", async () => {
    const parent = todo({ title: "Plan the trip", subTodos: { done: 0, total: 2 } });
    updateTodoAction.mockResolvedValue({ ok: false, error: "The To-do has 2 open Sub-to-dos", fieldErrors: {}, openSubTodos: 2 });
    const { user } = setup([parent]);

    await user.click(screen.getByRole("button", { name: "Mark “Plan the trip” done" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Mark 2 open Sub-to-dos done too?" });
    expect(updateTodoAction).toHaveBeenCalledWith(parent.id, { state: "done" }, UPDATED);
    // Not closed while the API is asked, nor after.
    expect(screen.queryByRole("list", { name: "Closed today" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(updateTodoAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Mark “Plan the trip” done" })).toBeInTheDocument();

    // From the menu this time, and confirmed.
    updateTodoAction.mockReset().mockResolvedValueOnce({ ok: false, error: "", fieldErrors: {}, openSubTodos: 2 }).mockReturnValueOnce(hang());
    await user.click(screen.getByRole("button", { name: "Actions for Plan the trip" }));
    await user.click(await screen.findByRole("menuitem", { name: "Drop" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Drop 2 open Sub-to-dos too?" })).getByRole("button", { name: "Drop all" }));
    expect(updateTodoAction).toHaveBeenLastCalledWith(parent.id, { state: "dropped", closeSubTodos: true }, UPDATED);
    expect(within(await screen.findByRole("list", { name: "Closed today" })).getByText("Plan the trip")).toBeInTheDocument();
  });
});

describe("the day picker", () => {
  it("moves a Today To-do from the calendar icon, and an Overdue one from its day label", async () => {
    const t = todo({ title: "Buy stamps" });
    const late = todo({ title: "Old one", day: "2026-10-15" });
    updateTodoAction.mockReturnValue(hang());
    const { user } = setup([t, late]);

    await user.click(within(row("Buy stamps")).getByRole("button", { name: "Change Planned day" }));
    const picker = await screen.findByRole("dialog", { name: "Planned day" });
    await user.click(within(picker).getByRole("button", { name: "Tomorrow" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { day: "2026-10-18" }, UPDATED);
    expect(screen.queryByText("Buy stamps")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change Planned day (Thu 15 Oct)" }));
    const grid = within(await screen.findByRole("dialog", { name: "Planned day" })).getByRole("group", { name: "October 2026" });
    // Keyboard: past the quick picks and the month arrows, Tab lands on the current day, and the arrows walk the grid.
    for (let i = 0; i < 5; i++) await user.tab();
    expect(within(grid).getByRole("button", { name: "Thursday 15 October" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowRight}{Enter}");
    expect(updateTodoAction).toHaveBeenLastCalledWith(late.id, { day: "2026-10-23" }, UPDATED);
  });

  it("asks before moving a To-do with a Reminder to Anytime, then removes it", async () => {
    const t = todo({ title: "Water plants", reminder: pending("18:00") });
    updateTodoAction.mockReturnValue(hang());
    const { user } = setup([t]);
    await user.click(within(row("Water plants")).getByRole("button", { name: "Change Planned day" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Planned day" })).getByRole("button", { name: /Anytime.*removes the Reminder/ }));

    const confirm = await screen.findByRole("alertdialog", { name: "Move to Anytime?" });
    expect(confirm).toHaveTextContent("loses its 18:00 Reminder");
    expect(updateTodoAction).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Move and remove Reminder" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { day: null }, UPDATED);
  });

  it("moves a To-do whose Reminder was sent, failed or skipped to Anytime without asking", async () => {
    const t = todo({ title: "Water plants", reminder: { time: "09:00", status: "sent", failure: null, sentAt: UPDATED } });
    updateTodoAction.mockReturnValue(hang());
    const { user } = setup([t]);
    await user.click(within(row("Water plants")).getByRole("button", { name: "Change Planned day" }));
    // No "removes the Reminder" hint either: nothing is lost.
    await user.click(within(await screen.findByRole("dialog", { name: "Planned day" })).getByRole("button", { name: /^Anytime$/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { day: null }, UPDATED);
  });

  it.each([
    ["pending", pending("18:00"), true],
    ["sent", { time: "09:00", status: "sent" as const, failure: null, sentAt: UPDATED }, false],
    ["skipped", { time: "09:00", status: "skipped" as const, failure: null, sentAt: null }, false],
  ])("hints 'removes the Reminder' in the row menu only for a pending one (%s)", async (_, reminder, hinted) => {
    const { user } = setup([todo({ title: "Water plants", reminder })]);
    await user.click(screen.getByRole("button", { name: "Actions for Water plants" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to" }));
    const anytime = (await screen.findAllByRole("menuitem")).find((i) => i.textContent?.includes("Anytime"));
    expect(anytime?.textContent?.includes("removes the Reminder")).toBe(hinted);
  });
});

describe("the Reminder picker", () => {
  it("says why a preset is disabled: a tooltip on it and a line under the presets", async () => {
    const { user } = setup([todo({ title: "Gym" })]);
    await user.click(within(row("Gym")).getByRole("button", { name: "Add a Reminder" }));
    const picker = await screen.findByRole("dialog", { name: "Reminder" });
    const note = within(picker).getByText("Times that have already passed are disabled.");
    // 15:00 in Rome now: 12:30 has passed, 18:00 has not.
    expect(within(picker).getByRole("button", { name: "12:30" })).toHaveAccessibleDescription(note.textContent as string);
    expect(within(picker).getByRole("button", { name: "18:00" })).not.toHaveAttribute("aria-describedby");
    await user.hover(within(picker).getByRole("button", { name: "12:30" }).parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("That time has already passed");
  });

  it("shows no such line while every preset is still ahead", async () => {
    vi.setSystemTime(new Date("2026-10-17T05:00:00Z"));
    const { user } = setup([todo({ title: "Gym" })]);
    await user.click(within(row("Gym")).getByRole("button", { name: "Add a Reminder" }));
    const picker = await screen.findByRole("dialog", { name: "Reminder" });
    expect(within(picker).queryByText(/already passed are disabled/)).toBeNull();
  });

  it("repeats the line in the row menu's Reminder submenu", async () => {
    const { user } = setup([todo({ title: "Gym" })]);
    await user.click(screen.getByRole("button", { name: "Actions for Gym" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reminder" }));
    expect(await screen.findByText("Times that have already passed are disabled.")).toBeInTheDocument();
  });

  it("disables the moments already past and sets a Reminder from a preset or an exact time", async () => {
    const t = todo({ title: "Gym" });
    updateTodoAction.mockReturnValue(hang());
    const { user } = setup([t]);
    await user.click(within(row("Gym")).getByRole("button", { name: "Add a Reminder" }));
    const picker = await screen.findByRole("dialog", { name: "Reminder" });
    // 15:00 in Rome now.
    expect(within(picker).getByRole("button", { name: "12:30" })).toBeDisabled();
    expect(within(picker).getByRole("button", { name: "15:00" })).toBeDisabled();
    expect(within(picker).getByRole("button", { name: "18:00" })).toBeEnabled();

    fireEvent.change(within(picker).getByLabelText("Exact time"), { target: { value: "14:10" } });
    expect(within(picker).getByText("That time has already passed.")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "Set" })).toBeDisabled();
    fireEvent.change(within(picker).getByLabelText("Exact time"), { target: { value: "16:45" } });
    await user.click(within(picker).getByRole("button", { name: "Set" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { time: "16:45" }, UPDATED);
    expect(within(row("Gym")).getByText("Reminder at 16:45")).toBeInTheDocument();
  });

  it("removes a Reminder, and shows a refusal under the row", async () => {
    const t = todo({ title: "Dentist", reminder: pending("18:00") });
    updateTodoAction.mockResolvedValueOnce({ ok: false, error: "Invalid request", fieldErrors: { time: "must be in the future" } });
    const { user } = setup([t]);
    await user.click(screen.getByRole("button", { name: "Change Reminder (Reminder at 18:00)" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reminder" })).getByRole("button", { name: "Remove Reminder" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { time: null }, UPDATED);
    await waitFor(() => expect(within(row("Dentist")).getByRole("alert")).toHaveTextContent("Must be in the future"));
    // Rolled back, at the same time.
    expect(within(row("Dentist")).getByText("Reminder at 18:00")).toBeInTheDocument();
  });
});

describe("the … menu", () => {
  it("moves to one of the next 7 days and sets a Reminder preset", async () => {
    const t = todo({ title: "Book the car" });
    updateTodoAction.mockResolvedValue({ ok: false, error: "x", fieldErrors: {} });
    const { user } = setup([t]);
    await user.click(screen.getByRole("button", { name: "Actions for Book the car" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(
      expect.arrayContaining(["Today", "Tomorrow", "Mon 19 Oct", "Fri 23 Oct", "Anytime"]),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Mon 19 Oct" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { day: "2026-10-19" }, UPDATED);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await user.click(await screen.findByRole("button", { name: "Actions for Book the car" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reminder" }));
    expect(screen.getByRole("menuitem", { name: "12:30" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "20:30" }));
    expect(updateTodoAction).toHaveBeenLastCalledWith(t.id, { time: "20:30" }, UPDATED);
  });

  it("deletes to the Trash without asking, and works from the keyboard", async () => {
    const t = todo({ title: "Old idea" });
    deleteTodoAction.mockReturnValue(hang());
    const { user } = setup([t]);
    screen.getByRole("button", { name: "Actions for Old idea" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{End}{Enter}");
    expect(deleteTodoAction).toHaveBeenCalledWith(t.id);
    expect(screen.queryByText("Old idea")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the undo notice after a delete", () => {
  async function deleteFromMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(screen.getByRole("button", { name: `Actions for ${title}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
  }

  it("says the To-do moved to the Trash once the API took it, and Undo restores it", async () => {
    const t = todo({ title: "Old idea" });
    deleteTodoAction.mockResolvedValue({ ok: true, data: undefined });
    restoreTodoAction.mockResolvedValue({ ok: true, data: undefined });
    const { user, serverSends } = setup([t]);
    await deleteFromMenu(user, "Old idea");
    // What the delete's revalidation sends: the page without it.
    serverSends([]);
    const notice = (await screen.findByText(/moved to the Trash/)).closest("div") as HTMLElement;
    expect(notice).toHaveTextContent("“Old idea” moved to the Trash.");
    expect(screen.queryByText("Nothing planned for today")).not.toBeNull();

    await user.click(within(notice).getByRole("button", { name: "Undo delete of “Old idea”" }));
    expect(restoreTodoAction).toHaveBeenCalledWith(t.id);
    await waitFor(() => expect(screen.queryByText(/moved to the Trash/)).toBeNull());
    // What the restore's revalidation sends: the To-do is back.
    serverSends([t]);
    expect(await screen.findByText("Old idea")).toBeInTheDocument();
  });

  it("shows a To-do again that comes back from elsewhere (restored from the Trash page) once the page had dropped it", async () => {
    const t = todo({ title: "Old idea" });
    deleteTodoAction.mockResolvedValue({ ok: true, data: undefined });
    const { user, serverSends } = setup([t]);
    await deleteFromMenu(user, "Old idea");
    serverSends([]);
    await screen.findByText(/moved to the Trash/);
    serverSends([t]);
    expect(await screen.findByText("Old idea")).toBeInTheDocument();
  });

  it("keeps the notice, with the reason, when the Undo fails; Dismiss closes it", async () => {
    const t = todo({ title: "Old idea" });
    deleteTodoAction.mockResolvedValue({ ok: true, data: undefined });
    restoreTodoAction.mockResolvedValue({ ok: false, error: "Could not reach the API.", fieldErrors: {} });
    const { user, serverSends } = setup([t]);
    await deleteFromMenu(user, "Old idea");
    serverSends([]);
    await user.click(await screen.findByRole("button", { name: "Undo delete of “Old idea”" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Undo failed: Could not reach the API.");
    await user.click(within((screen.getByText(/moved to the Trash/)).closest("div") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/moved to the Trash/)).toBeNull();
  });

  it("shows no notice when the delete is refused, and the error stays under the row", async () => {
    const t = todo({ title: "Old idea" });
    deleteTodoAction.mockResolvedValue({ ok: false, error: "To-do not found", fieldErrors: {} });
    const { user } = setup([t]);
    await deleteFromMenu(user, "Old idea");
    await screen.findByText("Old idea");
    expect(within(row("Old idea")).getByRole("alert")).toHaveTextContent("To-do not found");
    expect(screen.queryByText(/moved to the Trash/)).toBeNull();
  });
});
