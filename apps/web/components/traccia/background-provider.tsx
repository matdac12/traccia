"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BACKGROUND_STORAGE_KEY, DEFAULT_BACKGROUND, parseBackground, prepareBackgroundImage, type BackgroundPreferences } from "@/lib/background";

type BackgroundContextValue = {
  background: BackgroundPreferences;
  ready: boolean;
  uploading: boolean;
  error: string | null;
  update: (changes: Partial<Pick<BackgroundPreferences, "enabled" | "effect" | "opacity">>) => void;
  upload: (file: File) => Promise<void>;
  reset: () => void;
};
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function useBackground() {
  return useContext(BackgroundContext);
}

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const current = useRef(DEFAULT_BACKGROUND);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      current.current = parseBackground(localStorage.getItem(BACKGROUND_STORAGE_KEY));
      setBackground(current.current);
    } catch {
      setError("Could not access browser storage. Background images need browser storage to be available.");
    }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key !== BACKGROUND_STORAGE_KEY && event.key !== null) return;
      current.current = parseBackground(event.newValue);
      setBackground(current.current);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const save = useCallback((next: BackgroundPreferences) => {
    try {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(next));
      current.current = next;
      setBackground(next);
      setError(null);
    } catch {
      setError("Could not save the background in this browser. Free up browser storage or try a smaller image.");
    }
  }, []);

  const update = useCallback((changes: Parameters<BackgroundContextValue["update"]>[0]) => {
    save(parseBackground(JSON.stringify({ ...current.current, ...changes })));
  }, [save]);
  const upload = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const image = await prepareBackgroundImage(file);
      save({ ...current.current, image, enabled: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this image. Try another image.");
    } finally {
      setUploading(false);
    }
  }, [save]);
  const reset = useCallback(() => save({ ...DEFAULT_BACKGROUND, image: current.current.image }), [save]);
  const value = useMemo(() => ({ background, ready, uploading, error, update, upload, reset }), [background, ready, uploading, error, update, upload, reset]);
  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}
