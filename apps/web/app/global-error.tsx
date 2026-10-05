"use client";

/** Last-resort boundary (errors in the root layout). Plain markup: no providers are available here. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "1.1rem" }}>Something went wrong</h1>
          <button type="button" onClick={reset}>Try again</button>
        </div>
      </body>
    </html>
  );
}
