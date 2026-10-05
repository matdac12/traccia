import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { CreateIssueProvider } from "@/components/create-issue/provider";
import { InAppHistoryTracker } from "@/components/traccia/in-app-history-tracker";
import { AppShell } from "@/components/traccia/app-shell";
import { listProjects } from "@/lib/api/projects";
import { currentLogin } from "@/lib/session";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/lib/sidebar-state";

// Every page reads live data and the request's identity header: never prerender.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: ReactNode }) {
  // An error boundary in this folder (error.tsx) does not catch errors thrown by this layout,
  // so an API outage must not throw here: the shell still renders and the page shows its own error.
  const [projects, login, cookieStore] = await Promise.all([
    listProjects().catch(() => null),
    currentLogin(),
    cookies(),
  ]);
  const sidebarCollapsed = parseSidebarCookie(cookieStore.get(SIDEBAR_COOKIE)?.value);
  const shellProjects = projects?.map(({ id, name }) => ({ id, name })) ?? [];
  return (
    <CreateIssueProvider projects={shellProjects}>
      <Suspense>
        <InAppHistoryTracker />
      </Suspense>
      <AppShell login={login} defaultCollapsed={sidebarCollapsed} projects={shellProjects} projectsUnavailable={projects === null}>
        {children}
      </AppShell>
    </CreateIssueProvider>
  );
}
