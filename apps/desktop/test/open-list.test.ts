import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, Project, Todo } from "../src/api-client";
import { REFRESH_MS, useOpenList } from "../src/open-list";
import { todo } from "./todos";

const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
const offline: ApiResult<never> = {
  ok: false,
  failure: { kind: "offline", reason: "could not connect" },
};

/** A client whose answers the test sets, counting the calls. */
function fakeClient() {
  const answers = {
    todos: ok<Todo[]>([]) as ApiResult<Todo[]>,
    done: ok<Todo[]>([]) as ApiResult<Todo[]>,
    projects: ok<Project[]>([]) as ApiResult<Project[]>,
  };
  const client = {
    listOpenTodos: vi.fn(async () => answers.todos),
    listDoneToday: vi.fn(async (_timeZone: string) => answers.done),
    listProjects: vi.fn(async () => answers.projects),
  };
  return { client, answers };
}

function mount(
  client: ReturnType<typeof fakeClient>["client"],
  shown: boolean,
) {
  return renderHook(
    (props: { shown: boolean }) =>
      useOpenList(client, props.shown, "Europe/Rome"),
    {
      initialProps: { shown },
    },
  );
}

/** Lets the pending fetches settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T12:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("useOpenList", () => {
  it("fetches the To-dos and Projects when shown", async () => {
    const { client, answers } = fakeClient();
    const gym = todo({ title: "Gym" });
    answers.todos = ok([gym]);
    answers.projects = ok([
      { id: "pr_1", key: "TRC", name: "Traccia", status: "active" },
    ]);

    const { result } = mount(client, true);
    await settle();

    expect(result.current.todos).toEqual([gym]);
    expect(result.current.projects.map((p) => p.key)).toEqual(["TRC"]);
    expect(result.current.problem).toBeNull();
  });

  it("fetches today's done To-dos with the open ones, in the Owner timezone", async () => {
    const { client, answers } = fakeClient();
    const gym = todo({ title: "Gym", state: "done" });
    answers.done = ok([gym]);
    const { result } = mount(client, true);
    await settle();
    expect(client.listDoneToday).toHaveBeenCalledWith("Europe/Rome");
    expect(result.current.doneToday).toEqual([gym]);
  });

  it("keeps both last lists when only the done ones can't be fetched", async () => {
    const { client, answers } = fakeClient();
    const swim = todo({ title: "Swim" });
    answers.todos = ok([swim]);
    const { result } = mount(client, true);
    await settle();

    answers.todos = ok([]);
    answers.done = offline;
    await act(async () => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(result.current.todos).toEqual([swim]);
    expect(result.current.problem).toEqual({ kind: "offline" });
  });

  it("makes no calls while hidden", async () => {
    const { client } = fakeClient();
    mount(client, false);
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(5 * REFRESH_MS));
    expect(client.listOpenTodos).not.toHaveBeenCalled();
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it("re-fetches the To-dos every 30 s while shown, and the Projects once per show", async () => {
    const { client } = fakeClient();
    mount(client, true);
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(2 * REFRESH_MS));
    expect(REFRESH_MS).toBe(30_000);
    expect(client.listOpenTodos).toHaveBeenCalledTimes(3);
    expect(client.listProjects).toHaveBeenCalledTimes(1);
  });

  it("stops when hidden and fetches again on the next show", async () => {
    const { client } = fakeClient();
    const { rerender } = mount(client, true);
    await settle();
    rerender({ shown: false });
    await act(async () => vi.advanceTimersByTimeAsync(3 * REFRESH_MS));
    expect(client.listOpenTodos).toHaveBeenCalledTimes(1);

    rerender({ shown: true });
    await settle();
    expect(client.listOpenTodos).toHaveBeenCalledTimes(2);
    expect(client.listProjects).toHaveBeenCalledTimes(2);
  });

  it("fetches on show even while a fetch from the last show is still out", async () => {
    const { client } = fakeClient();
    let release = () => {};
    client.listOpenTodos.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(ok([todo()])))),
    );
    const { rerender, result } = mount(client, true);
    await settle();
    rerender({ shown: false });
    rerender({ shown: true });
    await settle();
    expect(client.listOpenTodos).toHaveBeenCalledTimes(2);

    // The answer to the hidden show's request arrives late and is ignored.
    release();
    await settle();
    expect(result.current.todos).toEqual([]);
  });

  it("keeps the last list when offline, says since when, and clears it on the next success", async () => {
    const { client, answers } = fakeClient();
    const gym = todo({ title: "Gym" });
    answers.todos = ok([gym]);
    const { result } = mount(client, true);
    await settle();
    const fetchedAt = result.current.fetchedAt;
    expect(fetchedAt?.toISOString()).toBe("2026-10-17T12:30:00.000Z");

    answers.todos = offline;
    await act(async () => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(result.current.todos).toEqual([gym]);
    expect(result.current.problem).toEqual({ kind: "offline" });
    expect(result.current.fetchedAt).toEqual(fetchedAt);

    const swim = todo({ title: "Swim" });
    answers.todos = ok([swim]);
    await act(async () => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(result.current.todos).toEqual([swim]);
    expect(result.current.problem).toBeNull();
    expect(result.current.fetchedAt?.toISOString()).toBe(
      "2026-10-17T12:31:00.000Z",
    );
  });

  it("is offline with no list when the first fetch fails", async () => {
    const { client, answers } = fakeClient();
    answers.todos = offline;
    const { result } = mount(client, true);
    await settle();
    expect(result.current.todos).toBeNull();
    expect(result.current.fetchedAt).toBeNull();
    expect(result.current.problem).toEqual({ kind: "offline" });
  });

  it("shows a refused Token with the Settings message", async () => {
    const { client, answers } = fakeClient();
    answers.todos = {
      ok: false,
      failure: {
        kind: "refused",
        status: 401,
        message: "Traccia refused the Token. Open Settings.",
      },
    };
    const { result } = mount(client, true);
    await settle();
    expect(result.current.problem).toEqual({
      kind: "refused",
      message: "Traccia refused the Token. Open Settings.",
    });
  });

  it("keeps the last Projects when they can't be fetched", async () => {
    const { client, answers } = fakeClient();
    answers.projects = ok([
      { id: "pr_1", key: "TRC", name: "Traccia", status: "active" },
    ]);
    const { result, rerender } = mount(client, true);
    await settle();
    rerender({ shown: false });
    answers.projects = offline;
    rerender({ shown: true });
    await settle();
    expect(result.current.projects.map((p) => p.key)).toEqual(["TRC"]);
  });
});
