import { type RefObject, useEffect, useRef, useState } from "react";
import { createApiClient } from "./api-client";
import { clockIn, todayIn } from "./days";
import { listCounts } from "./list";
import {
  hideWindow,
  loadSettings,
  onOpenSettings,
  onWindowShown,
  sendApi,
} from "./native";
import { type ListProblem, type OpenList, useOpenList } from "./open-list";
import { FRESH_SETTINGS, type SavedSettings } from "./settings";
import { SettingsView } from "./settings-view";
import { TitleBar } from "./title-bar";
import { TodoList } from "./todo-list";

const client = createApiClient(sendApi);

const isComplete = (saved: SavedSettings) =>
  saved.apiUrl !== null && saved.hasToken;

export function App() {
  const [saved, setSaved] = useState<SavedSettings | null>(null);
  const [view, setView] = useState<"list" | "settings">("list");
  const [shown, setShown] = useState(false);
  const listRef = useRef<HTMLElement>(null);

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
    const stopSettings = onOpenSettings(() => setView("settings"));
    const stopShown = onWindowShown(setShown);
    return () => {
      live = false;
      stopSettings();
      stopShown();
    };
  }, []);

  const canGoBack = saved !== null && isComplete(saved);
  const list = useOpenList(client, shown && view === "list" && canGoBack);

  // Every show starts at the top (docs/desktop-app.md §2).
  useEffect(() => {
    if (shown && listRef.current) listRef.current.scrollTop = 0;
  }, [shown]);

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
        <ListView
          list={list}
          ownerTimezone={saved.ownerTimezone}
          listRef={listRef}
          onOpenSettings={() => setView("settings")}
        />
      )}
    </div>
  );
}

function ListView({
  list,
  ownerTimezone,
  listRef,
  onOpenSettings,
}: {
  list: OpenList;
  ownerTimezone: string;
  listRef: RefObject<HTMLElement | null>;
  onOpenSettings: () => void;
}) {
  const today = todayIn(ownerTimezone);
  const offline = list.problem?.kind === "offline";
  return (
    <>
      <TitleBar
        counts={list.todos ? listCounts(list.todos, today) : undefined}
        offline={offline}
      />
      {list.problem && (
        <ProblemLine
          problem={list.problem}
          since={list.fetchedAt && clockIn(ownerTimezone, list.fetchedAt)}
          onOpenSettings={onOpenSettings}
        />
      )}
      <main
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      >
        {list.todos && (
          <TodoList
            todos={list.todos}
            projects={list.projects}
            today={today}
            offline={offline}
          />
        )}
      </main>
    </>
  );
}

/** The slim line under the title bar (docs/desktop-app.md §6). */
function ProblemLine({
  problem,
  since,
  onOpenSettings,
}: {
  problem: ListProblem;
  since: string | null;
  onOpenSettings: () => void;
}) {
  return (
    <p
      role="status"
      className="flex flex-none items-center gap-1.5 border-b bg-muted px-3 py-1.5 text-[11.5px] text-muted-foreground"
    >
      <i
        className="size-1.5 flex-none rounded-full bg-destructive"
        aria-hidden="true"
      />
      {problem.kind === "offline" ? (
        since ? (
          `Offline · showing the list from ${since} · changes are off`
        ) : (
          "Offline · changes are off"
        )
      ) : problem.kind === "refused" ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-left hover:text-foreground hover:underline"
        >
          {problem.message}
        </button>
      ) : (
        <span className="text-destructive">{problem.message}</span>
      )}
    </p>
  );
}
