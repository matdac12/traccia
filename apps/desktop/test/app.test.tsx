import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CreateTodoInput, UpdateTodoInput } from "@traccia/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMethod, ApiOutcome } from "../src/api-client";
import type { SavedSettings, SettingsForm } from "../src/settings";
import { todo } from "./todos";

const configured: SavedSettings = {
  apiUrl: "https://box.tail.ts.net",
  ownerTimezone: "Europe/Rome",
  hasToken: true,
};
const fresh: SavedSettings = {
  apiUrl: null,
  ownerTimezone: "Europe/Rome",
  hasToken: false,
};

const native = vi.hoisted(() => ({
  hideWindow: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn((_url: string) => Promise.resolve()),
  loadSettings: vi.fn<() => Promise<SavedSettings>>(),
  saveSettings: vi.fn<(form: SettingsForm) => Promise<SavedSettings>>(),
  testConnection:
    vi.fn<(apiUrl: string, token: string) => Promise<ApiOutcome>>(),
  openSettings: undefined as (() => void) | undefined,
  onOpenSettings: vi.fn((handler: () => void) => {
    native.openSettings = handler;
    return () => {
      native.openSettings = undefined;
    };
  }),
  /** The window starts shown; `setShown` shows or hides it. */
  setShown: undefined as ((shown: boolean) => void) | undefined,
  onWindowShown: vi.fn((handler: (shown: boolean) => void) => {
    native.setShown = handler;
    handler(true);
    return () => {
      native.setShown = undefined;
    };
  }),
  sendApi:
    vi.fn<
      (method: ApiMethod, path: string, body?: unknown) => Promise<ApiOutcome>
    >(),
}));
vi.mock("../src/native", () => native);

const { App } = await import("../src/app");

async function renderApp(saved: SavedSettings) {
  native.loadSettings.mockResolvedValue(saved);
  render(<App />);
  await waitFor(() => expect(native.loadSettings).toHaveBeenCalled());
  await act(async () => {});
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

/** The API: these open To-dos and Projects, or offline. */
const api = {
  todos: [] as ReturnType<typeof todo>[],
  projects: [] as { id: string; key: string; name: string; status: string }[],
  offline: false,
};

/** `PATCH /v1/todos/:id` as the API does it, with the 409 for a parent's open Sub-to-dos. */
/** `POST /v1/todos` as the API does it: a `@KEY` naming a Project becomes a reference, a time a pending Reminder. */
function postTodo(input: CreateTodoInput): ApiOutcome {
  const created = todo({
    title: input.title,
    day: input.day ?? null,
    reminder: input.time
      ? { time: input.time, status: "pending", failure: null, sentAt: null }
      : null,
    references: api.projects
      .filter((p) => input.title.includes(`@${p.key}`))
      .map((p) => ({ key: p.key, projectId: p.id, projectDeleted: false })),
  });
  api.todos.push(created);
  return { kind: "response", status: 201, body: JSON.stringify(created) };
}

function patchTodo(path: string, input: UpdateTodoInput): ApiOutcome {
  const id = decodeURIComponent(path.replace("/v1/todos/", ""));
  const found = api.todos.find((t) => t.id === id);
  if (!found || !input.state)
    return { kind: "response", status: 404, body: "" };
  const subs = api.todos.filter((t) => t.parentId === id && t.state === "open");
  if (input.state !== "open" && subs.length > 0 && !input.closeSubTodos) {
    return {
      kind: "response",
      status: 409,
      body: JSON.stringify({
        error: {
          code: "conflict",
          message: `To-do has ${subs.length} open Sub-to-dos`,
          details: { openSubTodos: subs.length },
        },
      }),
    };
  }
  for (const t of input.state === "open" ? [found] : [found, ...subs])
    t.state = input.state;
  return { kind: "response", status: 200, body: JSON.stringify(found) };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.todos = [];
  api.projects = [];
  api.offline = false;
  native.sendApi.mockImplementation(async (method, path, body) => {
    if (api.offline) return { kind: "offline", reason: "could not connect" };
    if (method === "PATCH") return patchTodo(path, body as UpdateTodoInput);
    if (method === "POST") return postTodo(body as CreateTodoInput);
    const items = path.startsWith("/v1/projects")
      ? api.projects
      : api.todos.filter((t) => t.state === "open");
    return {
      kind: "response",
      status: 200,
      body: JSON.stringify({ items, nextCursor: null }),
    };
  });
});

describe("the window", () => {
  it("shows the variant G title bar once configured: Personal and a +", async () => {
    await renderApp(configured);
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a To-do" })).toBeTruthy();
  });

  it("hides on Esc", async () => {
    await renderApp(configured);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(native.hideWindow).toHaveBeenCalledTimes(1);
  });

  it("stays shown on other keys", async () => {
    await renderApp(configured);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(native.hideWindow).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    native.loadSettings.mockResolvedValue(configured);
    const { unmount } = render(<App />);
    await act(async () => {});
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(native.hideWindow).not.toHaveBeenCalled();
    expect(native.openSettings).toBeUndefined();
  });
});

