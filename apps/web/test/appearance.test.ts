import { describe, expect, it } from "vitest";
import {
  ACCENTS, accentCookie, accentCss, accentFor, clampAccent, contrast, DARK_BACKGROUND, DEFAULT_ACCENT, fontCookie,
  foregroundFor, LIGHT_BACKGROUND, MIN_ACCENT_CONTRAST, normalizeHex, parseAccentCookie, parseFontCookie,
} from "../lib/appearance";

describe("normalizeHex", () => {
  it("accepts 3 and 6 digits with or without #, in any case", () => {
    expect(normalizeHex("#F90")).toBe("#ff9900");
    expect(normalizeHex("ff9e0b")).toBe("#ff9e0b");
    expect(normalizeHex("  #FF9E0B ")).toBe("#ff9e0b");
  });
  it("rejects everything else", () => {
    for (const bad of ["", "#", "#ff", "#ffff", "#fffffff", "#ggg", "red", "rgb(1,2,3)", undefined, null]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("clampAccent", () => {
  it("leaves the default amber and every curated color alone in both themes", () => {
    for (const { hex } of ACCENTS) {
      expect(clampAccent(hex, LIGHT_BACKGROUND), hex).toEqual({ hex, adjusted: false });
      expect(clampAccent(hex, DARK_BACKGROUND), hex).toEqual({ hex, adjusted: false });
    }
  });
  it("darkens a near-white accent on the light theme until it is visible", () => {
    const { hex, adjusted } = clampAccent("#fafafa", LIGHT_BACKGROUND);
    expect(adjusted).toBe(true);
    expect(contrast(hex, LIGHT_BACKGROUND)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });
  it("lightens a near-black accent on the dark theme until it is visible", () => {
    const { hex, adjusted } = clampAccent("#101010", DARK_BACKGROUND);
    expect(adjusted).toBe(true);
    expect(contrast(hex, DARK_BACKGROUND)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });
  it("only adjusts the theme where the accent is faint", () => {
    expect(accentFor("#fafafa", "light").adjusted).toBe(true);
    expect(accentFor("#fafafa", "dark").adjusted).toBe(false);
  });
});

describe("accent tokens", () => {
  it("keeps the shipped amber values for the default", () => {
    expect(accentFor(DEFAULT_ACCENT, "dark")).toMatchObject({ brand: "#ff9e0b", foreground: "#1a1203", ring: "#ff9e0b" });
    expect(accentFor(DEFAULT_ACCENT, "light").brand).toBe("#ff9e0b");
  });
  it("picks readable text on the filled accent", () => {
    expect(foregroundFor("#ff9e0b")).toBe("#1a1203");
    expect(foregroundFor("#1e1b4b")).toBe("#ffffff");
    for (const { hex } of ACCENTS) expect(contrast(hex, foregroundFor(hex)), hex).toBeGreaterThanOrEqual(4.5);
  });
  it("only touches the three brand variables, in both themes", () => {
    const css = accentCss("#8b5cf6");
    expect(css).toContain(":root{--brand:#8b5cf6;");
    expect(css).toContain(".dark{--brand:#8b5cf6;");
    const names = [...css.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["--brand", "--brand-foreground", "--brand-ring"]));
  });
});

describe("cookies", () => {
  it("parses the accent, falling back to the default for anything invalid", () => {
    expect(parseAccentCookie("8b5cf6")).toBe("#8b5cf6");
    expect(parseAccentCookie("F90")).toBe("#ff9900");
    for (const bad of [undefined, "", "nope", "8b5cf", "</style>"]) expect(parseAccentCookie(bad)).toBe(DEFAULT_ACCENT);
  });
  it("parses the font, falling back to Geist Mono", () => {
    expect(parseFontCookie("sans")).toBe("sans");
    expect(parseFontCookie("system")).toBe("system");
    for (const bad of [undefined, "", "serif", "MONO"]) expect(parseFontCookie(bad)).toBe("mono");
  });
  it("writes one-year, lax, site-wide cookies without a # in the value", () => {
    expect(accentCookie("#8b5cf6")).toBe("traccia_accent=8b5cf6; path=/; max-age=31536000; samesite=lax");
    expect(fontCookie("system")).toBe("traccia_font=system; path=/; max-age=31536000; samesite=lax");
  });
});
