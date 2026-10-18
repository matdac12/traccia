import { PersonalSpace } from "@/components/personal/personal-space";
import { listProjects } from "@/lib/api/projects";
import { loadPersonalSpace } from "@/lib/api/todos";

export const metadata = { title: "Personal" };

/** `/personal?todo=<id>` opens that To-do's details panel: the link in every Telegram Reminder and in the API's `url`. */
export default async function PersonalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { todo } = await searchParams;
  // The Projects feed `@` autocomplete and chip tooltips only: without them the page still works.
  const [initial, projects] = await Promise.all([loadPersonalSpace(new Date(), typeof todo === "string" ? todo : null), listProjects().catch(() => [])]);
  return <PersonalSpace initial={initial} projects={projects.map(({ id, key, name, status }) => ({ id, key, name, status }))} />;
}
