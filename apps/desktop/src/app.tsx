import { useEffect, useState } from "react";
import { hideWindow, loadSettings, onOpenSettings } from "./native";
import { FRESH_SETTINGS, type SavedSettings } from "./settings";
import { SettingsView } from "./settings-view";
import { TitleBar } from "./title-bar";

const isComplete = (saved: SavedSettings) =>
  saved.apiUrl !== null && saved.hasToken;

export function App() {
  const [saved, setSaved] = useState<SavedSettings | null>(null);
  const [view, setView] = useState<"list" | "settings">("list");

  useEffect(() => {
    let live = true;
    loadSettings()
      .catch(() => FRESH_SETTINGS)
      .then((loaded) => {
        if (!live) return;
        setSaved(loaded);
        // A fresh install opens Settings (docs/desktop-app.md §7).
        if (!isComplete(loaded)) setView("settings");
      });
    const stop = onOpenSettings(() => setView("settings"));
    return () => {
      live = false;
      stop();
    };
  }, []);

  const canGoBack = saved !== null && isComplete(saved);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (view === "settings" && canGoBack) setView("list");
      else void hideWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, canGoBack]);

  if (!saved) return <div className="h-full bg-background" />;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {view === "settings" ? (
        <SettingsView
          saved={saved}
          onSaved={(next) => {
            setSaved(next);
            setView("list");
          }}
          onBack={canGoBack ? () => setView("list") : undefined}
        />
      ) : (
        <>
          <TitleBar />
          <main className="flex-1 overflow-y-auto overscroll-contain" />
        </>
      )}
    </div>
  );
}
