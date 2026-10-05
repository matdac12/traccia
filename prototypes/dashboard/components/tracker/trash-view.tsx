"use client";
import { useState } from "react";
import { FileImage, FolderKanban, Flag, MessageSquare, RotateCcw, SquareCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { timeAgo, type TrashItem } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { Assignee } from "./atoms";

const ICON = { issue: SquareCheck, comment: MessageSquare, project: FolderKanban, milestone: Flag, attachment: FileImage };

export function TrashView() {
  const { trash, restore, purge } = useStore();
  const [confirm, setConfirm] = useState<TrashItem | null>(null);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-2 border-b px-4"><h1 className="text-[13px] font-medium">Trash</h1><span className="text-xs text-muted-foreground">{trash.length}</span></header>
      <div className="flex-1 overflow-y-auto">
        {trash.length === 0 ? <div className="grid h-full place-items-center text-sm text-muted-foreground">Trash is empty.</div> : trash.map((t) => {
          const Icon = ICON[t.type];
          return (
            <div key={t.id} className="group flex h-11 items-center gap-3 border-b px-4 text-[13px] hover:bg-accent/40">
              <Icon className="size-4 text-muted-foreground" />
              <span className="w-20 text-xs capitalize text-muted-foreground">{t.type}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.batch && <span className="rounded-full border px-2 text-[11px] text-muted-foreground" title="Deleted together; restoring brings the whole batch back">with {t.batchSize! - 1} others</span>}
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Assignee who={t.deletedBy} size={14} />{timeAgo(t.deletedAt)} ago</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => restore(t.id)}><RotateCcw className="size-3.5" />Restore</Button>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive" onClick={() => setConfirm(t)}><Trash2 className="size-3.5" />Purge</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Purge permanently?</DialogTitle><DialogDescription>“{confirm?.title}” will be deleted forever. This cannot be undone. Only you can purge; agents cannot.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="destructive" onClick={() => { purge(confirm!.id); setConfirm(null); }}>Purge</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
