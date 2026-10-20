async function read<T>(url: string, cache: RequestCache, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache, headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

/** GET a dashboard route handler. Throws on a non-2xx answer (the poll treats that as a failure and backs off). */
export const getJson = <T>(url: string, signal?: AbortSignal) => read<T>(url, "no-store", signal);

/**
 * `getJson` for a route that sends an `ETag` (`jsonWithEtag`): the browser keeps the answer and asks again with
 * `If-None-Match`, and a 304 comes back here as the kept copy.
 */
export const getTaggedJson = <T>(url: string, signal?: AbortSignal) => read<T>(url, "no-cache", signal);
