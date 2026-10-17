import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hideWindow = vi.fn(() => Promise.resolve());
vi.mock("../src/native", () => ({ hideWindow: () => hideWindow() }));

const { App } = await import("../src/app");

describe("the window", () => {
  beforeEach(() => hideWindow.mockClear());

  it("shows the variant G title bar: Personal and a +", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a To-do" })).toBeTruthy();
  });

  it("hides on Esc", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hideWindow).toHaveBeenCalledTimes(1);
  });

  it("stays shown on other keys", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<App />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hideWindow).not.toHaveBeenCalled();
  });
});
