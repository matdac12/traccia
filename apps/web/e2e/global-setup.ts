import { apiClient, PNG } from "./support/api";
import { E2E_LOGIN, LOGIN_HEADER, PROJECT_NAME } from "./support/ports";
import { type Stack, startStack } from "./support/stack";

/** Boots the API + dashboard on a throwaway database, seeds one project, warms the routes. */
export default async function globalSetup() {
  const stack = await startStack();
  try {
    await seed(stack);
  } catch (err) {
    await stack.stop(); // Playwright only calls the teardown when setup returned
    throw err;
  }
  return stack.stop;
}

async function seed(stack: Stack) {
  const api = apiClient(stack.apiUrl, stack.token);
  const project = await api.post<{ id: string }>("/projects", { name: PROJECT_NAME, key: "SMK" });
  await api.post("/issues", { project: project.id, title: "Seeded todo issue", status: "todo" });

  // `next dev` compiles each route on first hit; do it here so no test pays for it.
  const headers = { [LOGIN_HEADER]: E2E_LOGIN };
  for (const path of ["/issues", "/issues?view=kanban", "/projects", `/projects/${project.id}`, `/projects/${project.id}/issues`, `/projects/${project.id}/activity`, "/trash", "/issues/SMK-1"]) {
    const res = await fetch(`${stack.webUrl}${path}`, { headers });
    if (!res.ok) throw new Error(`warm-up GET ${path} -> ${res.status}`);
  }

  // The attachment routes compile on first use too (and a slow first image load fails the preview check).
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "warmup.png");
  const upload = await fetch(`${stack.webUrl}/api/issues/SMK-1/attachments`, { method: "POST", headers, body: form });
  if (!upload.ok) throw new Error(`warm-up upload -> ${upload.status}`);
  const { id } = (await upload.json()) as { id: string };
  const file = await fetch(`${stack.webUrl}/api/files/${id}`, { headers });
  if (!file.ok) throw new Error(`warm-up file download -> ${file.status}`);

  process.env.E2E_API_URL = stack.apiUrl;
  process.env.E2E_API_TOKEN = stack.token;
  process.env.E2E_PROJECT_ID = project.id;
}
