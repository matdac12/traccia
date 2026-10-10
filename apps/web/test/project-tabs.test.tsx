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
    expect(activeProjectTab("/projects/p1/activity/")).toBe("activity");
    // A project id that collides with a tab name is not mistaken for that tab.
    expect(activeProjectTab("/projects/issues")).toBe("overview");
    expect(activeProjectTab("/projects/p1/issues/extra")).toBe("overview");
    expect(activeProjectTab("/projects/p1/documentation")).toBe("documentation");
    expect(activeProjectTab("/projects/p1/documentation/files")).toBe("documentation");
    expect(activeProjectTab("/projects/p1/documentation/other")).toBe("overview");
  });

  it("links the four sections as real navigation, Overview first", () => {
    path = "/projects/p1";
    render(<ProjectTabs projectId="p1" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overview", "Activity", "Issues", "Documentation"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/projects/p1", "/projects/p1/activity", "/projects/p1/issues", "/projects/p1/documentation"]);
    expect(screen.getByRole("navigation", { name: "Project sections" })).toBeInTheDocument();
  });

  it("selects Overview by default and the matching tab on the sub-routes", () => {
    for (const [p, name] of [["/projects/p1", "Overview"], ["/projects/p1/activity", "Activity"], ["/projects/p1/issues", "Issues"], ["/projects/p1/documentation/files", "Documentation"]] as const) {
      path = p;
      const { unmount } = render(<ProjectTabs projectId="p1" />);
      expect(screen.getByRole("link", { current: "page" })).toHaveTextContent(name);
      expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
      unmount();
    }
  });
});
