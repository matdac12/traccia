// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { ProjectOption } from "@traccia/shared";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOptionsProvider } from "../components/personal/projects-context";
import { QuickAdd } from "../components/personal/quick-add";

const createTodoAction = vi.hoisted(() => vi.fn());
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction }));

// A Saturday.
const TODAY = "2026-10-17";

const PROJECTS: ProjectOption[] = [
  { id: "p_crm", key: "CRM", name: "CRM rollout", status: "active" },
  { id: "p_crash", key: "CRASH", name: "Crash reports", status: "paused" },
  { id: "p_web", key: "WEB", name: "Website", status: "active" },
];

const withProjects = (ui: ReactNode) => <ProjectOptionsProvider value={PROJECTS}>{ui}</ProjectOptionsProvider>;

function renderQuickAdd() {
  render(withProjects(<QuickAdd today={TODAY} defaultDay={TODAY} />));
  return { input: screen.getByRole("combobox", { name: "New To-do" }), user: userEvent.setup() };
}

beforeEach(() => {
  createTodoAction.mockReset();
  createTodoAction.mockResolvedValue({ ok: true, data: { id: "t1" } });
});

describe("QuickAdd", () => {
  it("creates a To-do for tomorrow with a 10:00 Reminder and a CRM reference, after picking CRM from the @ list", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "Review invoices @c");
    const list = screen.getByRole("listbox", { name: "Projects" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["CRASHCrash reportspaused", "CRMCRM rollout"]);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Review invoices @CRM ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(input, "tomorrow 10:00");
    // The read-back line: Reminder time, the title with its chip, and the day.
    const readBack = document.getElementById(input.getAttribute("aria-describedby") ?? "") as HTMLElement;
    expect(readBack).toHaveTextContent("10:00");
    expect(readBack).toHaveTextContent("Review invoices CRM");
    expect(readBack).toHaveTextContent("Tomorrow");
    expect(within(readBack).queryByRole("link")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Review invoices @CRM", day: "2026-10-18", time: "10:00" });
    expect(input).toHaveValue("");
  });

  it("is a combobox whose active option follows the arrow keys, and Tab inserts it too", async () => {
    const { input, user } = renderQuickAdd();
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.type(input, "@");
    expect(input).toHaveAttribute("aria-expanded", "true");
    // The open list is not part of the input's name.
    expect(screen.getByRole("combobox", { name: "New To-do" })).toBe(input);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2]?.id);
    await user.keyboard("{Tab}");
    expect(input).toHaveValue("@WEB ");
    expect(input).toHaveFocus();
  });

  it("inserts a key in the middle of the line and leaves the caret right after it", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "Ship @w later");
    await user.keyboard("{ArrowLeft>6/}");
    expect(screen.getByRole("option", { name: /WEB/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Ship @WEB later");
    await user.keyboard("now ");
    expect(input).toHaveValue("Ship @WEB now later");
  });

  it("closes the list on Esc without submitting, then Enter submits", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "Ping @cr");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(createTodoAction).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Ping @cr", day: TODAY, time: null });
  });

  it("shows the API's error inline and keeps the line when the Reminder time has passed", async () => {
    createTodoAction.mockResolvedValue({
      ok: false,
      error: "time must be in the future (2026-10-17 08:00 in Europe/Rome has passed)",
      fieldErrors: { time: "time must be in the future (2026-10-17 08:00 in Europe/Rome has passed)" },
    });
    const { input, user } = renderQuickAdd();
    await user.type(input, "Call the bank 08:00{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Time must be in the future (2026-10-17 08:00 in Europe/Rome has passed)");
    expect(input).toHaveValue("Call the bank 08:00");
    expect(input).toHaveAttribute("aria-invalid", "true");

    await user.type(input, "{Backspace}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends nothing when the line has no title", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "tomorrow 09:00{Enter}");
    expect(createTodoAction).not.toHaveBeenCalled();
  });

  it("puts a line with no day word on the default day, Anytime included", async () => {
    render(withProjects(<QuickAdd today={TODAY} defaultDay={null} />));
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "New To-do" }), "Someday maybe{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Someday maybe", day: null, time: null });
    expect(screen.queryByText("Anytime")).not.toBeInTheDocument();
  });

  it("puts a line with anytime in Anytime, whatever the default day", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "Read the RFC anytime");
    const readBack = document.getElementById(input.getAttribute("aria-describedby") ?? "") as HTMLElement;
    expect(readBack).toHaveTextContent("Read the RFC");
    expect(readBack).toHaveTextContent("Anytime");
    await user.keyboard("{Enter}");
    expect(createTodoAction).toHaveBeenCalledWith({ title: "Read the RFC", day: null, time: null });
  });

  it("refuses anytime with a time inline, without sending: a Reminder needs a Planned day", async () => {
    const { input, user } = renderQuickAdd();
    await user.type(input, "Call the bank anytime 15:00{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("A Reminder needs a Planned day");
    expect(createTodoAction).not.toHaveBeenCalled();
    expect(input).toHaveValue("Call the bank anytime 15:00");
  });
});
