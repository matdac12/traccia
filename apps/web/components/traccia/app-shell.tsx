"use client";
import { Check, ChevronsUpDown, ListTodo, Menu, PanelLeftClose, PanelLeftOpen, Plus, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NewProjectButton } from "@/components/project/new-project-button";
import { useCreateIssue } from "@/components/create-issue/provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { shortcutBlocked } from "@/lib/is-typing";
import { sidebarCookie } from "@/lib/sidebar-state";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { TracciaMark } from "./traccia-mark";

/** What the client shell needs from a project: plain data, resolved on the server. */
export type ShellProject = { id: string; name: string };

/** Names an icon-only control on hover and keyboard focus. Does nothing while the sidebar is expanded (the label is visible). */
function RailTip({ label, show, children }: { label: string; show: boolean; children: ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavItem({ href, icon, children, active, label, collapsed }: { href: string; icon: ReactNode; children: ReactNode; active: boolean; label: string; collapsed: boolean }) {
  return (
    <RailTip label={label} show={collapsed}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", active && "bg-sidebar-accent text-sidebar-accent-foreground", collapsed && "justify-center px-0")}
      >
        <span aria-hidden className="grid size-4 place-items-center text-muted-foreground">{icon}</span>
        <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{children}</span>
      </Link>
    </RailTip>
  );
}

type SidebarProps = {
  projects: ShellProject[];
  projectsUnavailable: boolean;
  login: string;
  /** Icon rail. Only the desktop sidebar ever sets it; the mobile drawer is always the full list. */
  collapsed?: boolean;
  /** Present on the desktop sidebar only: renders the collapse/expand button. */
  onToggle?: () => void;
};

function SidebarContent({ projects, projectsUnavailable, login, collapsed = false, onToggle }: SidebarProps) {
  const path = usePathname();
  const createIssue = useCreateIssue();
  const inProject = (id: string) => path === `/projects/${id}` || path.startsWith(`/projects/${id}/`);
  const current = projects.find((p) => inProject(p.id));
  const switcherLabel = current?.name ?? "Traccia";
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <>
      <div className={cn("flex p-2", collapsed ? "flex-col items-center gap-1" : "items-center gap-1")}>
        <DropdownMenu>
          <RailTip label={switcherLabel} show={collapsed}>
            <DropdownMenuTrigger className={cn("flex h-8 items-center gap-2 rounded-md text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring", collapsed ? "w-8 justify-center" : "min-w-0 flex-1 px-1")}>
              <TracciaMark className="size-6 shrink-0" />
              <span className={collapsed ? "sr-only" : "flex-1 truncate text-[13px] font-medium"}>{switcherLabel}</span>
              {collapsed ? null : <ChevronsUpDown className="size-3.5 text-muted-foreground" />}
            </DropdownMenuTrigger>
          </RailTip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">Switch project</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/projects">All projects {!current && path === "/projects" ? <Check className="ml-auto size-3.5" /> : null}</Link>
            </DropdownMenuItem>
            {projects.length ? <DropdownMenuSeparator /> : null}
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link href={`/projects/${p.id}`}>
                  <span className="truncate">{p.name}</span>
                  {current?.id === p.id ? <Check className="ml-auto size-3.5" /> : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {onToggle ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                aria-keyshortcuts="Control+B Meta+B"
                onClick={onToggle}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "bottom"}>{toggleLabel} <kbd className="ml-1 font-mono text-[10px] opacity-70">⌘B</kbd></TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <nav aria-label="Main" className={cn("flex-1 space-y-0.5 overflow-y-auto px-2", collapsed && "flex flex-col items-stretch")}>
        <RailTip label="New issue" show={collapsed}>
          <button
            type="button"
            onClick={() => createIssue.open({ projectId: current?.id })}
            className={cn("mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", collapsed && "justify-center px-0")}
          >
            <span className="grid size-4 place-items-center text-muted-foreground"><Plus className="size-3.5" /></span>
            <span className={collapsed ? "sr-only" : "flex-1 text-left"}>New issue</span>
            {collapsed ? null : <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">C</kbd>}
          </button>
        </RailTip>
        <NavItem href="/issues" icon={<ListTodo className="size-3.5" />} active={path.startsWith("/issues")} label="Issues" collapsed={collapsed}>Issues</NavItem>
        <NavItem href="/trash" icon={<Trash2 className="size-3.5" />} active={path === "/trash"} label="Trash" collapsed={collapsed}>Trash</NavItem>
        <div className={cn("flex items-center pb-1 pt-4", collapsed ? "flex-col gap-1 border-t border-sidebar-border pt-2 mt-2" : "justify-between")}>
          {collapsed ? null : <Link href="/projects" className="px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">Projects</Link>}
          <RailTip label="New project" show={collapsed}>
            <NewProjectButton size="icon" variant="ghost" className="size-5 text-muted-foreground"><Plus className="size-3.5" /><span className="sr-only">New project</span></NewProjectButton>
          </RailTip>
        </div>
        {projectsUnavailable ? (
          collapsed ? (
            <RailTip label="Could not load projects. Is the API running?" show>
              <p className="grid h-7 place-items-center text-destructive"><TriangleAlert className="size-3.5" /><span className="sr-only">Could not load projects. Is the API running?</span></p>
            </RailTip>
          ) : <p className="px-2 text-[12px] text-destructive">Could not load projects. Is the API running?</p>
        ) : projects.length === 0 && !collapsed ? <p className="px-2 text-[12px] text-muted-foreground">No projects yet.</p> : null}
        {projects.map((p) => (
          <NavItem
            key={p.id}
            href={`/projects/${p.id}`}
            active={inProject(p.id)}
            label={p.name}
            collapsed={collapsed}
            icon={collapsed
              ? <span className="grid size-5 place-items-center rounded-[5px] bg-muted-foreground/15 text-[10px] font-semibold uppercase text-sidebar-foreground">{p.name.charAt(0)}</span>
              : <span className="size-2.5 rounded-[3px] bg-muted-foreground/50" />}
          >
            {p.name}
          </NavItem>
        ))}
      </nav>
      <div className="space-y-2 border-t border-sidebar-border p-2">
        <div className={cn("flex items-center gap-2 px-1", collapsed && "flex-col px-0")}>
          <div className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold uppercase text-primary" title={login}>{login.charAt(0)}</div>
          <span className={collapsed ? "sr-only" : "truncate text-[12px] text-sidebar-foreground"} title={login}>{login}</span>
          <ThemeToggle className={collapsed ? "ml-0" : undefined} />
        </div>
      </div>
    </>
  );
}

export function AppShell({ projects, projectsUnavailable = false, login, defaultCollapsed = false, children }: { projects: ShellProject[]; projectsUnavailable?: boolean; login: string; /** From the cookie, read on the server, so the first paint already has the right width. */ defaultCollapsed?: boolean; children: ReactNode }) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 768px)");
  // Navigation (including back/forward) and growing past md close the drawer.
  const lastPath = useRef(path);
  const lastDesktop = useRef(desktop);
  useEffect(() => {
    if (lastPath.current !== path || lastDesktop.current !== desktop) {
      lastPath.current = path;
      lastDesktop.current = desktop;
      setDrawerOpen(false);
    }
  }, [path, desktop]);

  // A click on any link in the mobile drawer closes it. Wired natively through the node state below so the
  // drawer body stays a plain layout element (an interactive role on the wrapper would be wrong).
  const [drawerBody, setDrawerBody] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!drawerOpen || !drawerBody) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a")) setDrawerOpen(false);
    };
    drawerBody.addEventListener("click", onClick);
    return () => drawerBody.removeEventListener("click", onClick);
  }, [drawerOpen, drawerBody]);

  // Desktop only: the mobile drawer is unaffected by (and never changes) the collapsed choice.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleCollapsed = useCallback(() => {
    document.cookie = sidebarCookie(!collapsed);
    setCollapsed(!collapsed);
  }, [collapsed]);
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || shortcutBlocked(e)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, toggleCollapsed]);

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <aside
        data-collapsed={collapsed}
        className={cn("hidden shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none md:flex", collapsed ? "w-12" : "w-[232px]")}
      >
        <SidebarContent projects={projects} projectsUnavailable={projectsUnavailable} login={login} collapsed={collapsed} onToggle={toggleCollapsed} />
      </aside>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 md:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setDrawerOpen(true)} className="grid size-9 place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent"><Menu className="size-5" /></button>
        <TracciaMark className="size-6 shrink-0" />
        <span className="text-[13px] font-medium">Traccia</span>
      </div>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="inset-y-0 left-0 top-0 flex h-dvh w-[85vw] max-w-[280px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 border-r border-sidebar-border bg-sidebar p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-[280px] md:hidden"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div ref={setDrawerBody} className="flex min-h-0 flex-1 flex-col">
            <SidebarContent projects={projects} projectsUnavailable={projectsUnavailable} login={login} />
          </div>
        </DialogContent>
      </Dialog>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">{children}</main>
    </div>
    </TooltipProvider>
  );
}
