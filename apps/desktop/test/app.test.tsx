import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiOutcome } from "../src/api-client";
import type { SavedSettings, SettingsForm } from "../src/settings";

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

beforeEach(() => {
  vi.clearAllMocks();
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
