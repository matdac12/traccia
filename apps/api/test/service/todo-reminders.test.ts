import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { code, setupServices } from "./helpers.js";

// The clock is fixed with fake timers, as in the other service tests. Europe/Rome
// is UTC+2 until 03:00 on 2026-10-25 and UTC+1 after, then UTC+2 again from
// 02:00 on 2027-03-28.
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-17T10:00:00.000Z"); // Saturday 12:00 in Rome
});
afterEach(() => vi.useRealTimers());

/**
 * The fields a `validation_error` names: the service's own errors carry
 * `details.fields`, a schema failure carries the Zod issues (REST turns those
 * into `fields` too).
 */
const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    const details = (e as { details?: unknown }).details;
    if (Array.isArray(details)) {
      return Object.fromEntries(
        details.map((i: { path: string[]; message: string }) => [
          i.path.join("."),
          [i.message],
        ]),
      );
    }
    return (details as { fields?: Record<string, string[]> } | undefined)
      ?.fields;
  }
  return undefined;
};

describe("todos.create with a Reminder", () => {
  it("turns remindAt into the day and time in the Owner timezone", () => {
    const { services } = setupServices();
    const todo = services.todos.create("you", "parla", {
      title: "Call the bank",
      remindAt: "2026-10-18T15:00:00+02:00",
    });
    expect(todo.day).toBe("2026-10-18");
    expect(todo.reminder).toEqual({
      time: "15:00",
      status: "pending",
      failure: null,
      sentAt: null,
    });
  });

  it("reads remindAt in any offset and drops the seconds", () => {
    const { services } = setupServices();
    const create = (remindAt: string) =>
      services.todos.create("you", "t", { title: "x", remindAt });
    expect(create("2026-10-18T13:00:00Z")).toMatchObject({
      day: "2026-10-18",
      reminder: { time: "15:00" },
    });
    expect(create("2026-10-18T09:00:59+02:00").reminder?.time).toBe("09:00");
    // 23:30 UTC is already the next day in Rome.
    expect(create("2026-10-18T23:30:00Z")).toMatchObject({
      day: "2026-10-19",
      reminder: { time: "01:30" },
    });
  });

  it("converts across the October change (Rome leaves summer time on 2026-10-25)", () => {
    const { services } = setupServices();
    const create = (remindAt: string) =>
      services.todos.create("you", "t", { title: "x", remindAt });
    const wall = (t: {
      day: string | null;
      reminder: { time: string } | null;
    }) => `${t.day} ${t.reminder?.time}`;
    // Summer time (+02:00), the day before and just after midnight.
    expect(wall(create("2026-10-24T12:00:00+02:00"))).toBe("2026-10-24 12:00");
    expect(wall(create("2026-10-24T22:30:00Z"))).toBe("2026-10-25 00:30");
    // 02:30 happens twice that night: 00:30Z is the first, 01:30Z the second.
    expect(wall(create("2026-10-25T00:30:00Z"))).toBe("2026-10-25 02:30");
    expect(wall(create("2026-10-25T01:30:00Z"))).toBe("2026-10-25 02:30");
    // Winter time (+01:00) afterwards.
    expect(wall(create("2026-10-25T12:00:00+01:00"))).toBe("2026-10-25 12:00");
    expect(wall(create("2026-10-25T02:00:00Z"))).toBe("2026-10-25 03:00");
  });

  it("converts across the March change (Rome enters summer time on 2027-03-28)", () => {
    at("2027-03-27T10:00:00.000Z");
    const { services } = setupServices();
    const create = (remindAt: string) =>
      services.todos.create("you", "t", { title: "x", remindAt });
    const wall = (t: {
      day: string | null;
      reminder: { time: string } | null;
    }) => `${t.day} ${t.reminder?.time}`;
    expect(wall(create("2027-03-28T00:59:00Z"))).toBe("2027-03-28 01:59");
    // 01:00Z is 03:00 in Rome: 02:xx does not exist that day.
    expect(wall(create("2027-03-28T01:00:00Z"))).toBe("2027-03-28 03:00");
    expect(wall(create("2027-03-28T12:00:00+02:00"))).toBe("2027-03-28 12:00");
    expect(wall(create("2027-03-27T23:30:00Z"))).toBe("2027-03-28 00:30");
  });

  it("uses today for a time without a day, in the Owner timezone", () => {
    const { services } = setupServices();
    at("2026-10-17T21:30:00.000Z"); // 23:30 in Rome
    expect(
      services.todos.create("you", "t", { title: "x", time: "23:45" }),
    ).toMatchObject({ day: "2026-10-17", reminder: { time: "23:45" } });
    at("2026-10-17T22:30:00.000Z"); // 00:30 on the 18th in Rome, still the 17th in UTC
    expect(
      services.todos.create("you", "t", { title: "x", time: "09:00" }),
    ).toMatchObject({ day: "2026-10-18", reminder: { time: "09:00" } });
  });

  it("puts a To-do made with a time but no day in today's bucket", () => {
    const { services } = setupServices();
    const first = services.todos.create("you", "t", {
      title: "a",
      day: "2026-10-17",
    });
    const second = services.todos.create("you", "t", {
      title: "b",
      time: "18:00",
    });
    expect(second.position).toBeGreaterThan(first.position);
  });

  it("takes a time on a given day, and a Sub-to-do can have its own Reminder", () => {
    const { services } = setupServices();
    const parent = services.todos.create("you", "t", { title: "Trip" });
    const sub = services.todos.create("you", "t", {
      title: "Book train",
      day: "2026-10-20",
      time: "09:00",
      parentId: parent.id,
    });
    expect(sub).toMatchObject({
      day: "2026-10-20",
      parentId: parent.id,
      reminder: { time: "09:00", status: "pending" },
    });
  });

  it("refuses time together with remindAt", () => {
    const { services } = setupServices();
    expect(
      fieldsOf(() =>
        services.todos.create("you", "t", {
          title: "x",
          time: "15:00",
          remindAt: "2026-10-18T15:00:00+02:00",
        }),
      ),
    ).toHaveProperty("remindAt");
  });

  it("refuses a malformed time or remindAt, and a time with day null", () => {
    const { services } = setupServices();
    const create = (input: object) => () =>
      services.todos.create("you", "t", { title: "x", ...input });
    for (const time of ["24:00", "9:00", "12:60", "noon", "12:00:00"]) {
      expect(fieldsOf(create({ day: "2026-10-20", time }))).toHaveProperty(
        "time",
      );
    }
    for (const remindAt of [
      "2026-10-18T15:00:00", // no offset
      "2026-10-18",
      "tomorrow at three",
    ]) {
      expect(fieldsOf(create({ remindAt }))).toHaveProperty("remindAt");
    }
    expect(fieldsOf(create({ day: null, time: "09:00" }))).toHaveProperty(
      "time",
    );
  });

  it("lets day accompany remindAt only when they agree", () => {
    const { services } = setupServices();
    const create = (day: string | null) => () =>
      services.todos.create("you", "t", {
        title: "x",
        day,
        remindAt: "2026-10-18T15:00:00+02:00",
      });
    expect(code(create("2026-10-18"))).toBeUndefined();
    expect(fieldsOf(create("2026-10-19"))).toHaveProperty("day");
    expect(fieldsOf(create(null))).toHaveProperty("day");
  });

  it("refuses a moment that is not in the future, and writes nothing", () => {
    const { services } = setupServices();
    const create = (input: object) => () =>
      services.todos.create("you", "t", { title: "x", ...input });
    // Now is 2026-10-17 12:00 in Rome.
    expect(
      fieldsOf(create({ remindAt: "2026-10-17T11:59:00+02:00" })),
    ).toHaveProperty("remindAt");
    expect(
      fieldsOf(create({ remindAt: "2026-10-17T12:00:00+02:00" })),
    ).toHaveProperty("remindAt");
    expect(code(create({ remindAt: "2026-10-17T12:01:00+02:00" }))).toBe(
      undefined,
    );
    expect(fieldsOf(create({ time: "09:00" }))).toHaveProperty("time");
    expect(
      fieldsOf(create({ day: "2026-10-16", time: "23:00" })),
    ).toHaveProperty("time");
    expect(code(create({ day: "2026-10-16" }))).toBeUndefined(); // no Reminder: any day
    expect(services.todos.list({ state: "open" }).items).toHaveLength(2);
  });

  it("checks the future moment on the DST days", () => {
    const { services } = setupServices();
    const create = (day: string, time: string) => () =>
      services.todos.create("you", "t", { title: "x", day, time });
    // 02:45 summer time on 2026-10-25, 02:50 happens at 00:50Z (first) and 01:50Z.
    at("2026-10-25T00:55:00.000Z");
    expect(fieldsOf(create("2026-10-25", "02:50"))).toHaveProperty("time"); // first 02:50 was 5 min ago
    expect(code(create("2026-10-25", "03:00"))).toBeUndefined(); // 03:00 winter time, 02:00Z
    // 01:45 winter time on 2027-03-28; 02:30 does not exist and reads as 03:30.
    at("2027-03-28T00:45:00.000Z");
    expect(code(create("2027-03-28", "02:30"))).toBeUndefined();
    at("2027-03-28T01:15:00.000Z"); // 03:15 in Rome
    expect(code(create("2027-03-28", "02:30"))).toBeUndefined(); // = 03:30, 15 min ahead
    expect(fieldsOf(create("2027-03-28", "03:10"))).toHaveProperty("time");
  });
});

