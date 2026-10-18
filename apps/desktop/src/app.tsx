import { type RefObject, useEffect, useRef, useState } from "react";
import { createApiClient, type Todo } from "./api-client";
import { typedCharacter, useComposer } from "./composer";
import { ComposerCard } from "./composer-card";
import { clockIn, todayIn } from "./days";
import { buildSections, listCounts } from "./list";
import {
  hideWindow,
  loadSettings,
  onOpenSettings,
  onWindowShown,
  openUrl,
  sendApi,
} from "./native";
import { type ListProblem, type OpenList, useOpenList } from "./open-list";
import { type RowActions, type Toast, useRowActions } from "./row-actions";
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
  const listShown = shown && view === "list" && canGoBack;
  const list = useOpenList(client, listShown);
  const rows = useRowActions(client, {
    todos: list.todos,
    // Settings counts as a hide: the rows closed before it leave the list.
    shown: listShown,
    offline: list.problem?.kind === "offline",
  });

  // Every show starts at the top (docs/desktop-app.md §2).
  useEffect(() => {
    if (shown && listRef.current) listRef.current.scrollTop = 0;
  }, [shown]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The list's own Esc (the cascade confirm) comes first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (view === "settings" && canGoBack) setView("list");
      else void hideWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, canGoBack]);

  if (!saved) return <div className="h-full bg-background" />;

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
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
          rows={rows}
          shown={listShown}
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
  rows,
  shown,
  ownerTimezone,
  listRef,
  onOpenSettings,
}: {
  list: OpenList;
  rows: RowActions;
  shown: boolean;
  ownerTimezone: string;
  listRef: RefObject<HTMLElement | null>;
  onOpenSettings: () => void;
}) {
  const today = todayIn(ownerTimezone);
  const offline = list.problem?.kind === "offline";
  const todos = rows.todos;
  const [selected, setSelected] = useState<string | null>(null);
  // The rows in the order they show, for ↑ ↓.
  const order = todos
    ? buildSections(todos, today).flatMap((s) => s.items.map((t) => t.id))
    : [];
  const selectedId = selected && order.includes(selected) ? selected : null;

  // Every show starts with nothing selected.
  useEffect(() => {
    if (!shown) setSelected(null);
  }, [shown]);

  // Every show gives the keyboard back to the list: a button still focused from an earlier click (the +) would
  // otherwise keep Space and Enter, so ↓ and Space on a row did nothing. The composer keeps its focus.
  useEffect(() => {
    if (!shown) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !focused.closest("[data-composer]"))
      focused.blur();
  }, [shown]);

  useEffect(() => {
    if (selectedId)
      document
        .querySelector(`[data-todo="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  const open = (todo: Todo) =>
    void openUrl(todo.url).catch((err) =>
      rows.notify(`Couldn't open it. ${err}`),
    );

  const composer = useComposer(client, {
    ownerTimezone,
    shown,
    offline,
    onAdded: rows.added,
    notify: rows.notify,
  });
  /** The + or a typed key (§5.1): the list's selection and confirm give way to the composer. */
  const compose = (initial: string) => {
    if (!composer.openWith(initial)) return;
    setSelected(null);
    rows.cancelCascade();
  };

  // The keyboard (docs/desktop-app.md §4, §5). On `document`, so it runs before the window's Esc-hides.
  const keys = useRef({
    order,
    selectedId,
    rows,
    todos,
    open,
    composer,
    compose,
  });
  keys.current = { order, selectedId, rows, todos, open, composer, compose };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { order, selectedId, rows, todos, open, composer, compose } =
        keys.current;
      // A focused button handles its own Enter and Space, except a row's: a click leaves the focus on the check
      // or the title, and the keys then belong to the selection.
      const target = event.target as Element | null;
      const onButton =
        !!target?.closest?.("button") && !target.closest("[data-todo]");
      const take = () => event.preventDefault();
      // While the composer is open, its keys are its own and none acts on the list. Esc closes it, unless the `@`
      // list took that Esc; the next Esc hides the window.
      if (composer.open) {
        if (event.key === "Escape" && !event.defaultPrevented) {
          take();
          composer.close();
        }
        return;
      }
      // Typing opens the composer with that character (§5.1); Space does too while no row is selected.
      const typed = typedCharacter(event);
      const inField = !!target?.closest?.("input, textarea, select");
      if (
        typed !== null &&
        !inField &&
        !event.defaultPrevented &&
        !(typed === " " && (selectedId || onButton))
      ) {
        take();
        compose(typed === " " ? "" : typed);
        return;
      }
      if (rows.confirm && event.key === "Escape") {
        take();
        rows.cancelCascade();
      } else if (rows.confirm && event.key === "Enter" && !onButton) {
        take();
        rows.confirmCascade();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        take();
        const i = selectedId ? order.indexOf(selectedId) : -1;
        setSelected(
          event.key === "ArrowDown"
            ? (order[Math.min(order.length - 1, i + 1)] ?? null)
            : i <= 0
              ? null
              : (order[i - 1] ?? null),
        );
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z" &&
        rows.toast?.canUndo
      ) {
        take();
        rows.undo();
      } else if (selectedId && event.key === "Delete") {
        take();
        rows.drop(selectedId);
      } else if (selectedId && event.key === " " && !onButton) {
        take();
        rows.toggle(selectedId);
      } else if (selectedId && event.key === "Enter" && !onButton) {
        const todo = todos?.find((t) => t.id === selectedId);
        if (todo) {
          take();
          open(todo);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <TitleBar
        counts={todos ? listCounts(todos, today) : undefined}
        offline={offline}
        composing={composer.open}
        onAdd={() => (composer.open ? composer.close() : compose(""))}
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
        {todos && (
          <TodoList
            todos={todos}
            projects={list.projects}
            today={today}
            offline={offline}
            selectedId={selectedId}
            confirm={rows.confirm}
            handlers={{
              onSelect: setSelected,
              onToggle: rows.toggle,
              onDrop: rows.drop,
              onOpen: open,
              onConfirmCascade: rows.confirmCascade,
              onCancelCascade: rows.cancelCascade,
            }}
          />
        )}
      </main>
      {composer.open && (
        <ComposerCard
          composer={composer}
          projects={list.projects}
          today={today}
        />
      )}
      {rows.toast && <ToastLine toast={rows.toast} onUndo={rows.undo} />}
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

/** "Dropped “Gym” · Undo", or a short error, at the bottom of the window for 5 s (docs/desktop-app.md §4). */
function ToastLine({ toast, onUndo }: { toast: Toast; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="absolute inset-x-2.5 bottom-2.5 z-[5] flex items-center gap-2.5 rounded-md bg-foreground px-2.5 py-2 text-xs text-background shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {toast.text}
      </span>
      {toast.canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="font-semibold text-primary"
        >
          Undo
        </button>
      )}
    </div>
  );
}
