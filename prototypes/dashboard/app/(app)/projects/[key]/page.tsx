import { ProjectPage } from "@/components/tracker/project-page";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ProjectPage projectKey={key} />;
}
