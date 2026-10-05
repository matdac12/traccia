/** A tiny client for the local test API, used to seed data and to change it behind the page's back. */
export function apiClient(apiUrl: string, token: string) {
  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${apiUrl}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body?: unknown) => call<T>("POST", path, body),
    patch: <T>(path: string, body: unknown, headers?: Record<string, string>) => call<T>("PATCH", path, body, headers),
  };
}

export type E2eApi = ReturnType<typeof apiClient>;

export type SeedIssue = { id: string; identifier: string; title: string; updatedAt: string };

/** Creates an issue with a unique title, so scenarios never depend on each other's data. */
export function createIssue(api: E2eApi, projectId: string, title: string, status = "backlog") {
  return api.post<SeedIssue>("/issues", { project: projectId, title, status });
}
