import { Trash2 } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/traccia/empty-state";
import { PageHeader } from "@/components/traccia/page-header";
import { TrashList } from "@/components/trash/trash-list";
import { TYPE_LABEL } from "@/components/trash/trash-model";
import { TRASH_TYPES, type TrashType } from "@/lib/api/schemas";
import { listAllTrash, listTrash } from "@/lib/api/trash";
import { cn } from "@/lib/utils";

export const metadata = { title: "Trash" };

type SearchParams = Promise<{ type?: string; cursor?: string }>;

const href = (type?: TrashType, cursor?: string) => {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (cursor) q.set("cursor", cursor);
  const s = q.toString();
  return s ? `/trash?${s}` : "/trash";
};

export default async function TrashPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const type = (TRASH_TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as TrashType) : undefined;
  const [page, all] = await Promise.all([listTrash({ type, cursor: sp.cursor }), listAllTrash()]);

  return (
    <>
      <PageHeader title="Trash">
        <span className="text-xs text-muted-foreground">{all.length} in trash</span>
      </PageHeader>
      <nav aria-label="Filter by type" className="flex h-10 shrink-0 items-center gap-1 border-b px-4 text-xs">
        {[undefined, ...TRASH_TYPES].map((t) => (
          <Link
            key={t ?? "all"}
            href={href(t)}
            aria-current={t === type ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/50",
              t === type && "bg-accent text-foreground",
            )}
          >
            {t ? `${TYPE_LABEL[t]}s` : "All"}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 && !sp.cursor ? (
        <EmptyState icon={Trash2} title={type ? `No ${TYPE_LABEL[type].toLowerCase()}s in the trash` : "Trash is empty"}>
          Deleted items show up here, and can be restored until you purge them.
        </EmptyState>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TrashList items={page.items} all={all} />
          <div className="flex items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
            {sp.cursor ? (
              <Link href={href(type)} className="hover:text-foreground">
                ← Newest
              </Link>
            ) : null}
            {page.nextCursor ? (
              <Link href={href(type, page.nextCursor)} className="hover:text-foreground">
                Older →
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
