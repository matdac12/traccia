// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOptionsProvider } from "../components/personal/projects-context";
import { TodoTitle } from "../components/personal/todo-title";
import { TooltipProvider } from "../components/ui/tooltip";

// Chips use the app's TooltipProvider (root layout).
const withProjects = (ui: ReactNode) => (
  <TooltipProvider>
    <ProjectOptionsProvider value={[{ id: "p_crm", key: "CRM", name: "CRM rollout", status: "active" }]}>{ui}</ProjectOptionsProvider>
  </TooltipProvider>
);

beforeEach(() => {
  // The tooltip opens on hover and Radix measures it; jsdom has no ResizeObserver.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("Project chips", () => {
  const title = (references: Todo["references"]): Pick<Todo, "title" | "references" | "state"> => ({ title: "Plan @crm and @old", references, state: "open" });

  it("link to the Project page, and a click doesn't reach the row", async () => {
    const onRowClick = vi.fn();
    render(
      withProjects(
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: stands in for a selectable row.
        <div onClick={onRowClick}>
          <TodoTitle todo={title([{ key: "CRM", projectId: "p_crm", projectDeleted: false }])} />
        </div>,
      ),
    );
    const chip = screen.getByRole("link", { name: "CRM" });
    expect(chip).toHaveAttribute("href", "/projects/p_crm");
    chip.addEventListener("click", (e) => e.preventDefault());
    await userEvent.setup().click(chip);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("show an Open <name> tooltip", async () => {
    render(withProjects(<TodoTitle todo={title([{ key: "CRM", projectId: "p_crm", projectDeleted: false }])} />));
    await userEvent.setup().hover(screen.getByRole("link", { name: "CRM" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Open CRM rollout");
  });

  it("are greyed and not links when the Project is deleted", () => {
    render(withProjects(<TodoTitle todo={title([{ key: "OLD", projectId: "p_old", projectDeleted: true }])} />));
    expect(screen.getByText("OLD")).toHaveAttribute("title", "OLD is deleted");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
