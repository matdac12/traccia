import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
  api.todos = [];
  api.projects = [];
  api.offline = false;
  native.sendApi.mockImplementation(async (_method, path) => {
    if (api.offline) return { kind: "offline", reason: "could not connect" };
    const items = path.startsWith("/v1/projects") ? api.projects : api.todos;
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
