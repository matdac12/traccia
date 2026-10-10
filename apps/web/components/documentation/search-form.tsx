import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** A plain GET form: the search text lives in the URL, so the server component re-renders with the filtered list. */
export function SearchForm({ placeholder, query, hidden }: { placeholder: string; query: string; hidden?: Record<string, string> }) {
  return (
    <search className="block w-full max-w-xs">
    <form method="get" className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" name="q" defaultValue={query} aria-label={placeholder} placeholder={placeholder} className="h-8 pl-8 text-[13px]" />
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </form>
    </search>
  );
}
