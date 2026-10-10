import { DocNav } from "@/components/documentation/doc-nav";
import { FilesView } from "@/components/documentation/files-view";
import { SearchForm } from "@/components/documentation/search-form";
import { listDocuments } from "@/lib/api/documentation";
import { getProjectOr404 } from "@/lib/api/projects";

export const metadata = { title: "Project files" };

/** Documentation, Files sub-tab: the project's documents (`?q=` filename/description substring), editable as `you`. */
export default async function ProjectFilesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const [project, documents] = await Promise.allSettled([getProjectOr404(id), listDocuments(id, { query })]);
  if (project.status === "rejected") throw project.reason;
  if (documents.status === "rejected") throw documents.reason;
  return (
    <>
      <DocNav projectId={project.value.id} active="files" />
      <div className="px-4 pt-4 sm:px-6"><SearchForm placeholder="Search files" query={query} /></div>
      <FilesView projectId={project.value.id} documents={documents.value} query={query} />
    </>
  );
}
