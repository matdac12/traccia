"use client";
/** PROTOTYPE: in-memory store with a fake "agent" that edits issues every few seconds. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ISSUES, nowIso, type Issue, type Priority, type Status, STATUSES, TRASH, type TrashItem, statusLabel } from "./mock-data";

type Store = {
  issues: Issue[];
  trash: TrashItem[];
  flashed: Set<string>;
  update: (id: string, patch: Partial<Issue>, text?: string) => void;
  create: (i: { title: string; projectKey: string; status: Status; assignee: Issue["assignee"]; priority: Priority; labels: string[] }) => Issue;
  softDelete: (id: string) => void;
  restore: (id: string) => void;
  purge: (id: string) => void;
  addComment: (id: string, body: string) => void;
  lastAgentEvent: string | null;
};

let _n = 0;
const uid = () => `id-${++_n}-${Math.random().toString(36).slice(2, 8)}`; // randomUUID needs a secure context
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [issues, setIssues] = useState<Issue[]>(ISSUES);
  const [trash, setTrash] = useState<TrashItem[]>(TRASH);
  const [flashed, setFlashed] = useState<Set<string>>(new Set());
  const [lastAgentEvent, setLast] = useState<string | null>(null);
  const counter = useRef(1740);

  const flash = useCallback((id: string) => {
    setFlashed((s) => new Set(s).add(id));
    setTimeout(() => setFlashed((s) => { const n = new Set(s); n.delete(id); return n; }), 2500);
  }, []);

  const update = useCallback((id: string, patch: Partial<Issue>, text?: string) => {
    setIssues((all) =>
      all.map((i) =>
        i.identifier === id
          ? {
              ...i,
              ...patch,
              updatedAt: nowIso(),
              activity: text ? [...i.activity, { id: uid(), actor: "you", text, at: nowIso() }] : i.activity,
            }
          : i,
      ),
    );
  }, []);

  const create: Store["create"] = useCallback((v) => {
    const prefix = v.projectKey;
    const identifier = `${prefix}-${counter.current++}`;
    const issue: Issue = {
      identifier, title: v.title, description: "", status: v.status, priority: v.priority, estimate: null, assignee: v.assignee,
      labels: v.labels, projectKey: v.projectKey, milestoneId: null, parent: null, blockedBy: [], updatedAt: nowIso(),
      createdBy: "you", comments: [], attachments: [], activity: [{ id: uid(), actor: "you", text: "created the issue", at: nowIso() }],
    };
    setIssues((a) => [issue, ...a]);
    return issue;
  }, []);

  const softDelete = useCallback((id: string) => {
    setIssues((all) => {
      const i = all.find((x) => x.identifier === id);
      if (i) setTrash((t) => [{ id: `t-${id}`, type: "issue", title: `${i.identifier} ${i.title}`, deletedBy: "you", deletedAt: nowIso() }, ...t]);
      return all.filter((x) => x.identifier !== id);
    });
  }, []);
  const restore = useCallback((id: string) => setTrash((t) => t.filter((x) => x.id !== id)), []);
  const purge = restore;

  const addComment = useCallback((id: string, body: string) => {
    setIssues((all) => all.map((i) => i.identifier === id ? { ...i, updatedAt: nowIso(), comments: [...i.comments, { id: uid(), author: "you", body, at: nowIso() }], activity: [...i.activity, { id: uid(), actor: "you", text: "commented", at: nowIso() }] } : i));
  }, []);

  // Fake agent: every ~12s moves an in-flight issue forward, to demo polling refresh + attribution.
  useEffect(() => {
    const t = setInterval(() => {
      setIssues((all) => {
        const pool = all.filter((i) => i.status === "todo" || i.status === "in_progress" || i.status === "backlog");
        if (!pool.length) return all;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const idx = STATUSES.findIndex((s) => s.key === pick.status);
        const next = STATUSES[Math.min(idx + 1, 3)].key;
        if (next === pick.status) return all;
        flash(pick.identifier);
        setLast(`claude-code-mac moved ${pick.identifier} to ${statusLabel(next)}`);
        return all.map((i) => i.identifier === pick.identifier ? { ...i, status: next, updatedAt: nowIso(), activity: [...i.activity, { id: uid(), actor: "agent" as const, text: `changed status from ${statusLabel(pick.status)} to ${statusLabel(next)}`, at: nowIso() }] } : i);
      });
    }, 12000);
    return () => clearInterval(t);
  }, [flash]);

  const value = useMemo(() => ({ issues, trash, flashed, update, create, softDelete, restore, purge, addComment, lastAgentEvent }), [issues, trash, flashed, update, create, softDelete, restore, purge, addComment, lastAgentEvent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
