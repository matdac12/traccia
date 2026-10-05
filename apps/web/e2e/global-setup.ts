import { apiClient } from "./support/api";
import { PROJECT_NAME } from "./support/ports";
import { type Stack, startStack } from "./support/stack";

/** Boots the API + a production dashboard on a throwaway database and seeds one project. */
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

  process.env.E2E_API_URL = stack.apiUrl;
  process.env.E2E_API_TOKEN = stack.token;
  process.env.E2E_PROJECT_ID = project.id;
}
