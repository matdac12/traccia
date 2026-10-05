import { apiClient } from "./support/api";
import { E2E_LOGIN } from "./support/ports";
import { startStack } from "./support/stack";

export const PROJECT_NAME = "Smoke Project";

/** Boots the API + dashboard on a throwaway database, seeds one project, warms the routes. */
export default async function globalSetup() {
  const stack = await startStack();
  const api = apiClient(stack.apiUrl, stack.token);
  const project = await api.post<{ id: string }>("/projects", { name: PROJECT_NAME, key: "SMK" });
  await api.post("/issues", { project: project.id, title: "Seeded todo issue", status: "todo" });

  // `next dev` compiles each route on first hit; do it here so no test pays for it.
  const headers = { "tailscale-user-login": E2E_LOGIN };
  for (const path of ["/issues", "/issues?view=kanban", "/projects", `/projects/${project.id}`, "/trash", "/issues/SMK-1"]) {
    await fetch(`${stack.webUrl}${path}`, { headers });
  }

  process.env.E2E_API_URL = stack.apiUrl;
  process.env.E2E_API_TOKEN = stack.token;
  process.env.E2E_PROJECT_ID = project.id;
  return stack.stop;
}
