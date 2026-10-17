import { describe, expect, it } from "vitest";
import { followSystemTheme } from "../src/theme";

/** A stand-in for `matchMedia("(prefers-color-scheme: dark)")` whose answer the test flips. */
function fakeMedia(matches: boolean) {
  const target = new EventTarget();
  const media = {
    matches,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as MediaQueryList;
  const flip = (dark: boolean) => {
    (media as { matches: boolean }).matches = dark;
    target.dispatchEvent(new Event("change"));
  };
  return { media, flip };
}

describe("followSystemTheme", () => {
  it("starts in the Windows theme", () => {
    const root = document.createElement("html");
    followSystemTheme(root, fakeMedia(true).media);
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("switches live when Windows switches, both ways", () => {
    const root = document.createElement("html");
    const { media, flip } = fakeMedia(false);
    followSystemTheme(root, media);
    expect(root.classList.contains("dark")).toBe(false);
    flip(true);
    expect(root.classList.contains("dark")).toBe(true);
    flip(false);
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("stops following once stopped", () => {
    const root = document.createElement("html");
    const { media, flip } = fakeMedia(false);
    followSystemTheme(root, media)();
    flip(true);
    expect(root.classList.contains("dark")).toBe(false);
  });
});
