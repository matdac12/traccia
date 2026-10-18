// @vitest-environment jsdom
import type { Todo } from "@traccia/shared";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSpace } from "../components/personal/personal-space";
import { TooltipProvider } from "../components/ui/tooltip";
import { deliveryBanner, FAILURE_TEXT, reminderNote, SKIPPED_TEXT } from "../lib/personal/delivery";
import type { PersonalSpaceData } from "../lib/personal/lists";

const { createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction } = vi.hoisted(() => ({
  createTodoAction: vi.fn(),
  updateTodoAction: vi.fn(),
  deleteTodoAction: vi.fn(),
  moveTodoAction: vi.fn(),
}));
vi.mock("../app/(app)/personal/actions", () => ({ createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction }));
vi.mock("next/navigation", () => import("./history-navigation"));

// Saturday 17 October 2026, 15:00 in Rome.
const TODAY = "2026-10-17";
const UPDATED = "2026-10-01T08:00:00.000Z";
const NOW = new Date("2026-10-17T13:00:00Z");

let n = 0;
function todo(over: Partial<Todo> = {}): Todo {
  n++;
  return {
    id: `t${n}`,
    title: `To-do ${n}`,
    references: [],
    day: TODAY,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: { done: 0, total: 0 },
    position: n,
    details: null,
    source: "dashboard",
    url: "",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: UPDATED,
    ...over,
  };
}
const reminder = (status: NonNullable<Todo["reminder"]>["status"], failure: NonNullable<Todo["reminder"]>["failure"] = null, time = "09:00") => ({ time, status, failure, sentAt: null });
const page = (todos: Todo[], delivery?: PersonalSpaceData["delivery"]): PersonalSpaceData => ({ today: TODAY, timeZone: "Europe/Rome", todos, ...(delivery ? { delivery } : {}) });

function setup(data: PersonalSpaceData, url = "/personal") {
  window.history.replaceState(null, "", url);
  const view = render(<PersonalSpace initial={data} projects={[]} />, { wrapper: TooltipProvider });
  const serverSends = (next: PersonalSpaceData) => view.rerender(<PersonalSpace initial={next} projects={[]} />);
  return { user: userEvent.setup(), serverSends };
}
const panel = () => screen.getByRole("complementary", { name: "To-do details" });
const banner = () => screen.queryByText(/^Reminders (are off|can't be sent)/);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  for (const action of [createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction]) action.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the wording", () => {
  it("names each failure in plain words, a network give-up apart from a refusal", () => {
    expect(FAILURE_TEXT.telegram_rejected).toBe("Telegram refused it. Check the bot settings.");
    expect(FAILURE_TEXT.gave_up).toBe("Telegram couldn't be reached all day.");
    expect(new Set(Object.values(FAILURE_TEXT)).size).toBe(4);
  });

  it("explains failed and skipped Reminders, and nothing else", () => {
    expect(reminderNote(reminder("failed", "telegram_unauthorized"))).toBe(FAILURE_TEXT.telegram_unauthorized);
    expect(reminderNote(reminder("skipped"))).toBe("Skipped (day had passed)");
    expect(reminderNote(reminder("pending"))).toBeNull();
    expect(reminderNote(reminder("sent"))).toBeNull();
  });

  it("gives the banner texts verbatim, and none while Reminders go out", () => {
    expect(deliveryBanner({ ok: false, reason: "not_configured" })).toBe("Reminders are off: Telegram is not configured.");
    expect(deliveryBanner({ ok: false, reason: "telegram_unauthorized" })).toBe("Reminders can't be sent: the Telegram bot token was rejected.");
    expect(deliveryBanner({ ok: false, reason: "telegram_forbidden" })).toBe("Reminders can't be sent: the bot can't message the chat.");
    expect(deliveryBanner({ ok: true, lastSentAt: "2026-10-17T07:00:00Z" })).toBeNull();
    expect(deliveryBanner(undefined)).toBeNull();
  });
});

