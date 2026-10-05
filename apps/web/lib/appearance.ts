/**
 * Accent color and UI font (TRC-57). Two cookies, not localStorage, so the server render already carries the choice
 * (same approach as the sidebar, TRC-98). Pure: the contrast math and the cookie format are unit-tested.
 */
export const ACCENT_COOKIE = "traccia_accent";
export const FONT_COOKIE = "traccia_font";
const MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_ACCENT = "#ff9e0b";
/** The three choices; `mono` is the brand default (Geist Mono). */
export const FONTS = [
  { value: "mono", label: "Geist Mono", hint: "Brand default" },
  { value: "sans", label: "Geist Sans", hint: "Clean and neutral" },
  { value: "system", label: "System", hint: "Your device's UI font" },
] as const;
export type FontChoice = (typeof FONTS)[number]["value"];
export const DEFAULT_FONT: FontChoice = "mono";

export const ACCENTS = [
  { name: "Amber", hex: "#ff9e0b" },
  { name: "Orange", hex: "#f97316" },
  { name: "Red", hex: "#e5484d" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Graphite", hex: "#71717a" },
] as const;

/** Theme backgrounds from globals.css, used to judge contrast. Keep in sync with `--background`. */
export const LIGHT_BACKGROUND = "#ffffff";
export const DARK_BACKGROUND = "#0f1012";
/** Minimum contrast of the accent against the page background. The default amber on white is 2.07, so this must stay at or below 2. */
export const MIN_ACCENT_CONTRAST = 2;

/** `#abc`, `abc`, `#AABBCC` or `aabbcc` becomes `#aabbcc`; anything else is null. */
export function normalizeHex(input: string | undefined | null): string | null {
  const raw = (input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map((c) => c + c).join("").toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` toward `target` by `amount` (0 to 1). */
function mix(hex: string, target: string, amount: number): string {
  const from = toRgb(hex);
  const to = toRgb(target);
  return toHex(from.map((c, i) => c + (to[i]! - c) * amount) as Rgb);
}

/** Brand dark text if it reads (4.5:1), else white, else pure black: some mid-tones fit neither softer pair. */
export function foregroundFor(hex: string): string {
  for (const fg of ["#1a1203", "#ffffff"]) if (contrast(hex, fg) >= 4.5) return fg;
  return contrast(hex, "#000000") >= contrast(hex, "#ffffff") ? "#000000" : "#ffffff";
}

/**
 * Pulls a too-faint accent away from the background (darker on light, lighter on dark) until it reaches
 * `MIN_ACCENT_CONTRAST`. `adjusted` tells the settings page to warn.
 */
export function clampAccent(hex: string, background: string): { hex: string; adjusted: boolean } {
  if (contrast(hex, background) >= MIN_ACCENT_CONTRAST) return { hex, adjusted: false };
  const target = luminance(background) > 0.5 ? "#000000" : "#ffffff";
  for (let amount = 0.05; amount < 1; amount += 0.05) {
    const candidate = mix(hex, target, amount);
    if (contrast(candidate, background) >= MIN_ACCENT_CONTRAST) return { hex: candidate, adjusted: true };
  }
  return { hex: target, adjusted: true };
}

export type ThemeAccent = { brand: string; foreground: string; ring: string; adjusted: boolean };

/** The three variables the tokens derive everything from, for one theme. Light's ring is a notch darker, like the default. */
export function accentFor(hex: string, theme: "light" | "dark"): ThemeAccent {
  const { hex: brand, adjusted } = clampAccent(hex, theme === "light" ? LIGHT_BACKGROUND : DARK_BACKGROUND);
  return { brand, foreground: foregroundFor(brand), ring: theme === "light" ? mix(brand, "#000000", 0.15) : brand, adjusted };
}

/** CSS overriding the accent tokens in both themes. Rendered after globals.css so it wins at equal specificity. */
export function accentCss(hex: string): string {
  const block = (selector: string, t: ThemeAccent) =>
    `${selector}{--brand:${t.brand};--brand-foreground:${t.foreground};--brand-ring:${t.ring}}`;
  return block(":root", accentFor(hex, "light")) + block(".dark", accentFor(hex, "dark"));
}

/** A missing, malformed or unknown cookie value falls back to the default. */
export function parseAccentCookie(value: string | undefined): string {
  return normalizeHex(value) ?? DEFAULT_ACCENT;
}

export function parseFontCookie(value: string | undefined): FontChoice {
  return FONTS.find((f) => f.value === value)?.value ?? DEFAULT_FONT;
}

// The value has no `#` (it would need escaping in a cookie).
export function accentCookie(hex: string): string {
  return `${ACCENT_COOKIE}=${hex.replace("#", "")}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

export function fontCookie(font: FontChoice): string {
  return `${FONT_COOKIE}=${font}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
