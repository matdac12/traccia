"use client";

import { Brain, FileImage, FileText, Flag, FolderKanban, ListTodo, Loader2, MessageSquare, RotateCcw, SquareCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { purgeAction, restoreAction } from "@/app/(app)/trash/actions";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { TrashItem, TrashType } from "@/lib/api/schemas";
import { batchPeers, deletedByText, groupedRows, itemHref, purgeConfirmation, restoreSummary, summarize, TYPE_LABEL, togetherText } from "./trash-model";

const ICON = { issue: SquareCheck, comment: MessageSquare, project: FolderKanban, milestone: Flag, attachment: FileImage, memory: Brain, document: FileText, todo: ListTodo } satisfies Record<
  TrashType,
  unknown
>;

type Notice = { kind: "ok" | "error"; text: string; href?: string | null };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** `group`: fold an issue's comments and attachments into its row (off when the list is filtered to one type). */
export function TrashList({ items, all, group = true }: { items: TrashItem[]; all: TrashItem[]; group?: boolean }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<TrashItem | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const restore = (item: TrashItem) => {
    setBusyId(item.id);
    start(async () => {
      const out = await restoreAction(item.type, item.id);
      setBusyId(null);
      setNotice(out.ok ? { kind: "ok", text: `${restoreSummary(out.result)} “${item.label}”`, href: itemHref(item) } : { kind: "error", text: out.message });
    });
  };

  const purge = (item: TrashItem) => {
    start(async () => {
      const out = await purgeAction(item.type, item.id);
      if (out.ok) {
        setConfirm(null);
        setNotice({ kind: "ok", text: `Purged “${item.label}”.` });
      } else {
        setPurgeError(out.message);
      }
    });
  };

  const text = confirm ? purgeConfirmation(confirm, all) : null;

  return (
    <div>
      {notice ? (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`flex items-center gap-3 border-b px-4 py-2 text-[13px] ${notice.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-accent/40"}`}
        >
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          {notice.href ? (
            <Link href={notice.href} className="shrink-0 text-xs underline underline-offset-2">
              Open
            </Link>
          ) : null}
          <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <ul>
        {groupedRows(items, all, group).map((t) => {
          const Icon = ICON[t.type];
          const together = batchPeers(t, all);
          return (
            // Below `sm` a row is two lines (icon + title, then type, badge, time, buttons); the two wrappers
            // are `sm:contents`, so from `sm` up the children are the row's own flex items again, in one line.
            <li key={`${t.type}:${t.id}`} className="group flex flex-col gap-1 border-b px-4 py-2 text-[13px] hover:bg-accent/40 sm:min-h-11 sm:flex-row sm:items-center sm:gap-3 sm:py-0">
              <div className="flex min-w-0 items-center gap-3 sm:contents">
                <Icon className="size-4 shrink-0 text-muted-foreground sm:order-1" aria-hidden />
                <span className="min-w-0 flex-1 truncate sm:order-3">
                  {t.label}
                  {t.type !== "project" && t.projectName ? <span className="ml-2 text-xs text-muted-foreground">in {t.projectName}</span> : null}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 sm:contents">
                <span className="shrink-0 text-xs text-muted-foreground sm:order-2 sm:w-20">{TYPE_LABEL[t.type]}</span>
                {together.length > 0 ? (
                  <span
                    className="shrink-0 rounded-full border px-2 text-[11px] text-muted-foreground sm:order-4"
                    title={`Deleted together: ${summarize(together)}. Restoring brings the whole batch back.`}
                  >
                    {togetherText(together)}
                  </span>
                ) : null}
                <time dateTime={t.deletedAt} title={new Date(t.deletedAt).toLocaleString()} className="shrink-0 text-xs text-muted-foreground sm:order-5 sm:w-32 sm:text-right">
                  {[ago(t.deletedAt), deletedByText(t)].filter(Boolean).join(" ")}
                </time>
                <div className="ml-auto flex shrink-0 gap-1 sm:order-6 sm:ml-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Restore"
                    className="h-7 gap-1.5 text-xs max-sm:size-8 max-sm:p-0"
                    disabled={pending}
                    onClick={() => restore(t)}
                    title="Restores this item and everything deleted with it"
                  >
                    {busyId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    <span className="max-sm:hidden">Restore</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Purge"
                    className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive max-sm:size-8 max-sm:p-0"
                    disabled={pending}
                    onClick={() => {
                      setPurgeError(null);
                      setConfirm(t);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    <span className="max-sm:hidden">Purge</span>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{text?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">“{text?.name}”</span> will be deleted forever. {text?.warning}
              </p>
              {text?.withIt ? <p>{text.withIt}</p> : null}
              <p>Purging is reserved for you.</p>
            </div>
          </AlertDialogDescription>
          {purgeError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {purgeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost" size="sm" disabled={pending}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button variant="destructive" size="sm" disabled={pending} onClick={() => confirm && purge(confirm)}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Purge permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
