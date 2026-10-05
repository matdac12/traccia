// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/traccia/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/issues", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../components/create-issue/provider", () => ({ useCreateIssue: () => ({ open: vi.fn() }) }));
vi.mock("../components/project/new-project-button", () => ({ NewProjectButton: () => null }));
vi.mock("../components/traccia/theme-toggle", () => ({ ThemeToggle: () => null }));

describe("AppShell on narrow screens", () => {
  it("opens the sidebar navigation in a drawer from the menu button", async () => {
    render(<AppShell projects={[{ id: "p1", name: "Alpha" }]} login="me@x">content</AppShell>);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("link", { name: "Issues" })).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "Trash" })).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "Alpha" })).toBeTruthy();
  });
});