describe("todos.update with a Reminder", () => {
  const sentReminder = (
    sqlite: ReturnType<typeof setupServices>["sqlite"],
    id: string,
  ) =>
    sqlite
      .prepare(
        `UPDATE todos SET reminder_status = 'sent', reminder_sent_at = '2026-10-20T07:00:00.000Z',
           reminder_attempts = 2, reminder_next_attempt_at = '2026-10-20T07:10:00.000Z',
           reminder_failure = 'gave_up' WHERE id = ?`,
      )
      .run(id);
  const columns = (
    sqlite: ReturnType<typeof setupServices>["sqlite"],
    id: string,
  ) =>
    sqlite
      .prepare(
        `SELECT reminder_time, reminder_status, reminder_sent_at, reminder_attempts,
                reminder_next_attempt_at, reminder_failure FROM todos WHERE id = ?`,
      )
      .get(id);
  const PENDING = {
    reminder_time: "09:00",
    reminder_status: "pending",
    reminder_sent_at: null,
    reminder_attempts: 0,
    reminder_next_attempt_at: null,
    reminder_failure: null,
  };

  const withReminder = (
    services: ReturnType<typeof setupServices>["services"],
    day = "2026-10-20", // Tuesday
  ) =>
    services.todos.create("you", "t", {
      title: "Pay rent",
      day,
      time: "09:00",
    });

  it("moving the day keeps the time and re-arms a sent Reminder", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    sentReminder(sqlite, todo.id);
    const moved = services.todos.update(todo.id, { day: "2026-10-22" }); // Thursday
    expect(moved.day).toBe("2026-10-22");
    expect(moved.reminder).toEqual({
      time: "09:00",
      status: "pending",
      failure: null,
      sentAt: null,
    });
    expect(columns(sqlite, todo.id)).toEqual(PENDING);
  });

  it("re-validates the moment when the day moves, and writes nothing", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    sentReminder(sqlite, todo.id);
    const before = columns(sqlite, todo.id);
    // Today at 09:00 has passed (now is 12:00 in Rome).
    expect(
      fieldsOf(() => services.todos.update(todo.id, { day: "2026-10-17" })),
    ).toHaveProperty("day");
    expect(
      fieldsOf(() => services.todos.update(todo.id, { day: "2026-10-01" })),
    ).toHaveProperty("day");
    expect(columns(sqlite, todo.id)).toEqual(before);
    expect(services.todos.get(todo.id).day).toBe("2026-10-20");
    // A later time today is fine.
    expect(
      services.todos.update(todo.id, { day: "2026-10-17", time: "18:00" })
        .reminder,
    ).toMatchObject({ time: "18:00", status: "pending" });
  });

  it("sets and changes the time, re-arming it, and refuses a past one", () => {
    const { services, sqlite } = setupServices();
    const todo = services.todos.create("you", "t", {
      title: "x",
      day: "2026-10-20",
    });
    expect(
      services.todos.update(todo.id, { time: "09:00" }).reminder,
    ).toMatchObject({ time: "09:00", status: "pending" });
    sentReminder(sqlite, todo.id);
    expect(services.todos.update(todo.id, { time: "10:30" }).reminder).toEqual({
      time: "10:30",
      status: "pending",
      failure: null,
      sentAt: null,
    });
    expect(columns(sqlite, todo.id)).toEqual({
      ...PENDING,
      reminder_time: "10:30",
    });
    // Today, earlier than now.
    expect(
      fieldsOf(() =>
        services.todos.update(todo.id, { day: "2026-10-17", time: "11:00" }),
      ),
    ).toHaveProperty("time");
    // The To-do's own day is in the past: a new time there is past too.
    const overdue = services.todos.create("you", "t", {
      title: "y",
      day: "2026-10-10",
    });
    expect(
      fieldsOf(() => services.todos.update(overdue.id, { time: "09:00" })),
    ).toHaveProperty("time");
  });

  it("a time on an undated To-do sets the day to today and moves it to that bucket", () => {
    const { services } = setupServices();
    const today = services.todos.create("you", "t", {
      title: "a",
      day: "2026-10-17",
    });
    const todo = services.todos.create("you", "t", { title: "b" });
    const updated = services.todos.update(todo.id, { time: "18:00" });
    expect(updated).toMatchObject({
      day: "2026-10-17",
      reminder: { time: "18:00", status: "pending" },
    });
    expect(updated.position).toBeGreaterThan(today.position);
  });

  it("time: null removes the Reminder and keeps the day", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    sentReminder(sqlite, todo.id);
    const updated = services.todos.update(todo.id, { time: null });
    expect(updated).toMatchObject({ day: "2026-10-20", reminder: null });
    expect(columns(sqlite, todo.id)).toEqual({
      reminder_time: null,
      reminder_status: null,
      reminder_sent_at: null,
      reminder_attempts: 0,
      reminder_next_attempt_at: null,
      reminder_failure: null,
    });
    // Nothing to remove the second time: no change, no new updatedAt.
    vi.setSystemTime(new Date("2026-10-17T10:00:05.000Z"));
    expect(services.todos.update(todo.id, { time: null }).updatedAt).toBe(
      updated.updatedAt,
    );
  });

  it("moving to Anytime removes the Reminder", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    const updated = services.todos.update(todo.id, { day: null });
    expect(updated).toMatchObject({ day: null, reminder: null });
    expect(columns(sqlite, todo.id)).toMatchObject({
      reminder_time: null,
      reminder_status: null,
    });
  });

  it("refuses day: null together with a time", () => {
    const { services } = setupServices();
    const todo = withReminder(services);
    expect(
      fieldsOf(() =>
        services.todos.update(todo.id, { day: null, time: "10:00" }),
      ),
    ).toHaveProperty("time");
    expect(services.todos.get(todo.id).day).toBe("2026-10-20");
  });

  it("counts a body with only a time as a change, and refuses a malformed one", () => {
    const { services } = setupServices();
    const todo = withReminder(services);
    expect(code(() => services.todos.update(todo.id, {}))).toBe(
      "validation_error",
    );
    expect(
      fieldsOf(() => services.todos.update(todo.id, { time: "25:00" })),
    ).toHaveProperty("time");
  });

  it("moving the day of a To-do without a Reminder checks no moment", () => {
    const { services } = setupServices();
    const todo = services.todos.create("you", "t", {
      title: "x",
      day: "2026-10-20",
    });
    expect(
      services.todos.update(todo.id, { day: "2026-10-01" }).reminder,
    ).toBeNull();
  });

  it("title and Details edits, and the same time or day, leave the Reminder alone", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    sentReminder(sqlite, todo.id);
    const sent = columns(sqlite, todo.id);
    services.todos.update(todo.id, { title: "Pay the rent", details: "x" });
    services.todos.update(todo.id, { time: "09:00", day: "2026-10-20" });
    expect(columns(sqlite, todo.id)).toEqual(sent);
    // A past Planned day with an unchanged moment is not re-validated either.
    at("2026-10-21T10:00:00.000Z");
    services.todos.update(todo.id, { title: "Pay it", time: "09:00" });
    expect(columns(sqlite, todo.id)).toEqual(sent);
  });

  it("closing leaves the Reminder as it is", () => {
    const { services, sqlite } = setupServices();
    const todo = withReminder(services);
    const done = services.todos.update(todo.id, { state: "done" });
    expect(done.reminder).toMatchObject({ time: "09:00", status: "pending" });
    expect(columns(sqlite, todo.id)).toEqual(PENDING);
  });

  describe("reopening", () => {
    it("skips a pending Reminder whose moment has passed", () => {
      const { services } = setupServices();
      const todo = withReminder(services);
      services.todos.update(todo.id, { state: "dropped" });
      at("2026-10-20T07:00:00.000Z"); // 09:00 in Rome, on the dot
      const reopened = services.todos.update(todo.id, { state: "open" });
      expect(reopened.reminder).toEqual({
        time: "09:00",
        status: "skipped",
        failure: null,
        sentAt: null,
      });
    });

    it("clears a retry that was waiting when it skips", () => {
      const { services, sqlite } = setupServices();
      const todo = withReminder(services);
      sqlite
        .prepare(
          `UPDATE todos SET reminder_attempts = 1, reminder_next_attempt_at = '2026-10-20T07:00:30.000Z' WHERE id = ?`,
        )
        .run(todo.id);
      services.todos.update(todo.id, { state: "done" });
      at("2026-10-21T10:00:00.000Z");
      services.todos.update(todo.id, { state: "open" });
      expect(columns(sqlite, todo.id)).toMatchObject({
        reminder_status: "skipped",
        reminder_next_attempt_at: null,
      });
    });

    it("keeps a pending Reminder whose moment is still ahead", () => {
      const { services } = setupServices();
      const todo = withReminder(services);
      services.todos.update(todo.id, { state: "done" });
      at("2026-10-20T06:59:00.000Z");
      expect(
        services.todos.update(todo.id, { state: "open" }).reminder?.status,
      ).toBe("pending");
    });

    it("leaves a sent, failed or skipped Reminder as it was", () => {
      const { services, sqlite } = setupServices();
      for (const status of ["sent", "failed", "skipped"]) {
        const todo = withReminder(services);
        sqlite
          .prepare("UPDATE todos SET reminder_status = ? WHERE id = ?")
          .run(status, todo.id);
        services.todos.update(todo.id, { state: "done" });
        at("2026-10-21T10:00:00.000Z");
        expect(
          services.todos.update(todo.id, { state: "open" }).reminder?.status,
        ).toBe(status);
        at("2026-10-17T10:00:00.000Z");
      }
    });

    it("reopening and moving to a later day in one patch re-arms it", () => {
      const { services } = setupServices();
      const todo = withReminder(services);
      services.todos.update(todo.id, { state: "done" });
      at("2026-10-21T10:00:00.000Z");
      expect(
        services.todos.update(todo.id, { state: "open", day: "2026-10-23" })
          .reminder,
      ).toMatchObject({ time: "09:00", status: "pending" });
    });

    it("reopening with a new time and day checks that moment, not the old one", () => {
      const { services } = setupServices();
      const todo = withReminder(services);
      services.todos.update(todo.id, { state: "done" });
      at("2026-10-21T10:00:00.000Z"); // 12:00 on the 21st; the old moment is past
      expect(
        fieldsOf(() =>
          services.todos.update(todo.id, { state: "open", time: "07:30" }),
        ),
      ).toHaveProperty("time"); // still on the 20th
      expect(services.todos.get(todo.id).state).toBe("done");
      expect(
        services.todos.update(todo.id, {
          state: "open",
          day: "2026-10-23",
          time: "07:30",
        }).reminder,
      ).toMatchObject({ time: "07:30", status: "pending" });
    });

    it("skips on the October change day by the first occurrence of a repeated time", () => {
      const { services } = setupServices();
      const todo = services.todos.create("you", "t", {
        title: "x",
        day: "2026-10-25",
        time: "02:50",
      });
      services.todos.update(todo.id, { state: "done" });
      at("2026-10-25T00:55:00.000Z"); // 02:55 summer time: the first 02:50 has passed
      expect(
        services.todos.update(todo.id, { state: "open" }).reminder?.status,
      ).toBe("skipped");
    });
  });

  it("closeSubTodos leaves their Reminders alone, and a Sub-to-do reopens by the same rule", () => {
    const { services, sqlite } = setupServices();
    const parent = services.todos.create("you", "t", { title: "Trip" });
    const sub = services.todos.create("you", "t", {
      title: "Book train",
      day: "2026-10-20",
      time: "09:00",
      parentId: parent.id,
    });
    services.todos.update(parent.id, { state: "done", closeSubTodos: true });
    expect(services.todos.get(sub.id)).toMatchObject({
      state: "done",
      reminder: { time: "09:00", status: "pending" },
    });
    expect(columns(sqlite, sub.id)).toEqual(PENDING);
    at("2026-10-20T08:00:00.000Z");
    expect(
      services.todos.update(sub.id, { state: "open" }).reminder?.status,
    ).toBe("skipped");
  });
});
