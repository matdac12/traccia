"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { FolderKanban, ListTodo, Moon, Plus, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { PROJECTS } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { StatusIcon } from "./atoms";

export function CommandPalette({ open, setOpen, onCreate }: { open: boolean; setOpen: (o: boolean) => void; onCreate: () => void }) {
  const router = useRouter();
  const { issues } = useStore();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen(!open); }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search issues and run actions">
      <CommandInput placeholder="Search issues, projects, or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { setOpen(false); onCreate(); }}><Plus />Create issue</CommandItem>
          <CommandItem onSelect={() => go("/issues")}><ListTodo />Go to Issues</CommandItem>
          <CommandItem onSelect={() => go("/trash")}><Trash2 />Go to Trash</CommandItem>
          <CommandItem onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }}><Moon />Toggle theme</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Projects">
          {PROJECTS.map((p) => <CommandItem key={p.key} onSelect={() => go(`/projects/${p.key}`)}><FolderKanban />{p.name}</CommandItem>)}
        </CommandGroup>
        <CommandGroup heading="Issues">
          {issues.slice(0, 12).map((i) => (
            <CommandItem key={i.identifier} value={`${i.identifier} ${i.title}`} onSelect={() => go(`/issues/${i.identifier}`)}>
              <StatusIcon status={i.status} />
              <span className="font-mono text-xs text-muted-foreground">{i.identifier}</span>
              <span className="truncate">{i.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