describe("the delivery banner", () => {
  it.each([
    ["not_configured", "Reminders are off: Telegram is not configured."],
    ["telegram_unauthorized", "Reminders can't be sent: the Telegram bot token was rejected."],
    ["telegram_forbidden", "Reminders can't be sent: the bot can't message the chat."],
  ] as const)("shows %s above the list", (reason, text) => {
    setup(page([todo()], { ok: false, reason }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("is absent when Reminders go out, or when the API couldn't say", () => {
    setup(page([todo()], { ok: true }));
    expect(banner()).toBeNull();
    setup(page([todo()]));
    expect(banner()).toBeNull();
  });

  it("follows the page's data: it appears and clears with the next refresh", () => {
    const { serverSends } = setup(page([todo()]));
    expect(banner()).toBeNull();
    serverSends(page([todo()], { ok: false, reason: "telegram_forbidden" }));
    expect(screen.getByText("Reminders can't be sent: the bot can't message the chat.")).toBeInTheDocument();
    serverSends(page([todo()], { ok: true }));
    expect(banner()).toBeNull();
  });

  it("is read again by the page's poll", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(page([todo()], { ok: false, reason: "not_configured" })))));
    setup(page([todo()], { ok: true }));
    expect(banner()).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(screen.getByText("Reminders are off: Telegram is not configured.")).toBeInTheDocument();
  });
});

describe("the banner across polls", () => {
  it("survives a poll that couldn't read the delivery state", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(page([todo()])))));
    setup(page([todo()], { ok: false, reason: "telegram_unauthorized" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(screen.getByText("Reminders can't be sent: the Telegram bot token was rejected.")).toBeInTheDocument();
  });
});

describe("Reminder time on a row", () => {
  const timeOf = (title: string) => within(screen.getByText(title).closest("li") as HTMLElement).getByText(/^\d\d:\d\d$/).parentElement as HTMLElement;

  it("shows a failed one red with a crossed bell and a tooltip naming the reason", () => {
    setup(page([todo({ title: "Call the bank", reminder: reminder("failed", "telegram_unauthorized", "17:00") })]));
    const time = timeOf("Call the bank");
    expect(time).toHaveClass("text-destructive");
    expect(time.querySelector(".lucide-bell-off")).not.toBeNull();
    expect(time).toHaveAttribute("title", `Reminder failed to send at 17:00. ${FAILURE_TEXT.telegram_unauthorized}`);
  });

  it("names a network give-up as one, not as a refusal", () => {
    setup(page([todo({ title: "Call the bank", reminder: reminder("failed", "gave_up") })]));
    expect(timeOf("Call the bank").getAttribute("title")).toContain("Telegram couldn't be reached all day.");
  });

  it("shows a skipped one dimmed, saying the day had passed", () => {
    setup(page([todo({ title: "Water the plants", reminder: reminder("skipped") })]));
    const time = timeOf("Water the plants");
    expect(time).toHaveClass("text-muted-foreground/50");
    expect(time).toHaveAttribute("title", `Reminder skipped at 09:00. ${SKIPPED_TEXT}`);
    expect(time.querySelector(".lucide-bell-off")).toBeNull();
  });
});

describe("Reminder in the details panel", () => {
  it.each(Object.entries(FAILURE_TEXT))("says why a %s Reminder failed", (failure, text) => {
    const t = todo({ reminder: reminder("failed", failure as keyof typeof FAILURE_TEXT) });
    setup(page([t]), `/personal?todo=${t.id}`);
    expect(panel()).toHaveTextContent(text);
  });

  it("says a skipped Reminder was skipped", () => {
    const t = todo({ reminder: reminder("skipped") });
    setup(page([t]), `/personal?todo=${t.id}`);
    expect(panel()).toHaveTextContent("Skipped (day had passed)");
  });

  it("says nothing for a pending one", () => {
    const t = todo({ reminder: reminder("pending") });
    setup(page([t]), `/personal?todo=${t.id}`);
    expect(panel()).not.toHaveTextContent(/Telegram|Skipped/);
  });

  it("re-arms a failed Reminder when a new time is set: the failure goes away", async () => {
    const t = todo({ title: "Call the bank", reminder: reminder("failed", "telegram_forbidden", "09:00") });
    updateTodoAction.mockReturnValue(new Promise(() => {}));
    const { user } = setup(page([t]), `/personal?todo=${t.id}`);
    await user.click(within(panel()).getByRole("button", { name: /^Change Reminder/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reminder" })).getByRole("button", { name: "20:30" }));
    expect(updateTodoAction).toHaveBeenCalledWith(t.id, { time: "20:30" }, UPDATED);
    expect(panel()).not.toHaveTextContent(FAILURE_TEXT.telegram_forbidden);
    expect(within(panel()).getByText("20:30").parentElement).toHaveAttribute("data-status", "pending");
  });
});
