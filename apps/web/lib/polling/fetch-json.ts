/** GET a dashboard route handler. Throws on a non-2xx answer (the poll treats that as a failure and backs off). */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}
