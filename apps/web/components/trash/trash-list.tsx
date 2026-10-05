"use client";

import { AlertDialog } from "radix-ui";
import { FileImage, Flag, FolderKanban, Loader2, MessageSquare, RotateCcw, SquareCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { purgeAction, restoreAction } from "@/app/(app)/trash/actions";
import { Button } from "@/components/ui/button";
import type { TrashItem, TrashType } from "@/lib/api/schemas";
import { batchPeers, deletedByText, itemHref, purgeConfirmation, restoreSummary, summarize, TYPE_LABEL } from "./trash-model";

const ICON = { issue: SquareCheck, comment: MessageSquare, project: FolderKanban, milestone: Flag, attachment: FileImage } satisfies Record<TrashType, unknown>;

type Notice = { kind: "ok" | "error"; text: string; href?: string | null };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function TrashList({ items, all }: { items: TrashItem[]; all: TrashItem[] }) {
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
      setNotice(
        out.ok
          ? { kind: "ok", text: `${restoreSummary(out.result)} “${item.label}”`, href: itemHref(item) }
          : { kind: "error", text: out.message },
      );
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
        {items.map((t) => {
          const Icon = ICON[t.type];
          const together = batchPeers(t, all);
          return (
            <li key={`${t.type}:${t.id}`} className="group flex min-h-11 items-center gap-3 border-b px-4 text-[13px] hover:bg-accent/40">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{TYPE_LABEL[t.type]}</span>
              <span className="min-w-0 flex-1 truncate">
                {t.label}
                {t.type !== "project" && t.projectName ? <span className="ml-2 text-xs text-muted-foreground">in {t.projectName}</span> : null}
              </span>
              {together.length > 0 ? (
                <span
                  className="shrink-0 rounded-full border px-2 text-[11px] text-muted-foreground"
                  title={`Deleted together: ${summarize(together)}. Restoring brings the whole batch back.`}
                >
                  with {together.length} {together.length === 1 ? "other" : "others"}
                </span>
              ) : null}
              <time dateTime={t.deletedAt} title={new Date(t.deletedAt).toLocaleString()} className="w-32 shrink-0 text-right text-xs text-muted-foreground">
                {[ago(t.deletedAt), deletedByText(t)].filter(Boolean).join(" ")}
              </time>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={pending}
                  onClick={() => restore(t)}
                  title="Restores this item and everything deleted with it"
                >
                  {busyId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => {
                    setPurgeError(null);
                    setConfirm(t);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Purge
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog.Root open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border bg-background p-5 shadow-lg">
            <AlertDialog.Title className="text-sm font-semibold">{text?.title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="space-y-2 text-[13px] text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">“{text?.name}”</span> will be deleted forever. {text?.warning}
                </p>
                {text?.withIt ? <p>{text.withIt}</p> : null}
                <p>Purging is reserved for you.</p>
              </div>
            </AlertDialog.Description>
            {purgeError ? (
              <p role="alert" className="text-[13px] text-destructive">
                {purgeError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost" size="sm" disabled={pending}>
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <Button variant="destructive" size="sm" disabled={pending} onClick={() => confirm && purge(confirm)}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Purge permanently
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
