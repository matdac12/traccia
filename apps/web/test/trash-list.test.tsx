// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrashList } from "../components/trash/trash-list";
import { pluralize } from "../components/trash/trash-model";
import type { TrashItem } from "../lib/api/schemas";

const { purgeAction, restoreAction } = vi.hoisted(() => ({ purgeAction: vi.fn(), restoreAction: vi.fn() }));
vi.mock("../app/(app)/trash/actions", () => ({ purgeAction, restoreAction }));

const item = (over: Partial<TrashItem>): TrashItem => ({
  type: "todo", id: "t1", label: "Plan the trip", deletedAt: "2026-10-05T10:00:00Z", deletedBatch: "b1", issueId: null,
  parentId: null, projectId: null, projectName: null, deletedBy: "you", ...over,
});

beforeEach(() => {
  purgeAction.mockReset();
  restoreAction.mockReset();
});

describe("the Trash purge confirm", () => {
  const trip = item({});
  const tiles = item({ id: "t2", label: "Book flights", parentId: "t1" });

  it("names what goes with it, and purges on confirm", async () => {
    purgeAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TrashList items={[trip]} all={[trip, tiles]} />);
    await user.click(screen.getByRole("button", { name: "Purge" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Purge to-do permanently?" });
    expect(dialog).toHaveTextContent("“Plan the trip” will be deleted forever. This cannot be undone.");
    expect(dialog).toHaveTextContent("This also permanently removes 1 sub-to-do deleted with it.");
    await user.click(within(dialog).getByRole("button", { name: "Purge permanently" }));
    expect(purgeAction).toHaveBeenCalledWith("todo", "t1");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("closes on Cancel without purging", async () => {
    const user = userEvent.setup();
    render(<TrashList items={[trip]} all={[trip]} />);
    await user.click(screen.getByRole("button", { name: "Purge" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(purgeAction).not.toHaveBeenCalled();
  });
});

describe("pluralize", () => {
  it("counts with the type's own words", () => {
    expect(pluralize("todo", 1)).toBe("1 to-do");
    expect(pluralize("subtodo", 3)).toBe("3 sub-to-dos");
    expect(pluralize("issue", 0)).toBe("0 issues");
  });
});
