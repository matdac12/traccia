import { DocNav } from "@/components/documentation/doc-nav";
import { MemoriesView } from "@/components/documentation/memories-view";
import { SearchForm } from "@/components/documentation/search-form";
import { listMemories, tagsOf } from "@/lib/api/documentation";
import { getProjectOr404 } from "@/lib/api/projects";

export const metadata = { title: "Project memory" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** Documentation, Memory sub-tab: the project's memories (`?q=` text, `?tag=` tag filter), editable as `you`. */
export default async function ProjectMemoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const query = first(sp.q);
  const tag = first(sp.tag);
  // The tag row needs every tag in use, so an unfiltered list is read when a filter narrows the shown one.
  const [project, shown, all] = await Promise.allSettled([getProjectOr404(id), listMemories(id, { query, tag }), query || tag ? listMemories(id) : Promise.resolve(null)]);
  if (project.status === "rejected") throw project.reason;
  if (shown.status === "rejected") throw shown.reason;
  if (all.status === "rejected") throw all.reason;
  return (
    <>
      <DocNav projectId={project.value.id} active="memory" counts={{ memory: (all.value ?? shown.value).length }} />
      <div className="px-4 pt-4 sm:px-6"><SearchForm placeholder="Search memories" query={query} hidden={tag ? { tag } : undefined} /></div>
      <MemoriesView projectId={project.value.id} memories={shown.value} tags={tagsOf(all.value ?? shown.value)} activeTag={tag} query={query} />
    </>
  );
}
