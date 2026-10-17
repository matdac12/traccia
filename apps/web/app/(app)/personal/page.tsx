import { PersonalSpace } from "@/components/personal/personal-space";
import { listProjects } from "@/lib/api/projects";
import { loadPersonalSpace } from "@/lib/api/todos";

export const metadata = { title: "Personal" };

export default async function PersonalPage() {
  // The Projects feed `@` autocomplete and chip tooltips only: without them the page still works.
  const [initial, projects] = await Promise.all([loadPersonalSpace(), listProjects().catch(() => [])]);
  return <PersonalSpace initial={initial} projects={projects.map(({ id, key, name, status }) => ({ id, key, name, status }))} />;
}
