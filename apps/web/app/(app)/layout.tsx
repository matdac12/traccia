import type { ReactNode } from "react";
import { AppShell } from "@/components/traccia/app-shell";
import { listProjects } from "@/lib/api/projects";
import { currentLogin } from "@/lib/session";

// Every page reads live data and the request's identity header: never prerender.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: ReactNode }) {
  const [projects, login] = await Promise.all([listProjects(), currentLogin()]);
  return (
    <AppShell login={login} projects={projects.map(({ id, key, name }) => ({ id, key, name }))}>
      {children}
    </AppShell>
  );
}
