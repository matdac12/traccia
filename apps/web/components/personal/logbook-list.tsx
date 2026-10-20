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

/** The pages read so far on `today` (`count` of them), in one list; `loaded` once the first came. */
type LogbookPages = { today: string; items: Todo[]; nextCursor: string | null; loaded: boolean; count: number };
const noPages = (today: string): LogbookPages => ({ today, items: [], nextCursor: null, loaded: false, count: 0 });

/** The most pages one re-read goes back over. */
const MAX_REREAD_PAGES = 20;

/**
 * The Logbook's own read (docs/personal-space.md §7.3): `GET /v1/todos?state=closed` a page at a time, newest first,
 * only when asked (the list shown, or scrolled to its end). The To-dos closed today come with the page's poll, which
 * wins for them; the older ones are only here, so while the Logbook is `active` each poll (`tick`) re-reads the pages
 * held, and so does showing it again: a To-do closed on an earlier day and then edited, reopened or deleted elsewhere
 * doesn't stay stale. A write's answer updates the copy held here at once. A new day starts over, since the pages may
 * lack what was closed yesterday after they were read.
 */
export function useLogbook(today: string, { active, tick }: { active: boolean; tick: number | null }) {
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
      setPages((p) => (p.today === asked.today ? { ...p, items: mergeById(p.items, page.items), nextCursor: page.nextCursor, loaded: true, count: p.count + 1 } : p));
      setStatus("idle");
    } catch {
      setStatus("failed");
    } finally {
      loading.current = false;
    }
  }, []);

  /** The pages held, read again from the newest, silently. A failed re-read keeps what is held. */
  const reread = useCallback(async () => {
    const asked = current.current;
    if (!asked.loaded) return;
    try {
      const items: Todo[] = [];
      let cursor: string | null = null;
      let count = 0;
      do {
        const page: LogbookPage = await getJson<LogbookPage>(`/api/todos/logbook${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
        items.push(...page.items);
        cursor = page.nextCursor;
        count++;
      } while (cursor && count < Math.min(asked.count, MAX_REREAD_PAGES));
      setPages((p) => (p.today === asked.today ? { ...p, items: mergeById(items), nextCursor: cursor, count } : p));
    } catch {
      // The next poll tries again.
    }
  }, []);
  // Changes when the Logbook is shown, and with each poll while it is.
  const trigger = active ? (tick ?? 0) : null;
  useEffect(() => {
    if (trigger !== null) void reread();
  }, [trigger, reread]);

  /** A write the API took: the saved copy replaces the held one, and a reopened To-do leaves (the open list has it). */
  const saved = useCallback((todo: Todo) => {
    setPages((p) => (p.items.some((t) => t.id === todo.id) ? { ...p, items: todo.state === "open" ? p.items.filter((t) => t.id !== todo.id) : p.items.map((t) => (t.id === todo.id ? todo : t)) } : p));
  }, []);

  const last = pages.items.at(-1);
  // Where the loaded pages end, while more are left to read.
  const end: LogbookEnd | null = pages.nextCursor && last?.closedAt ? { closedAt: last.closedAt, id: last.id } : null;
  return { items: pages.items, loaded: pages.loaded, hasMore: !pages.loaded || pages.nextCursor !== null, end, status, loadMore, saved };
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
