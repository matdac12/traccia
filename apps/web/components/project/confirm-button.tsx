"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A destructive action that asks "Delete?" inline before running. */
export function ConfirmButton({ onConfirm, label = "Delete", confirmLabel = "Confirm", disabled, children }: { onConfirm: () => void; label?: string; confirmLabel?: string; disabled?: boolean; children?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="xs" disabled={disabled} className="text-muted-foreground hover:text-destructive" aria-label={label} onClick={() => setAsking(true)}>
        {children ?? label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" variant="destructive" size="xs" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}
