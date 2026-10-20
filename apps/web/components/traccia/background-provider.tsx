"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_BACKGROUND, prepareBackgroundImage, type BackgroundPreferences } from "@/lib/background";
import { readBackground, writeBackground } from "@/lib/background-storage";

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
  const requested = useRef(DEFAULT_BACKGROUND);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const started = ++generation.current;
      try {
        const saved = await readBackground();
        if (cancelled || started !== generation.current) return;
        current.current = saved;
        requested.current = saved;
        setBackground(saved);
      } catch {
        if (!cancelled && started === generation.current) setError("Could not access browser storage. Background images need browser storage to be available.");
      } finally {
        if (!cancelled && started === generation.current) setReady(true);
      }
    };
    void load();
    if (typeof BroadcastChannel !== "undefined") {
      const updates = new BroadcastChannel("traccia-background");
      channel.current = updates;
      updates.onmessage = () => {
        void writes.current.then(load);
      };
    }
    return () => {
      cancelled = true;
      channel.current?.close();
      channel.current = null;
    };
  }, []);

  const save = useCallback((next: BackgroundPreferences, replaceImage = false) => {
    generation.current += 1;
    requested.current = next;
    // Small display changes respond immediately; failed writes restore the last committed preferences.
    if (!replaceImage) setBackground(next);
    const job = writes.current.then(async () => {
      try {
        await writeBackground(next, replaceImage);
        current.current = next;
        if (requested.current === next) setBackground(next);
        setError(null);
        channel.current?.postMessage("updated");
      } catch {
        if (requested.current === next) {
          requested.current = current.current;
          setBackground(current.current);
        }
        setError("Could not save the background in this browser. Free up browser storage or try a smaller image.");
      }
    });
    writes.current = job;
    return job;
  }, []);

  const update = useCallback(
    (changes: Parameters<BackgroundContextValue["update"]>[0]) => {
      void save({ ...requested.current, ...changes });
    },
    [save],
  );
  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const image = await prepareBackgroundImage(file);
        await save({ ...requested.current, image, enabled: true }, true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not upload this image. Try another image.");
      } finally {
        setUploading(false);
      }
    },
    [save],
  );
  const reset = useCallback(() => {
    void save({ ...DEFAULT_BACKGROUND, image: requested.current.image });
  }, [save]);
  const value = useMemo(() => ({ background, ready, uploading, error, update, upload, reset }), [background, ready, uploading, error, update, upload, reset]);
  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}
