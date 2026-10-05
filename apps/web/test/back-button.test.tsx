// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackButton } from "../components/issue-detail/back-button";
import { recordLocation, resetInAppHistory } from "../lib/in-app-history";
import { TooltipProvider } from "../components/ui/tooltip";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));

/** jsdom has no Navigation API; the real one reports whether this tab has an earlier same-app entry. */
const navigationApi = (canGoBack: boolean) => vi.stubGlobal("navigation", { canGoBack });

const renderButton = () => render(<TooltipProvider><BackButton fallbackHref="/projects/p1" /></TooltipProvider>);

/** Clicks the button and reports whether the browser's default action (following the link) was left intact. jsdom cannot navigate, so the click is cancelled after the check. */
function clickLeavingDefault(init: MouseEventInit) {
  let intact: boolean | undefined;
  const observe = (e: MouseEvent) => { intact = !e.defaultPrevented; e.preventDefault(); };
  document.addEventListener("click", observe);
  fireEvent.click(screen.getByRole("link", { name: "Back" }), init);
  document.removeEventListener("click", observe);
  return intact;
}

beforeEach(() => {
  back.mockReset();
  resetInAppHistory();
  // The tooltip opens on hover/focus and Radix measures its arrow; jsdom has no ResizeObserver.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("BackButton", () => {
  it("is a keyboard-reachable control named Back that links to the fallback", () => {
    navigationApi(false);
    renderButton();
    const control = screen.getByRole("link", { name: "Back" });
    expect(control.getAttribute("href")).toBe("/projects/p1");
  });

  it("returns through browser history when the tab has in-app history, keeping the previous view's URL state", async () => {
    navigationApi(true);
    renderButton();
    await userEvent.click(screen.getByRole("link", { name: "Back" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard", async () => {
    navigationApi(true);
    renderButton();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Back" })).toBe(document.activeElement);
    await userEvent.keyboard("{Enter}");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("falls through to the fallback link when there is no in-app history (deep link, new tab)", async () => {
    navigationApi(false);
    renderButton();
    expect(clickLeavingDefault({})).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  it("falls through to the fallback link when the Navigation API is unavailable", () => {
    renderButton();
    expect(clickLeavingDefault({})).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  describe("without the Navigation API (Firefox, Safari)", () => {
    it("returns through browser history once the user navigated inside the app", async () => {
      recordLocation("/projects/p1/issues?status=todo");
      recordLocation("/issues/TRC-1");
      renderButton();
      await userEvent.click(screen.getByRole("link", { name: "Back" }));
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("keeps the plain link on a deep link, a new tab or a reload (no in-app navigation yet)", () => {
      recordLocation("/issues/TRC-1");
      renderButton();
      expect(clickLeavingDefault({})).toBe(true);
      expect(back).not.toHaveBeenCalled();
    });

    it("does not count a repeated location as navigation", () => {
      recordLocation("/issues/TRC-1");
      recordLocation("/issues/TRC-1");
      renderButton();
      expect(clickLeavingDefault({})).toBe(true);
      expect(back).not.toHaveBeenCalled();
    });

    it("leaves modified clicks to the browser", () => {
      recordLocation("/a");
      recordLocation("/b");
      renderButton();
      expect(clickLeavingDefault({ metaKey: true })).toBe(true);
      expect(back).not.toHaveBeenCalled();
    });

    it("renders the same link before and after navigation (no hydration difference)", () => {
      const { container, unmount } = renderButton();
      const before = container.innerHTML;
      unmount();
      recordLocation("/a");
      recordLocation("/b");
      expect(renderButton().container.innerHTML).toBe(before);
    });
  });

  it("prefers the Navigation API over the in-app count when both exist", () => {
    recordLocation("/a");
    recordLocation("/b");
    navigationApi(false);
    renderButton();
    expect(clickLeavingDefault({})).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser (open in a new tab)", () => {
    navigationApi(true);
    renderButton();
    expect(clickLeavingDefault({ ctrlKey: true })).toBe(true);
    expect(back).not.toHaveBeenCalled();
  });
});
