import { describe, expect, it } from "vitest";
import { insertProjectKey, matchProjects, keyQueryAt, type ProjectOption } from "../lib/personal/project-autocomplete";

const project = (key: string, name: string, status: ProjectOption["status"] = "active"): ProjectOption => ({ id: `p_${key}_${name}`, key, name, status });

describe("keyQueryAt", () => {
  it("finds the @ run that ends at the caret", () => {
    expect(keyQueryAt("Review invoices @c", 18)).toEqual({ start: 16, query: "c" });
    expect(keyQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(keyQueryAt("(@crm", 5)).toEqual({ start: 1, query: "crm" });
  });

  it("finds nothing when the caret is not in an @ run", () => {
    expect(keyQueryAt("Review invoices", 15)).toBeNull();
    expect(keyQueryAt("@crm done", 9)).toBeNull();
    expect(keyQueryAt("@crm ", 5)).toBeNull();
    // An e-mail address is not a reference (the API's candidate rule).
    expect(keyQueryAt("mail bob@cr", 11)).toBeNull();
  });

  it("only looks at the text before the caret", () => {
    expect(keyQueryAt("Fix @crmx later", 7)).toEqual({ start: 4, query: "cr" });
  });
});

describe("matchProjects", () => {
  const projects = [
    project("WEB", "Website"),
    project("CRM", "CRM rollout"),
    project("OPS", "Recruiting"),
    project("CRASH", "Crash reports", "paused"),
    project("OLD", "Crm archive", "completed"),
    project("GONE", "Crm pilot", "canceled"),
  ];

  it("lists active and paused Projects whose key starts with the text first, then those whose name contains it", () => {
    expect(matchProjects(projects, "cr").map((p) => p.key)).toEqual(["CRASH", "CRM", "OPS"]);
  });

  it("matches case-insensitively, by key prefix or name substring only", () => {
    expect(matchProjects(projects, "SITE").map((p) => p.key)).toEqual(["WEB"]);
    expect(matchProjects(projects, "rm").map((p) => p.key)).toEqual(["CRM"]);
  });

  it("lists every active and paused Project for a bare @, by key", () => {
    expect(matchProjects(projects, "").map((p) => p.key)).toEqual(["CRASH", "CRM", "OPS", "WEB"]);
  });

  it("stops at 7", () => {
    const many = Array.from({ length: 10 }, (_, i) => project(`K${i}`, `Project ${i}`));
    expect(matchProjects(many, "k")).toHaveLength(7);
  });
});

describe("insertProjectKey", () => {
  it("replaces the @ run with @KEY and a space, and puts the caret after it", () => {
    expect(insertProjectKey("Review invoices @c", 18, "CRM")).toEqual({ value: "Review invoices @CRM ", caret: 21 });
  });

  it("replaces the rest of the word under the caret and keeps the text after it", () => {
    expect(insertProjectKey("Fix @crmx later", 7, "CRM")).toEqual({ value: "Fix @CRM later", caret: 9 });
    expect(insertProjectKey("@w tomorrow", 2, "WEB")).toEqual({ value: "@WEB tomorrow", caret: 5 });
  });
});
