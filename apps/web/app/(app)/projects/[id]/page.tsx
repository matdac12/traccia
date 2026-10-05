import { notFound } from "next/navigation";
import { PageHeader } from "@/components/traccia/page-header";
import { ApiError } from "@/lib/api/client";
import { getProject } from "@/lib/api/projects";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  return (
    <>
      <PageHeader title={project.name} />
      <div className="p-4 text-[13px] text-muted-foreground">
        {project.description || "No description."}
      </div>
    </>
  );
}
