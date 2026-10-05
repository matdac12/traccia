"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, ChevronsUpDown, ListTodo, Moon, Plus, Search, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { PROJECTS } from "@/lib/mock-data";
import { StoreProvider, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Kbd } from "./atoms";
import { CommandPalette } from "./command-palette";
import { CreateIssueDialog } from "./create-issue-dialog";

function NavItem({ href, icon, children, active, trailing }: { href: string; icon: React.ReactNode; children: React.ReactNode; active: boolean; trailing?: React.ReactNode }) {
  return (
    <Link href={href} className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", active && "bg-sidebar-accent text-sidebar-accent-foreground")}>
      <span className="grid size-4 place-items-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [cmd, setCmd] = useState(false);
  const [create, setCreate] = useState(false);
  const { theme, setTheme } = useTheme();
  const { lastAgentEvent, trash } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setCreate(true); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">T</div>
          <span className="text-[13px] font-medium">Traccia</span>
          <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
        </div>
        <div className="space-y-1 px-2">
          <Button variant="outline" size="sm" onClick={() => setCmd(true)} className="h-7 w-full justify-start gap-2 bg-transparent px-2 text-[13px] font-normal text-muted-foreground">
            <Search className="size-3.5" /> Search <span className="ml-auto flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </Button>
          <Button size="sm" onClick={() => setCreate(true)} className="h-7 w-full justify-start gap-2 px-2 text-[13px]">
            <Plus className="size-3.5" /> New issue <span className="ml-auto"><Kbd>C</Kbd></span>
          </Button>
        </div>
        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          <NavItem href="/issues" icon={<ListTodo className="size-3.5" />} active={path.startsWith("/issues")}>Issues</NavItem>
          <NavItem href="/trash" icon={<Trash2 className="size-3.5" />} active={path === "/trash"} trailing={<span className="text-[11px] text-muted-foreground">{trash.length}</span>}>Trash</NavItem>
          <Link href="/projects" className="block px-2 pb-1 pt-4 text-[11px] font-medium text-muted-foreground hover:text-foreground">Projects</Link>
          {PROJECTS.map((p) => (
            <NavItem key={p.key} href={`/projects/${p.key}`} active={path === `/projects/${p.key}`} icon={<span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />}>{p.name}</NavItem>
          ))}
        </nav>
        <div className="space-y-2 border-t border-sidebar-border p-2">
          <div className="flex items-center gap-2 rounded-md bg-agent/8 px-2 py-1.5 text-[11px] text-muted-foreground" title={lastAgentEvent ?? "Waiting for agent activity"}>
            <span className="relative flex size-1.5"><span className="pulse-dot absolute inline-flex size-full rounded-full bg-agent" /></span>
            <Bot className="size-3 text-agent" />
            <span className="truncate">{lastAgentEvent ?? "Agents connected"}</span>
          </div>
          <div className="flex items-center gap-2 px-1">
            <div className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">M</div>
            <span className="text-[12px] text-sidebar-foreground">Mattia</span>
            <Button variant="ghost" size="icon" className="ml-auto size-6" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              {mounted && theme === "light" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            </Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-background">{children}</main>
      <CommandPalette open={cmd} setOpen={setCmd} onCreate={() => setCreate(true)} />
      <CreateIssueDialog open={create} onOpenChange={setCreate} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <StoreProvider><Shell>{children}</Shell></StoreProvider>;
}
