// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/traccia/app-shell";
import { parseSidebarCookie, SIDEBAR_COOKIE, sidebarCookie } from "../lib/sidebar-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../components/create-issue/provider", () => ({ useCreateIssue: () => ({ open: vi.fn() }) }));
vi.mock("../components/project/new-project-button", () => ({
  NewProjectButton: ({ children, ...rest }: { children: React.ReactNode }) => <button type="button" {...rest}>{children}</button>,
}));
vi.mock("../components/traccia/theme-toggle", () => ({ ThemeToggle: () => <button type="button" aria-label="Theme" /> }));

const projects = [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }];

/** jsdom has no matchMedia: `desktop` decides what `(min-width: 768px)` answers. */
function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const sidebar = () => document.querySelector("aside") as HTMLElement;
const cookieValue = () => document.cookie.split("; ").find((c) => c.startsWith(`${SIDEBAR_COOKIE}=`))?.split("=")[1];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  setViewport(true);
  document.cookie = `${SIDEBAR_COOKIE}=; path=/; max-age=0`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error restore the jsdom default (no matchMedia)
  delete window.matchMedia;
});

describe("sidebar cookie", () => {
  it("is expanded unless it says collapsed", () => {
    expect(parseSidebarCookie(undefined)).toBe(false);
    expect(parseSidebarCookie("expanded")).toBe(false);
    expect(parseSidebarCookie("garbage")).toBe(false);
    expect(parseSidebarCookie("collapsed")).toBe(true);
  });
  it("is a year-long, site-wide cookie", () => {
    expect(sidebarCookie(true)).toMatch(new RegExp(`^${SIDEBAR_COOKIE}=collapsed; path=/; max-age=31536000`));
    expect(sidebarCookie(false)).toMatch(new RegExp(`^${SIDEBAR_COOKIE}=expanded;`));
  });
});

describe("collapsible desktop sidebar", () => {
  it("starts expanded with a labelled collapse button", () => {
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    expect(sidebar().dataset.collapsed).toBe("false");
    expect(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses to an icon rail on click, keeps every control reachable by name, and expands again", async () => {
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar().dataset.collapsed).toBe("true");
    const rail = within(sidebar());
    // Accessible names survive the collapse (text is visually hidden, not removed).
    for (const name of ["Issues", "Trash", "Alpha", "Beta"]) expect(rail.getByRole("link", { name })).toBeTruthy();
    // jsdom does not apply the `hidden` class, so the shortcut hint stays in the computed name here; in a browser it is removed.
    expect(rail.getByRole("button", { name: /New issue/ })).toBeTruthy();
    expect(rail.getByRole("button", { name: "New project" })).toBeTruthy();
    expect(rail.getByRole("button", { name: "Theme" })).toBeTruthy();
    expect(rail.getByRole("link", { name: "Alpha" }).getAttribute("aria-current")).toBe("page");
    expect(rail.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(rail.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar().dataset.collapsed).toBe("false");
  });

  it("shows a tooltip on a rail icon when it gets keyboard focus", async () => {
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }));
    await act(async () => within(sidebar()).getByRole("link", { name: "Trash" }).focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("Trash");
  });

  it("persists the choice in the cookie", async () => {
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }));
    expect(cookieValue()).toBe("collapsed");
    await userEvent.click(within(sidebar()).getByRole("button", { name: "Expand sidebar" }));
    expect(cookieValue()).toBe("expanded");
  });

  it("renders collapsed on the first render when the server says so (no flash)", () => {
    render(<AppShell projects={projects} login="me@x" defaultCollapsed>content</AppShell>);
    expect(sidebar().dataset.collapsed).toBe("true");
    expect(sidebar().className).toContain("w-12");
  });

  it("toggles with Ctrl+B and Cmd+B, but not with plain B, Shift+B or inside a text field", async () => {
    render(<AppShell projects={projects} login="me@x"><input aria-label="Title" />content</AppShell>);
    await userEvent.keyboard("b");
    await userEvent.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
    expect(sidebar().dataset.collapsed).toBe("false");

    await userEvent.click(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(sidebar().dataset.collapsed).toBe("false");

    await userEvent.click(document.body);
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(sidebar().dataset.collapsed).toBe("true");
    await userEvent.keyboard("{Meta>}b{/Meta}");
    expect(sidebar().dataset.collapsed).toBe("false");
  });

  it("does not take over the C shortcut or Ctrl+C", async () => {
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    await userEvent.keyboard("c");
    await userEvent.keyboard("{Control>}c{/Control}");
    expect(sidebar().dataset.collapsed).toBe("false");
  });
});

describe("mobile drawer", () => {
  it("is always the full list, even when the desktop sidebar is collapsed, and has no collapse button", async () => {
    setViewport(false);
    render(<AppShell projects={projects} login="me@x" defaultCollapsed>content</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("link", { name: "Alpha" })).toBeTruthy();
    expect(within(drawer).getByText("New issue").classList.contains("sr-only")).toBe(false);
    expect(within(drawer).getByText("Projects")).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: /sidebar/i })).toBeNull();
  });

  it("ignores Ctrl+B under 768px", async () => {
    setViewport(false);
    render(<AppShell projects={projects} login="me@x">content</AppShell>);
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(sidebar().dataset.collapsed).toBe("false");
    expect(cookieValue()).toBeUndefined();
  });
});
