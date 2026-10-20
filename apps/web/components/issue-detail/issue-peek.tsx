"use client";

import { ArrowUpRight, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { IssueDetail as IssueData } from "@/lib/api/schemas";
import { getJson } from "@/lib/polling/fetch-json";
import { useMediaQuery } from "@/lib/use-media-query";
import { IssueDetail, type IssueDetailProps } from "./issue-detail";

type Props = Pick<IssueDetailProps, "projects" | "labels" | "milestones" | "refreshVersion" | "onSaved"> & {
  identifier: string;
  onClose: () => void;
  onRefresh: () => void;
  trigger: HTMLElement | null;
};

/** One detail request on selection, not per list row. Shares the full page's editor and conflict handling. */
function PeekEditor({ identifier, ...lookups }: Pick<Props, "identifier" | "projects" | "labels" | "milestones" | "refreshVersion" | "onSaved">) {
  const [data, setData] = useState<IssueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts an unsuccessful read.
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      setError(null);
      try {
        const issue = await getJson<IssueData>(`/api/issues/${encodeURIComponent(identifier)}`, abort.signal);
        if (!abort.signal.aborted) setData(issue);
      } catch {
        if (!abort.signal.aborted) setError("Could not load this issue. Try again or open the full issue.");
      }
    };
    void load();
    return () => abort.abort();
  }, [identifier, retry]);
  if (error)
    return (
      <div role="alert" className="p-6 text-sm">
        <p>{error}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setRetry((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  if (!data)
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading issue…
      </div>
    );
  return <IssueDetail issue={data} parent={null} {...lookups} presentation="peek" />;
}

export function IssuePeek({ identifier, onClose, onRefresh, trigger, ...lookups }: Props) {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const restoreFocus = () => {
    const replacement = [...document.querySelectorAll<HTMLAnchorElement>("a[data-issue-identifier]")].find((link) => link.dataset.issueIdentifier === identifier);
    const target = trigger?.isConnected ? trigger : (replacement ?? document.querySelector<HTMLButtonElement>("button[data-issue-list-focus]"));
    target?.focus({ preventScroll: true });
  };
  return (
    <Dialog.Root
      open
      modal={!desktop}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-sm outline-none md:w-[560px] md:max-w-[55vw]"
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <Dialog.Title className="sr-only">Issue peek</Dialog.Title>
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
            <span className="font-mono text-xs text-muted-foreground">{identifier}</span>
            <Button className="ml-auto size-7" size="icon" variant="ghost" aria-label="Refresh issue and list" title="Refresh issue and list" onClick={onRefresh}>
              <RefreshCw className="size-3.5" />
            </Button>
            <Link href={`/issues/${identifier}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Full issue
              <ArrowUpRight className="size-3.5" />
            </Link>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Close peek">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1">
            <PeekEditor key={identifier} identifier={identifier} {...lookups} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
