// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
vi.mock("../app/(app)/projects/[id]/actions", () => ({ updateProjectDescriptionAction: (...a: unknown[]) => update(...a) }));
const { ProjectDescription, COLLAPSED_HEIGHT, overflowsCollapsed } = await import("../components/project/project-description");

/** jsdom has no layout: report a fixed height for every element's `offsetHeight`. */
function contentHeight(px: number) {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => px });
}
beforeEach(() => update.mockReset());
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  vi.unstubAllGlobals();
});

describe("overflowsCollapsed", () => {
  it("only collapses text that is clearly taller than the collapsed height", () => {
    expect(overflowsCollapsed(COLLAPSED_HEIGHT)).toBe(false);
    expect(overflowsCollapsed(COLLAPSED_HEIGHT + 10)).toBe(false);
    expect(overflowsCollapsed(COLLAPSED_HEIGHT + 200)).toBe(true);
  });
});

describe("collapsible description", () => {
  it("shows a short description whole, with no toggle and no fade", () => {
    contentHeight(40);
    render(<ProjectDescription projectId="p1" description="Short **text**" updatedAt="T1" />);
    expect(screen.getByText("text").tagName).toBe("STRONG");
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    expect(screen.queryByTestId("description-fade")).toBeNull();
  });

  it("collapses a long one behind a fade and toggles with aria-expanded", async () => {
    contentHeight(400);
    const user = userEvent.setup();
    render(<ProjectDescription projectId="p1" description={"line\n\n".repeat(30)} updatedAt="T1" />);
    const toggle = await screen.findByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("description-fade")).toBeInTheDocument();
    const body = document.getElementById(toggle.getAttribute("aria-controls") as string) as HTMLElement;
    expect(body.style.maxHeight).toBe(`${COLLAPSED_HEIGHT}px`);

    await user.click(toggle);
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(body.style.maxHeight).toBe("");
    expect(screen.queryByTestId("description-fade")).toBeNull();

    await user.click(less);
    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute("aria-expanded", "false");
  });

  it("is operable from the keyboard", async () => {
    contentHeight(400);
    const user = userEvent.setup();
    render(<ProjectDescription projectId="p1" description="long text" updatedAt="T1" />);
    const toggle = await screen.findByRole("button", { name: "Show more" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("re-measures when the text grows (ResizeObserver), e.g. after an image loads", async () => {
    contentHeight(40);
    let notify: () => void = () => {};
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { notify = cb; } observe() {} unobserve() {} disconnect() {} });
    render(<ProjectDescription projectId="p1" description="text" updatedAt="T1" />);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    contentHeight(500);
    notify();
    expect(await screen.findByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("renders through the sanitised markdown: raw HTML and foreign images never reach the page", () => {
    contentHeight(40);
    const { container } = render(<ProjectDescription projectId="p1" description={'<script>alert(1)</script>\n\n![x](https://evil.example/a.png)\n\n[l](javascript:alert(1))'} updatedAt="T1" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("still edits in place: Edit swaps in the textarea, Save sends the draft with updatedAt", async () => {
    contentHeight(400);
    update.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ProjectDescription projectId="p1" description="old" updatedAt="T1" />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const box = screen.getByRole("textbox", { name: "Description" });
    await user.clear(box);
    await user.type(box, "new");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("p1", "new", "T1"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("offers Edit on an empty description", () => {
    render(<ProjectDescription projectId="p1" description="  " updatedAt="T1" />);
    expect(screen.getByText(/No description/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });
});
