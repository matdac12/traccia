import { useEffect } from "react";
import { hideWindow } from "./native";
import { TitleBar } from "./title-bar";

export function App() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void hideWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex-1 overflow-y-auto overscroll-contain" />
    </div>
  );
}
