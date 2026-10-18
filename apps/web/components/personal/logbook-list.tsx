"use client";
import type { Todo } from "@traccia/shared";
import { BookCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/traccia/empty-state";
import { Button } from "@/components/ui/button";
import { dayLabel } from "@/lib/personal/days";
import { type LogbookEnd, type LogbookPage, logbookList, mergeById } from "@/lib/personal/lists";
import { getJson } from "@/lib/polling/fetch-json";
import { DaySection, ListHeading } from "./list-heading";
import { TodoRow } from "./todo-row";

/** The pages read so far on `today`, in one list; `loaded` once the first came. */
type LogbookPages = { today: string; items: Todo[]; nextCursor: string | null; loaded: boolean };
const noPages = (today: string): LogbookPages => ({ today, items: [], nextCursor: null, loaded: false });

/**
 * The Logbook's own read (docs/personal-space.md §7.3): `GET /v1/todos?state=closed` a page at a time, newest first,
 * only when asked (the list shown, or scrolled to its end). The page's poll never re-reads it: the To-dos closed today
 * come with the poll itself, which wins for them, and a write's answer (or a delete) updates the copy held here. A new
 * day starts over, since the pages may lack what was closed yesterday after they were read.
 */
export function useLogbook(today: string) {
  const [pages, setPages] = useState(() => noPages(today));
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  if (pages.today !== today) {
    setPages(noPages(today));
    // A read that failed on the day before doesn't hold back the new day's first one.
    if (status === "failed") setStatus("idle");
  }
  const current = useRef(pages);
  useEffect(() => {
    current.current = pages;
  }, [pages]);
  const loading = useRef(false);

  const loadMore = useCallback(async () => {
    const asked = current.current;
    if (loading.current || (asked.loaded && !asked.nextCursor)) return;
    loading.current = true;
    setStatus("loading");
    try {
      const page = await getJson<LogbookPage>(`/api/todos/logbook${asked.nextCursor ? `?cursor=${encodeURIComponent(asked.nextCursor)}` : ""}`);
      // A read the new day overtook is dropped.
      setPages((p) => (p.today === asked.today ? { ...p, items: mergeById(p.items, page.items), nextCursor: page.nextCursor, loaded: true } : p));
      setStatus("idle");
    } catch {
      setStatus("failed");
    } finally {
      loading.current = false;
    }
  }, []);

  /** A write the API took: the saved copy replaces the held one, and a reopened To-do leaves (the open list has it). */
  const saved = useCallback((todo: Todo) => {
    setPages((p) => (p.items.some((t) => t.id === todo.id) ? { ...p, items: todo.state === "open" ? p.items.filter((t) => t.id !== todo.id) : p.items.map((t) => (t.id === todo.id ? todo : t)) } : p));
  }, []);
  /** A delete the API took: the To-do and its Sub-to-dos leave. */
  const deleted = useCallback((id: string) => {
    setPages((p) => ({ ...p, items: p.items.filter((t) => t.id !== id && t.parentId !== id) }));
  }, []);

  const last = pages.items.at(-1);
  // Where the loaded pages end, while more are left to read.
  const end: LogbookEnd | null = pages.nextCursor && last?.closedAt ? { closedAt: last.closedAt, id: last.id } : null;
  return { items: pages.items, loaded: pages.loaded, hasMore: !pages.loaded || pages.nextCursor !== null, end, status, loadMore, saved, deleted };
}

export type Logbook = ReturnType<typeof useLogbook>;

/**
 * The Logbook (docs/personal-space.md §7.3): every done and dropped To-do, grouped by the day it was closed (Owner
 * timezone), newest first, reading older pages as the end of the list scrolls into view. Its rows reopen.
 */
export function LogbookList({ todos, today, timeZone, logbook }: { todos: Todo[]; today: string; timeZone: string; logbook: Logbook }) {
  const { loaded, hasMore, end, status, loadMore } = logbook;
  const endAt = end?.closedAt;
  const endId = end?.id;
  const groups = useMemo(() => (loaded ? logbookList(todos, timeZone, endAt && endId ? { closedAt: endAt, id: endId } : null) : []), [loaded, todos, timeZone, endAt, endId]);
  const sentinel = useRef<HTMLDivElement>(null);

  // The first page as soon as the list shows (again once a read the new day made stale is over).
  useEffect(() => {
    if (!loaded && status === "idle") void loadMore();
  }, [loaded, status, loadMore]);

  // The next one when the end of the list comes into view; observed again after each page (the status goes back to
  // idle), in case it still shows.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !loaded || !hasMore || status !== "idle" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded, hasMore, status, loadMore]);

  return (
    <>
      <ListHeading sub="Everything done or dropped, kept forever.">Logbook</ListHeading>
      {loaded && !groups.length && !hasMore ? (
        <EmptyState icon={BookCheck} title="Nothing done yet" className="rounded-lg border border-dashed py-12">
          Done and dropped To-dos land here.
        </EmptyState>
      ) : null}
      {groups.map(({ day, todos: closed }) => (
        <DaySection key={day} id={`personal-closed-${day}`} label={dayLabel(day, today)}>
          <ul>
            {closed.map((t) => (
              <TodoRow key={t.id} todo={t} />
            ))}
          </ul>
        </DaySection>
      ))}
      <div ref={sentinel} className="flex min-h-12 items-center justify-center pt-4 text-[12px] text-muted-foreground">
        {status === "loading" ? (
          <span role="status" className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the Logbook…
          </span>
        ) : status === "failed" ? (
          <span role="alert" className="flex items-center gap-2 text-destructive">
            Could not load the Logbook.
            <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => void loadMore()}>
              Try again
            </Button>
          </span>
        ) : loaded && hasMore ? (
          <Button variant="ghost" size="sm" className="h-7 text-[12px] text-muted-foreground" onClick={() => void loadMore()}>
            Show older
          </Button>
        ) : null}
      </div>
    </>
  );
}
