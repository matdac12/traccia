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
