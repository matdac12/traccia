"use client";
import { useState } from "react";
import { LiveStatus } from "@/components/traccia/live-status";
import { PageHeader } from "@/components/traccia/page-header";
import { listMenuCounts, type PersonalSpaceData } from "@/lib/personal/lists";
import { getJson } from "@/lib/polling/fetch-json";
import { usePoll } from "@/lib/polling/use-poll";
import { ListMenu, type PersonalList } from "./list-menu";
import { ListPlaceholder } from "./list-placeholder";
import { TodayList } from "./today-list";

/**
 * The Personal Space page (docs/personal-space.md §7): the list menu and one list. The server renders the first
 * copy; the live refresh (TRC-52) re-reads it from `GET /api/todos`, "today" included, so midnight rolls over.
 */
export function PersonalSpace({ initial }: { initial: PersonalSpaceData }) {
  // The server's copy is the source of truth; a fresh render replaces whatever the client holds.
  const [seen, setSeen] = useState(initial);
  const [data, setData] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }
  const [list, setList] = useState<PersonalList>("today");
  const sync = usePoll(async () => {
    const remote = await getJson<PersonalSpaceData>("/api/todos");
    // An unchanged answer keeps the same object, so nothing re-renders.
    setData((current) => (JSON.stringify(current) === JSON.stringify(remote) ? current : remote));
  });
  const { today, todos } = data;

  return (
    <>
      <PageHeader title="Personal">
        <LiveStatus lastUpdated={sync.lastUpdated} failures={sync.failures} onRefresh={sync.refresh} />
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ListMenu active={list} counts={listMenuCounts(todos, today)} onSelect={setList} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[680px] px-4 pb-24 pt-6 md:px-8 md:pt-10">
            {list === "today" ? <TodayList todos={todos} today={today} /> : <ListPlaceholder list={list} />}
          </div>
        </div>
      </div>
    </>
  );
}