describe("Settings", () => {
  it("opens on a fresh install, with Europe/Rome and no way back", async () => {
    await renderApp(fresh);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(field("API URL").value).toBe("");
    expect(field("Owner timezone").value).toBe("Europe/Rome");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("opens from the tray's Settings…, showing the saved values but never the Token", async () => {
    await renderApp(configured);
    act(() => native.openSettings?.());
    expect(field("API URL").value).toBe("https://box.tail.ts.net");
    expect(field("Token").value).toBe("");
    expect(field("Token").type).toBe("password");
    expect(field("Token").placeholder).toBe("Saved in Credential Manager");
  });

  it("goes back to the list on Esc or Back once configured", async () => {
    await renderApp(configured);
    act(() => native.openSettings?.());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
    expect(native.hideWindow).not.toHaveBeenCalled();

    act(() => native.openSettings?.());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
  });

  it("hides the window on Esc on a fresh install", async () => {
    await renderApp(fresh);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(native.hideWindow).toHaveBeenCalledTimes(1);
  });

  it("checks the form before saving", async () => {
    await renderApp(fresh);
    fireEvent.change(field("Owner timezone"), {
      target: { value: "Europe/Atlantis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      screen.getByText("Enter the API URL, starting with https://"),
    ).toBeTruthy();
    expect(
      screen.getByText("Paste a Token with the todos scope."),
    ).toBeTruthy();
    expect(
      screen.getByText("Not a timezone. Use an IANA name, like Europe/Rome."),
    ).toBeTruthy();
    expect(native.saveSettings).not.toHaveBeenCalled();
  });

  it("saves and goes to the list", async () => {
    native.saveSettings.mockResolvedValue(configured);
    await renderApp(fresh);
    fireEvent.change(field("API URL"), {
      target: { value: "https://box.tail.ts.net" },
    });
    fireEvent.change(field("Token"), { target: { value: "trc_secret" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(native.saveSettings).toHaveBeenCalledWith({
      apiUrl: "https://box.tail.ts.net",
      token: "trc_secret",
      ownerTimezone: "Europe/Rome",
    });
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
  });

  it("shows a save the Rust side refused", async () => {
    native.saveSettings.mockRejectedValue(
      "the Token could not be saved in Credential Manager",
    );
    await renderApp(configured);
    act(() => native.openSettings?.());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(
      screen.getByText("the Token could not be saved in Credential Manager"),
    ).toBeTruthy();
  });

  it("tests the connection with the form's values and shows OK", async () => {
    native.testConnection.mockResolvedValue({
      kind: "response",
      status: 200,
      body: JSON.stringify({ items: [], nextCursor: null }),
    });
    await renderApp(configured);
    act(() => native.openSettings?.());
    fireEvent.change(field("Token"), { target: { value: "trc_new" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    });

    expect(native.testConnection).toHaveBeenCalledWith(
      "https://box.tail.ts.net",
      "trc_new",
    );
    expect(screen.getByText("OK. Traccia accepted the Token.")).toBeTruthy();
  });

  it("shows the API's 401 for a wrong Token", async () => {
    native.testConnection.mockResolvedValue({
      kind: "response",
      status: 401,
      body: JSON.stringify({
        error: { code: "unauthorized", message: "Invalid token" },
      }),
    });
    await renderApp(configured);
    act(() => native.openSettings?.());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    });
    expect(
      screen.getByText("Traccia refused the Token (401: Invalid token)."),
    ).toBeTruthy();
  });
});

describe("the list", () => {
  // Sat 17 Oct 2026, 14:30 in Rome. Only Date and the 30 s interval are faked, so waitFor still works.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-17T12:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const sectionNamed = (name: string) =>
    screen.getByRole("region", { name }) as HTMLElement;

  it("shows a Sub-to-do planned today under Today with its parent hint, the parent on its own later day", async () => {
    api.projects = [
      { id: "pr_crm", key: "CRM", name: "Client work", status: "active" },
    ];
    api.todos = [
      todo({
        id: "parent",
        title: "Client A UI @CRM",
        references: [
          { key: "CRM", projectId: "pr_crm", projectDeleted: false },
        ],
        day: "2026-10-23",
        subTodos: { done: 1, total: 3 },
      }),
      todo({
        id: "sub",
        title: "Send mockups",
        day: "2026-10-17",
        parentId: "parent",
      }),
    ];
    await renderApp(configured);
    await screen.findByText("Send mockups");

    const today = sectionNamed("Today");
    expect(today.textContent).toContain("Sat 17 Oct");
    expect(today.textContent).toContain("Send mockups");
    expect(today.textContent).toContain("↳ Client A UI CRM");

    const later = sectionNamed("Fri 23 Oct");
    expect(later.textContent).toContain("Client A UI");
    expect(later.textContent).toContain("1/3");
    expect(screen.getAllByTitle("Client work")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Tomorrow" })).toBeNull();
  });

  it("counts today and open in the title bar", async () => {
    api.todos = [
      todo({ day: "2026-10-15" }),
      todo({ day: "2026-10-17" }),
      todo({ day: "2026-10-18" }),
      todo({ day: null }),
    ];
    await renderApp(configured);
    expect(await screen.findByText("2 today · 4 open")).toBeTruthy();
  });

  it("shows Overdue in red with each row's day, and the Reminder states", async () => {
    api.todos = [
      todo({
        title: "Renew car insurance",
        day: "2026-10-15",
        reminder: {
          time: "10:00",
          status: "failed",
          failure: "gave_up",
          sentAt: null,
        },
      }),
      todo({
        title: "Gym",
        day: "2026-10-17",
        reminder: {
          time: "19:00",
          status: "pending",
          failure: null,
          sentAt: null,
        },
      }),
      todo({
        title: "Call the bank",
        day: "2026-10-17",
        reminder: {
          time: "11:30",
          status: "sent",
          failure: null,
          sentAt: "2026-10-17T09:30:00.000Z",
        },
      }),
    ];
    await renderApp(configured);
    await screen.findByText("Gym");

    const overdue = sectionNamed("Overdue");
    expect(overdue.textContent).toContain("Thu 15");
    const tone = (status: string) =>
      document.querySelector(`[data-reminder="${status}"]`)?.className;
    expect(tone("failed")).toContain("text-destructive");
    expect(tone("pending")).toContain("text-primary");
    expect(tone("sent")).toContain("opacity-55");
  });

  it("says Nothing planned when today is empty", async () => {
    api.todos = [todo({ day: null, title: "Fix the bike light" })];
    await renderApp(configured);
    await screen.findByText("Fix the bike light");
    expect(sectionNamed("Today").textContent).toContain("Nothing planned.");
  });

  it("keeps the old list when Traccia goes offline, and clears the line on the next success", async () => {
    api.todos = [todo({ title: "Gym", day: "2026-10-17" })];
    await renderApp(configured);
    await screen.findByText("Gym");

    api.offline = true;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(
      screen.getByText(
        "Offline · showing the list from 14:30 · changes are off",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Gym")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mark done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Add a To-do" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    api.offline = false;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByText(/^Offline/)).toBeNull();
  });

  it("fetches on every show and not while hidden", async () => {
    await renderApp(configured);
    await waitFor(() => expect(native.sendApi).toHaveBeenCalledTimes(2));

    act(() => native.setShown?.(false));
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(native.sendApi).toHaveBeenCalledTimes(2);

    act(() => native.setShown?.(true));
    await waitFor(() => expect(native.sendApi).toHaveBeenCalledTimes(4));
  });

  it("links a refused Token to Settings", async () => {
    native.sendApi.mockResolvedValue({
      kind: "response",
      status: 401,
      body: JSON.stringify({
        error: { code: "unauthorized", message: "Invalid token" },
      }),
    });
    await renderApp(configured);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Traccia refused the Token. Open Settings.",
      }),
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });
});

describe("actions on rows", () => {
  const patches = () =>
    native.sendApi.mock.calls
      .filter(([method]) => method === "PATCH")
      .map(([, path, body]) => [path, body]);
  /** The row titled `title`, not a Sub-to-do's "↳ title" line. */
  const row = (title: string) =>
    screen
      .getAllByText(title)
      .find((el) => el.closest(".todo-strike"))
      ?.closest("[data-todo]") as HTMLElement;
  const key = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.body, { key, ...init });

  async function showList(...todos: ReturnType<typeof todo>[]) {
    api.todos = todos;
    await renderApp(configured);
    await screen.findAllByText(todos[0]?.title as string);
  }

  it("marks done from the check, struck through until the window hides", async () => {
    await showList(todo({ id: "td_gym", title: "Gym" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(row("Gym").dataset.state).toBe("done");
    await act(async () => {});
    expect(patches()).toEqual([["/v1/todos/td_gym", { state: "done" }]]);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();

    act(() => native.setShown?.(false));
    act(() => native.setShown?.(true));
    await act(async () => {});
    expect(screen.queryByText("Gym")).toBeNull();
  });

  it("asks before closing a parent with open Sub-to-dos; Enter closes all three", async () => {
    const trip = todo({ id: "td_trip", title: "Trip" });
    await showList(
      trip,
      todo({ title: "Pack", parentId: trip.id }),
      todo({ title: "Book", parentId: trip.id }),
    );
    fireEvent.click(
      within(row("Trip")).getByRole("button", { name: "Mark done" }),
    );
    await act(async () => {});
    expect(screen.getByText("Also mark 2 open Sub-to-dos done?")).toBeTruthy();

    key("Enter");
    await act(async () => {});
    expect(patches().at(-1)).toEqual([
      "/v1/todos/td_trip",
      { state: "done", closeSubTodos: true },
    ]);
    expect(api.todos.map((t) => t.state)).toEqual(["done", "done", "done"]);
    expect(screen.queryByText(/Also mark/)).toBeNull();
    expect(["Trip", "Pack", "Book"].map((t) => row(t).dataset.state)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("Esc cancels the confirm without hiding the window", async () => {
    const trip = todo({ id: "td_trip", title: "Trip" });
    await showList(trip, todo({ title: "Pack", parentId: trip.id }));
    fireEvent.contextMenu(row("Trip"));
    await act(async () => {});
    expect(
      screen.getByText("Also mark 1 open Sub-to-do dropped?"),
    ).toBeTruthy();
    key("Escape");
    expect(screen.queryByText(/Also mark/)).toBeNull();
    expect(native.hideWindow).not.toHaveBeenCalled();
    expect(api.todos.map((t) => t.state)).toEqual(["open", "open"]);
  });

  it("selects with ↑ ↓; Space marks done, Del drops and Ctrl+Z reopens", async () => {
    await showList(todo({ title: "Gym" }), todo({ title: "Shop" }));
    key("ArrowDown");
    expect(row("Gym").dataset.selected).toBe("true");
    key("ArrowDown");
    expect(row("Shop").dataset.selected).toBe("true");
    expect(row("Gym").dataset.selected).toBeUndefined();

    key(" ");
    await act(async () => {});
    expect(row("Shop").dataset.state).toBe("done");

    key("ArrowUp");
    key("Delete");
    await act(async () => {});
    expect(row("Gym").dataset.state).toBe("dropped");
    expect(screen.getByRole("status").textContent).toBe("Dropped “Gym”Undo");

    key("z", { ctrlKey: true });
    await act(async () => {});
    expect(row("Gym").dataset.state).toBe("open");
    expect(api.todos.map((t) => t.state)).toEqual(["open", "done"]);
    expect(screen.queryByText(/Dropped/)).toBeNull();
  });

  it("opens the selected To-do's url on Enter, and a title's on click", async () => {
    const gym = todo({ title: "Gym" });
    const shop = todo({ title: "Shop" });
    await showList(gym, shop);
    key("ArrowDown");
    key("Enter");
    expect(native.openUrl).toHaveBeenLastCalledWith(gym.url);
    fireEvent.click(screen.getByText("Shop"));
    expect(native.openUrl).toHaveBeenLastCalledWith(shop.url);
    expect(row("Shop").dataset.selected).toBe("true");
    expect(patches()).toEqual([]);
  });

  it("acts on the selection even with the focus left on a clicked check", async () => {
    await showList(todo({ title: "Gym" }), todo({ title: "Shop" }));
    const check = within(row("Gym")).getByRole("button", { name: "Mark done" });
    fireEvent.click(check);
    await act(async () => {});
    key("ArrowDown");
    expect(row("Shop").dataset.selected).toBe("true");
    const spaceOnCheck = fireEvent.keyDown(check, { key: " " });
    await act(async () => {});
    // Taken by the list: the focused check's own click doesn't happen.
    expect(spaceOnCheck).toBe(false);
    expect(row("Shop").dataset.state).toBe("done");
    expect(row("Gym").dataset.state).toBe("done");
  });

  it("says so when a link won't open", async () => {
    await showList(todo({ title: "Gym" }));
    native.openUrl.mockRejectedValueOnce(
      "The To-do's link is not a web address",
    );
    fireEvent.click(screen.getByText("Gym"));
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe(
      "Couldn't open it. The To-do's link is not a web address",
    );
  });

  it("selects a row from a click on its empty area", async () => {
    await showList(todo({ title: "Gym" }));
    fireEvent.click(row("Gym"));
    expect(row("Gym").dataset.selected).toBe("true");
    expect(native.openUrl).not.toHaveBeenCalled();
  });

  it("puts a refused write back, with a toast", async () => {
    await showList(todo({ title: "Gym" }));
    native.sendApi.mockResolvedValueOnce({
      kind: "response",
      status: 500,
      body: JSON.stringify({
        error: { code: "internal", message: "Something broke" },
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await act(async () => {});
    expect(row("Gym").dataset.state).toBe("open");
    expect(screen.getByRole("status").textContent).toBe(
      "Not saved. Something broke",
    );
  });

  it("changes nothing while offline", async () => {
    await showList(todo({ title: "Gym" }));
    api.offline = true;
    act(() => native.setShown?.(false));
    act(() => native.setShown?.(true));
    await act(async () => {});
    const check = screen.getByRole("button", { name: "Mark done" });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    key("ArrowDown");
    key("Delete");
    expect(patches()).toEqual([]);
    expect(screen.getByText(/changes are off until/)).toBeTruthy();
  });
});

describe("the composer", () => {
  // Sat 17 Oct 2026, 14:30 in Rome, as in "the list".
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-17T12:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const title = () =>
    screen.getByRole("combobox", { name: "New To-do" }) as HTMLInputElement;
  const composerShown = () =>
    screen.queryByRole("dialog", { name: "Add a To-do" }) !== null;
  const type = (value: string) =>
    fireEvent.change(title(), { target: { value } });
  /** A key where the focus is, as the keyboard would send it. */
  const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key,
      ...init,
    });
  const posts = () =>
    native.sendApi.mock.calls
      .filter(([method]) => method === "POST")
      .map(([, path, body]) => [path, body]);
  const fieldText = (name: string) =>
    document.querySelector(`[data-field="${name}"]`)?.textContent;
  const row = (text: string) =>
    screen.getByText(text).closest("[data-todo]") as HTMLElement;

  async function showList(...todos: ReturnType<typeof todo>[]) {
    api.todos = todos;
    await renderApp(configured);
    if (todos[0]) await screen.findByText(todos[0].title);
  }

  it("opens on typing with no input focused, the first character in the title", async () => {
    await showList(todo({ title: "Gym", day: "2026-10-17" }));
    expect(composerShown()).toBe(false);
    const taken = !fireEvent.keyDown(document.body, { key: "C" });
    expect(taken).toBe(true);
    expect(composerShown()).toBe(true);
    expect(title().value).toBe("C");
    expect(document.activeElement).toBe(title());
    expect(title().placeholder).toBe("New To-do… @KEY");
    expect(fieldText("Day")).toBe("Today");
    expect(fieldText("Reminder")).toBe("Reminder");
    expect(screen.getByText("↵ add")).toBeTruthy();
  });

  it("makes the list inert while open, so Tab can't reach a row and Enter can't open one", async () => {
    await showList(todo({ title: "Gym", day: "2026-10-17" }));
    const list = row("Gym").closest("main") as HTMLElement;
    expect(list.hasAttribute("inert")).toBe(false);
    fireEvent.keyDown(document.body, { key: "C" });
    expect(list.hasAttribute("inert")).toBe(true);
    press("Escape");
    expect(composerShown()).toBe(false);
    expect(list.hasAttribute("inert")).toBe(false);
  });

  it("doesn't open on shortcuts or named keys", async () => {
    await showList(todo({ title: "Gym" }));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(composerShown()).toBe(false);
  });

  it("opens and closes from the +, orange while open, and closes on a click on the dimmed list", async () => {
    await showList(todo({ title: "Gym" }));
    const plus = screen.getByRole("button", { name: "Add a To-do" });
    fireEvent.click(plus);
    expect(composerShown()).toBe(true);
    expect(title().value).toBe("");
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    expect(plus.className).toContain("text-primary");
    fireEvent.click(plus);
    expect(composerShown()).toBe(false);

    fireEvent.click(plus);
    fireEvent.click(document.querySelector("[data-scrim]") as HTMLElement);
    expect(composerShown()).toBe(false);
  });

  it("keeps the list's keys off while open: ↑ ↓, Space and Del act on the title, not the rows", async () => {
    await showList(todo({ title: "Gym" }), todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(row("Gym").dataset.selected).toBe("true");
    fireEvent.keyDown(document.body, { key: "g" });
    // Opening clears the selection, and the list no longer moves it.
    expect(row("Gym").dataset.selected).toBeUndefined();
    for (const key of ["ArrowDown", "ArrowUp", " ", "Delete"]) press(key);
    await act(async () => {});
    expect(row("Gym").dataset.selected).toBeUndefined();
    expect(row("Shop").dataset.selected).toBeUndefined();
    expect(
      native.sendApi.mock.calls.filter(([method]) => method === "PATCH"),
    ).toHaveLength(0);
    expect(composerShown()).toBe(true);
  });

  it("adds Call Marco @CRM tomorrow 15:00 with the @ list, and stays open for the next one", async () => {
    api.projects = [
      { id: "pr_core", key: "CORE", name: "Core", status: "paused" },
      { id: "pr_crm", key: "CRM", name: "CRM rollout", status: "active" },
      { id: "pr_cx", key: "CX", name: "Old CX", status: "completed" },
    ];
    await showList(todo({ title: "Gym", day: "2026-10-17" }));
    fireEvent.keyDown(document.body, { key: "C" });
    type("Call Marco @c");

    const list = screen.getByRole("listbox", { name: "Projects" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "CORECorepaused",
      "CRMCRM rollout",
    ]);
    expect(title().getAttribute("aria-expanded")).toBe("true");
    expect(title().getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    press("ArrowDown");
    expect(title().getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    press("Enter");
    expect(title().value).toBe("Call Marco @CRM ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(posts()).toEqual([]);

    type("Call Marco @CRM tomorrow 15:00");
    expect(fieldText("Day")).toBe("Tomorrowtyped");
    expect(fieldText("Reminder")).toBe("15:00typed");
    press("Enter");
    await act(async () => {});

    expect(posts()).toEqual([
      [
        "/v1/todos",
        { title: "Call Marco @CRM", day: "2026-10-18", time: "15:00" },
      ],
    ]);
    expect(composerShown()).toBe(true);
    expect(title().value).toBe("");
    expect(document.activeElement).toBe(title());
    expect(screen.getByRole("status").textContent).toBe(
      "Added to Tomorrow · Reminder 15:00",
    );
    const tomorrow = screen.getByRole("region", { name: "Tomorrow" });
    expect(tomorrow.textContent).toContain("Call Marco");
    expect(within(tomorrow).getByTitle("CRM rollout").textContent).toBe("CRM");
    expect(
      tomorrow.querySelector('[data-reminder="pending"]')?.textContent,
    ).toBe("15:00");
  });

  it("refuses a time already passed today, and creates nothing", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    type("Gym 09:00");
    expect(screen.getByRole("alert").textContent).toBe(
      "That time has already passed.",
    );
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([]);
    expect(title().value).toBe("Gym 09:00");
  });

  it("refuses anytime with a time, and creates nothing", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "C" });
    type("Call anytime 15:00");
    expect(screen.getByRole("alert").textContent).toBe(
      "A Reminder needs a Planned day: remove anytime or the time.",
    );
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([]);
  });

  it("posts today by default, and no day for Anytime", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    type("Gym");
    press("Enter");
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe("Added to Today");
    type("Read a book anytime");
    expect(fieldText("Day")).toBe("Anytimetyped");
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([
      ["/v1/todos", { title: "Gym", day: "2026-10-17" }],
      ["/v1/todos", { title: "Read a book" }],
    ]);
    expect(screen.getByRole("status").textContent).toBe("Added to Anytime");
  });

  it("shows the API's 400 in red under the fields and keeps the text", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    type("Gym 14:31");
    const refusal =
      "time must be in the future (2026-10-17 14:31 in Europe/Rome has passed)";
    native.sendApi.mockResolvedValueOnce({
      kind: "response",
      status: 400,
      body: JSON.stringify({
        error: { code: "validation_error", message: refusal },
      }),
    });
    press("Enter");
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe(refusal);
    expect(title().value).toBe("Gym 14:31");
    expect(screen.queryByRole("status")).toBeNull();
    // Editing clears it.
    type("Gym 18:00");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes on Esc, and a second Esc hides the window", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    press("Escape");
    expect(composerShown()).toBe(false);
    expect(native.hideWindow).not.toHaveBeenCalled();
    press("Escape");
    expect(native.hideWindow).toHaveBeenCalledTimes(1);
  });

  it("closes the @ list first on Esc, then the composer", async () => {
    api.projects = [
      { id: "pr_crm", key: "CRM", name: "CRM rollout", status: "active" },
    ];
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "@" });
    expect(screen.getByRole("listbox", { name: "Projects" })).toBeTruthy();
    press("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(composerShown()).toBe(true);
    press("Escape");
    expect(composerShown()).toBe(false);
    expect(native.hideWindow).not.toHaveBeenCalled();
  });

  it("opens empty again after the window hides", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    act(() => native.setShown?.(false));
    expect(composerShown()).toBe(false);
    act(() => native.setShown?.(true));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Add a To-do" }));
    expect(title().value).toBe("");
  });

  it("doesn't open while offline, and is disabled if Traccia goes offline while it is open", async () => {
    await showList(todo({ title: "Shop" }));
    fireEvent.keyDown(document.body, { key: "G" });
    type("Gym");
    api.offline = true;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(title().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "Offline: changes are off until Traccia is reachable.",
    );
    press("Enter");
    expect(posts()).toEqual([]);

    press("Escape");
    expect(composerShown()).toBe(false);
    fireEvent.keyDown(document.body, { key: "G" });
    expect(composerShown()).toBe(false);
    // The toast, next to the offline line under the title bar.
    expect(
      screen
        .getAllByRole("status")
        .map((s) => s.textContent)
        .at(-1),
    ).toBe("Offline: changes are off until Traccia is reachable.");
  });
});

describe("the Day and Reminder pickers", () => {
  // Sat 17 Oct 2026, 14:32 in Rome (CEST).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-17T12:32:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const title = () =>
    screen.getByRole("combobox", { name: "New To-do" }) as HTMLInputElement;
  const composerShown = () =>
    screen.queryByRole("dialog", { name: "Add a To-do" }) !== null;
  const type = (value: string) =>
    fireEvent.change(title(), { target: { value } });
  const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key,
      ...init,
    });
  const posts = () =>
    native.sendApi.mock.calls
      .filter(([method]) => method === "POST")
      .map(([, path, body]) => [path, body]);
  const fieldButton = (name: string) =>
    document.querySelector(`[data-field="${name}"]`) as HTMLButtonElement;
  const fieldText = (name: string) => fieldButton(name).textContent;
  /** Tab from the title reaches the fields; Enter or Space on one is the button's own click. */
  const openField = (name: string) => {
    const dialog = screen.getByRole("dialog", { name: "Add a To-do" });
    const tabbable = [
      ...dialog.querySelectorAll<HTMLElement>("input, button"),
    ].filter((el) => el.tabIndex >= 0);
    expect(tabbable.slice(0, 3)).toEqual([
      title(),
      fieldButton("Day"),
      fieldButton("Reminder"),
    ]);
    fieldButton(name).focus();
    fireEvent.click(fieldButton(name));
  };
  const focusedLabel = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");
  const timeField = () =>
    screen.getByRole("combobox", { name: "Reminder time" }) as HTMLInputElement;
  const activeOption = () =>
    document.getElementById(
      timeField().getAttribute("aria-activedescendant") ?? "",
    );

  async function openComposer(text: string) {
    api.todos = [todo({ title: "Shop" })];
    await renderApp(configured);
    await screen.findByText("Shop");
    fireEvent.keyDown(document.body, { key: text[0] as string });
    type(text);
  }

  it("Pay rent fri, then Tue in next month's grid with the keyboard only: sends that day, the title just Pay rent", async () => {
    await openComposer("Pay rent fri");
    expect(fieldText("Day")).toBe("Fri 23 Octtyped");
    openField("Day");
    expect(fieldButton("Day").getAttribute("aria-expanded")).toBe("true");
    const picker = screen.getByRole("group", { name: "Day" });
    expect(within(picker).getByText("October 2026")).toBeTruthy();
    // The highlighted day starts on the typed one, and has the focus.
    expect(focusedLabel()).toBe("Fri 23 Oct");
    press("PageDown");
    expect(within(picker).getByText("November 2026")).toBeTruthy();
    expect(focusedLabel()).toBe("Mon 23 Nov");
    press("ArrowRight");
    expect(focusedLabel()).toBe("Tue 24 Nov");
    press("Enter");

    expect(screen.queryByRole("group", { name: "Day" })).toBeNull();
    expect(title().value).toBe("Pay rent");
    expect(fieldText("Day")).toBe("Tue 24 Nov");
    expect(document.activeElement).toBe(title());
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([
      ["/v1/todos", { title: "Pay rent", day: "2026-11-24" }],
    ]);
    expect(screen.getByRole("status").textContent).toBe("Added to Tue 24 Nov");
    // Empty for the next one, the pick gone too.
    expect(fieldText("Day")).toBe("Today");
  });

  it("shows the month with past days disabled, today marked, and no paging before it", async () => {
    await openComposer("Gym");
    openField("Day");
    const picker = screen.getByRole("group", { name: "Day" });
    const button = (name: string) =>
      within(picker).getByRole("button", { name }) as HTMLButtonElement;
    expect(button("Fri 16 Oct").disabled).toBe(true);
    expect(button("Sat 17 Oct").getAttribute("aria-current")).toBe("date");
    expect(button("Sat 17 Oct").getAttribute("aria-pressed")).toBe("true");
    expect(button("Previous month").disabled).toBe(true);
    press("PageUp");
    expect(within(picker).getByText("October 2026")).toBeTruthy();
    press("ArrowLeft");
    expect(focusedLabel()).toBe("Sat 17 Oct");
    fireEvent.click(button("Next month"));
    expect(within(picker).getByText("November 2026")).toBeTruthy();
    press("Home");
    expect(within(picker).getByText("October 2026")).toBeTruthy();
    expect(focusedLabel()).toBe("Sat 17 Oct");
    expect(
      ["Today", "Tomorrow", "Next Mon", "Anytime"].map(
        (name) => button(name).getAttribute("aria-pressed") === "true",
      ),
    ).toEqual([true, false, false, false]);
    fireEvent.click(button("Next Mon"));
    expect(fieldText("Day")).toBe("Mon 19 Oct");
    expect(document.activeElement).toBe(title());
  });

  it("at 14:32, typing 9 in the Reminder field and pressing Enter sets 21:00", async () => {
    await openComposer("Call Marco");
    openField("Reminder");
    expect(document.activeElement).toBe(timeField());
    fireEvent.change(timeField(), { target: { value: "9" } });
    expect(activeOption()?.textContent).toBe("21:00in 6 h 28 min");
    press("Enter");
    expect(screen.queryByRole("group", { name: "Reminder" })).toBeNull();
    expect(fieldText("Reminder")).toBe("21:00");
    expect(document.activeElement).toBe(title());
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([
      ["/v1/todos", { title: "Call Marco", day: "2026-10-17", time: "21:00" }],
    ]);
  });

  it("offers today's chips and only the times still ahead, ↑ ↓ skipping past ones", async () => {
    await openComposer("Gym");
    openField("Reminder");
    const picker = screen.getByRole("group", { name: "Reminder" });
    expect(
      within(picker)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "in 30 min 15:02",
      "in 1 h 15:32",
      "in 2 h 16:32",
      "Tonight 21:00",
    ]);
    const options = within(picker).getAllByRole("option");
    expect(options[0]?.textContent).toBe("14:45in 13 min");
    expect(activeOption()).toBe(options[0]);

    fireEvent.change(timeField(), { target: { value: "14" } });
    // 14:00, 14:15 and 14:30 have passed: nothing is highlighted, so Enter picks nothing.
    expect(screen.getByText("That time has already passed.")).toBeTruthy();
    expect(activeOption()).toBeNull();
    press("Enter");
    expect(fieldText("Reminder")).toBe("Reminder");
    press("ArrowDown");
    expect(activeOption()?.textContent).toBe("14:45in 13 min");
    press("ArrowUp");
    expect(activeOption()?.textContent).toBe("14:45in 13 min");
    press("Enter");
    expect(fieldText("Reminder")).toBe("14:45");
  });

  it("offers Morning to Evening on other days, the list from 09:00, and Remove Reminder once set", async () => {
    await openComposer("Gym tomorrow");
    openField("Reminder");
    const picker = screen.getByRole("group", { name: "Reminder" });
    expect(
      within(picker)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Morning 09:00",
      "Lunch 12:30",
      "Afternoon 15:00",
      "Evening 18:00",
    ]);
    expect(within(picker).getAllByRole("option")).toHaveLength(96);
    expect(activeOption()?.textContent).toBe("09:00");
    expect(
      screen.queryByRole("button", { name: "Remove Reminder" }),
    ).toBeNull();
    fireEvent.change(timeField(), { target: { value: "2:15p" } });
    press("Enter");
    expect(fieldText("Reminder")).toBe("14:15");

    openField("Reminder");
    fireEvent.click(screen.getByRole("button", { name: "Remove Reminder" }));
    expect(fieldText("Reminder")).toBe("Reminder");
    expect(fieldText("Day")).toBe("Tomorrowtyped");
  });

  it("picking Anytime after setting 18:00 clears the Reminder", async () => {
    await openComposer("Call Marco");
    openField("Reminder");
    fireEvent.change(timeField(), { target: { value: "18:00" } });
    press("Enter");
    expect(fieldText("Reminder")).toBe("18:00");
    openField("Day");
    expect(screen.getByText(/Anytime removes the Reminder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anytime" }));
    expect(fieldText("Day")).toBe("Anytime");
    expect(fieldText("Reminder")).toBe("Reminder");
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([["/v1/todos", { title: "Call Marco" }]]);
  });

  it("a time on Anytime moves the day to Today, and picking takes the typed words out", async () => {
    await openComposer("Read anytime");
    expect(fieldText("Day")).toBe("Anytimetyped");
    openField("Reminder");
    expect(screen.getByText(/a time moves it to Today/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tonight 21:00" }));
    expect(title().value).toBe("Read");
    expect(fieldText("Day")).toBe("Today");
    expect(fieldText("Reminder")).toBe("21:00");

    type("Read 19:00");
    expect(fieldText("Reminder")).toBe("19:00typed");
    openField("Reminder");
    fireEvent.click(screen.getByRole("button", { name: "in 1 h 15:32" }));
    expect(title().value).toBe("Read");
    expect(fieldText("Reminder")).toBe("15:32");
  });

  it("closes the picker on Esc before the composer, then the composer, then the window", async () => {
    await openComposer("Gym");
    openField("Day");
    press("Escape");
    expect(screen.queryByRole("group", { name: "Day" })).toBeNull();
    expect(composerShown()).toBe(true);
    expect(document.activeElement).toBe(title());
    openField("Reminder");
    press("Escape");
    expect(screen.queryByRole("group", { name: "Reminder" })).toBeNull();
    expect(composerShown()).toBe(true);
    press("Escape");
    expect(composerShown()).toBe(false);
    expect(native.hideWindow).not.toHaveBeenCalled();
    press("Escape");
    expect(native.hideWindow).toHaveBeenCalledTimes(1);
  });

  it("keeps the @ list closed after a pick, so Enter adds even with the caret after an @KEY", async () => {
    api.projects = [
      { id: "pr_crm", key: "CRM", name: "CRM rollout", status: "active" },
    ];
    await openComposer("Call @CRM 18:00");
    openField("Reminder");
    fireEvent.click(screen.getByRole("button", { name: "Tonight 21:00" }));
    expect(title().value).toBe("Call @CRM");
    expect(document.activeElement).toBe(title());
    fireEvent.select(title());
    expect(screen.queryByRole("listbox", { name: "Projects" })).toBeNull();
    press("Enter");
    await act(async () => {});
    expect(posts()).toEqual([
      ["/v1/todos", { title: "Call @CRM", day: "2026-10-17", time: "21:00" }],
    ]);
    // Typing opens it again.
    type("Call @C");
    expect(screen.getByRole("listbox", { name: "Projects" })).toBeTruthy();
  });

  it("closes the picker when its field is pressed again", async () => {
    await openComposer("Gym");
    openField("Day");
    fireEvent.click(fieldButton("Day"));
    expect(screen.queryByRole("group", { name: "Day" })).toBeNull();
    expect(document.activeElement).toBe(title());
  });
});

describe("focus reset on show", () => {
  it("gives Space back to the list after a show, even with the + focused from an earlier click", async () => {
    api.todos = [todo({ title: "Gym" })];
    await renderApp(configured);
    await screen.findByText("Gym");
    const plus = screen.getByRole("button", { name: "Add a To-do" });
    fireEvent.click(plus);
    fireEvent.click(plus);
    // A click leaves the focus on the +.
    plus.focus();
    act(() => native.setShown?.(false));
    act(() => native.setShown?.(true));
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);

    const key = (key: string) =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key });
    key("ArrowDown");
    key(" ");
    await act(async () => {});
    expect(
      native.sendApi.mock.calls.filter(([method]) => method === "PATCH"),
    ).toHaveLength(1);
  });
});
