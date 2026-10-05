import type { ReactNode } from "react";
import { CreateIssueProvider } from "@/components/create-issue/provider";
import { AppShell } from "@/components/traccia/app-shell";
import { listProjects } from "@/lib/api/projects";
import { currentLogin } from "@/lib/session";

// Every page reads live data and the request's identity header: never prerender.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: ReactNode }) {
  // An error boundary in this folder (error.tsx) does not catch errors thrown by this layout,
  // so an API outage must not throw here: the shell still renders and the page shows its own error.
  const [projects, login] = await Promise.all([
    listProjects().catch(() => null),
    currentLogin(),
  ]);
  const shellProjects = projects?.map(({ id, name }) => ({ id, name })) ?? [];
  return (
    <CreateIssueProvider projects={shellProjects}>
      <AppShell login={login} projects={shellProjects} projectsUnavailable={projects === null}>
        {children}
      </AppShell>
    </CreateIssueProvider>
  );
}
