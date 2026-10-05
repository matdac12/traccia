/** Runs once when the server starts: a bad env fails fast with a clear message and a non-zero exit. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Skipped during `next build`, which has no runtime env.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { serverEnv } = await import("./lib/server-env");
  try {
    serverEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
