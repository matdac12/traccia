import { Plus } from "lucide-react";

/** The 40 px bar of variant G (docs/desktop-app.md §3.1). The + opens the composer from step 06 on. */
export function TitleBar() {
  return (
    <header className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3.5">
      <h1 className="font-semibold">Personal</h1>
      <span className="flex-1" />
      <button
        type="button"
        aria-label="Add a To-do"
        title="Add a To-do"
        className="grid size-[26px] place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
      >
        <Plus className="size-[15px]" strokeWidth={2.2} aria-hidden="true" />
      </button>
    </header>
  );
}
