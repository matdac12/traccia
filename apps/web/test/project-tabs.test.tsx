// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let path = "/projects/p1";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
const { ProjectTabs, activeProjectTab } = await import("../components/project/project-tabs");

describe("project tabs", () => {
  it("maps the path to a tab, falling back to Overview", () => {
    expect(activeProjectTab("/projects/p1")).toBe("overview");
    expect(activeProjectTab("/projects/p1/")).toBe("overview");
    expect(activeProjectTab("/projects/p1/activity")).toBe("activity");
    expect(activeProjectTab("/projects/p1/issues")).toBe("issues");
    expect(activeProjectTab("/projects/p1/unknown")).toBe("overview");
  });

  it("links the three sections as real navigation, Overview first", () => {
    path = "/projects/p1";
    render(<ProjectTabs projectId="p1" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "Activity", "Issues"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/projects/p1", "/projects/p1/activity", "/projects/p1/issues"]);
    expect(screen.getByRole("navigation", { name: "Project sections" })).toBeInTheDocument();
  });

  it("selects Overview by default and the matching tab on the sub-routes", () => {
    for (const [p, name] of [["/projects/p1", "Overview"], ["/projects/p1/activity", "Activity"], ["/projects/p1/issues", "Issues"]] as const) {
      path = p;
      const { unmount } = render(<ProjectTabs projectId="p1" />);
      expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(name);
      expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
      unmount();
    }
  });
});
