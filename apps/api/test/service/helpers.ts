import { ServiceError } from "@traccia/shared";
import { afterEach } from "vitest";
import { createServices } from "../../src/service/index.js";
import { createTestDb } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

export function setupServices(defaultIssueKey = "MAT") {
  const { sqlite, db } = createTestDb();
  cleanups.push(() => sqlite.close());
  return { sqlite, db, services: createServices({ db, defaultIssueKey }) };
}

export function onCleanup(fn: () => void) {
  cleanups.push(fn);
}

/** Runs `fn` and returns the `ServiceError` code it throws (undefined if it doesn't throw). */
export function code(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ServiceError) return e.code;
    throw e;
  }
  return undefined;
}
