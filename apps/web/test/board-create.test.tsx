// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Board } from "../components/kanban/board";
import { emptyColumns } from "../components/kanban/board-model";

const open = vi.fn();
vi.mock("../components/create-issue/provider", () => ({ useOptionalCreateIssue: () => ({ open }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/issues" }));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));

describe("Board column add", () => {
  it("opens the create dialog in that column's status, in the board's project", async () => {
    render(<Board columns={emptyColumns()} query="" projectId="p1" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "New in progress issue" }));
    expect(open).toHaveBeenCalledWith({ status: "in_progress", projectId: "p1" });
  });
});
