"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { accentCookie, accentCss, DEFAULT_ACCENT, DEFAULT_FONT, type FontChoice, fontCookie } from "@/lib/appearance";

type Appearance = {
  accent: string;
  font: FontChoice;
  setAccent: (hex: string) => void;
  setFont: (font: FontChoice) => void;
  reset: () => void;
};

const AppearanceContext = createContext<Appearance | null>(null);

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}

/**
 * Holds the accent and font read from the cookies on the server (so the first paint is right) and applies
 * changes live: the accent through a `<style>` overriding the three brand tokens, the font through `data-font` on `<html>`.
 */
export function AppearanceProvider({ initialAccent, initialFont, children }: { initialAccent: string; initialFont: FontChoice; children: ReactNode }) {
  const [accent, setAccentState] = useState(initialAccent);
  const [font, setFontState] = useState(initialFont);

  useEffect(() => {
    document.documentElement.dataset.font = font;
  }, [font]);

  const setAccent = useCallback((hex: string) => {
    document.cookie = accentCookie(hex);
    setAccentState(hex);
  }, []);
  const setFont = useCallback((next: FontChoice) => {
    document.cookie = fontCookie(next);
    setFontState(next);
  }, []);
  const reset = useCallback(() => {
    setAccent(DEFAULT_ACCENT);
    setFont(DEFAULT_FONT);
  }, [setAccent, setFont]);

  const value = useMemo(() => ({ accent, font, setAccent, setFont, reset }), [accent, font, setAccent, setFont, reset]);
  return (
    <AppearanceContext.Provider value={value}>
      <style id="traccia-accent">{accentCss(accent)}</style>
      {children}
    </AppearanceContext.Provider>
  );
}
