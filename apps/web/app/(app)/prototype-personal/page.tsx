// PROTOTYPE (TRC-148): throwaway route for the Personal Space variants. Not for main.
import { Suspense } from "react";
import { PersonalPrototype } from "@/components/prototype-personal/personal-prototype";
import { listProjects } from "@/lib/api/projects";

export const metadata = { title: "Personal (prototype)" };

export default async function Page() {
  const projects = await listProjects().catch(() => []);
  return (
    <Suspense>
      <PersonalPrototype projects={projects.map(({ id, key, name, status }) => ({ id, key, name, status }))} />
    </Suspense>
  );
}
