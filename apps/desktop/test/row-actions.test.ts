import { act, renderHook } from "@testing-library/react";
import type { UpdateTodoInput } from "@traccia/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, Todo } from "../src/api-client";
import { OFFLINE_MESSAGE, TOAST_MS, useRowActions } from "../src/row-actions";
import { todo } from "./todos";

type Answer = (id: string, input: UpdateTodoInput) => ApiResult<Todo>;

/** Answers like the API: the To-do with the patch applied, unless the test sets `answer`. */
function fakeClient(todos: Todo[]) {
  const state = {
    answer: ((id, input) => {
      const found = todos.find((t) => t.id === id) as Todo;
      return {
        ok: true,
        value: { ...found, ...(input.state && { state: input.state }) },
      };
    }) as Answer,
  };
  const client = {
    updateTodo: vi.fn(async (id: string, input: UpdateTodoInput) =>
      state.answer(id, input),
    ),
  };
  return { client, state };
}

const refused = (
  status: number,
  message: string,
  details?: unknown,
): ApiResult<Todo> => ({
  ok: false,
  failure: {
    kind: "error",
    status,
    code: status === 409 ? "conflict" : "internal",
    message,
    ...(details !== undefined && { details }),
  },
});

type Props = { todos: Todo[] | null; shown: boolean; offline: boolean };

function mount(client: ReturnType<typeof fakeClient>["client"], props: Props) {
  return renderHook((p: Props) => useRowActions(client, p), {
    initialProps: props,
  });
}

const settle = () => act(async () => {});
const stateOf = (todos: Todo[] | null, id: string) =>
  todos?.find((t) => t.id === id)?.state;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useRowActions", () => {
  it("marks a To-do done at once, and keeps it done over the list from before a hide", async () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const list = [gym];
    const { result, rerender } = mount(client, {
      todos: list,
      shown: true,
      offline: false,
    });

    act(() => result.current.toggle(gym.id));
    expect(stateOf(result.current.todos, gym.id)).toBe("done");
    await settle();
    expect(client.updateTodo).toHaveBeenCalledWith(gym.id, { state: "done" });

    // Hidden and shown again, it stays done before the next fetch replaces the list from before.
    rerender({ todos: list, shown: false, offline: false });
    rerender({ todos: list, shown: true, offline: false });
    expect(result.current.todos?.map((t) => [t.id, t.state])).toEqual([
      [gym.id, "done"],
    ]);

    // A later fetch is the truth again: reopened elsewhere, it is back.
    rerender({ todos: [gym], shown: true, offline: false });
    expect(stateOf(result.current.todos, gym.id)).toBe("open");
  });

  it("keeps a closed row closed across a second hide before any new fetch", async () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const list = [gym];
    const { result, rerender } = mount(client, {
      todos: list,
      shown: true,
      offline: false,
    });
    act(() => result.current.toggle(gym.id));
    await settle();
    for (const shown of [false, true, false, true])
      rerender({ todos: list, shown, offline: false });
    expect(stateOf(result.current.todos, gym.id)).toBe("done");
  });

  it("keeps a row reopened from the shelf open over the list from before a hide", async () => {
    const gym = todo({ title: "Gym", state: "done" });
    const { client } = fakeClient([gym]);
    const list = [gym];
    const { result, rerender } = mount(client, {
      todos: list,
      shown: true,
      offline: false,
    });
    act(() => result.current.toggle(gym.id));
    await settle();
    expect(client.updateTodo).toHaveBeenCalledWith(gym.id, { state: "open" });
    rerender({ todos: list, shown: false, offline: false });
    rerender({ todos: list, shown: true, offline: false });
    expect(stateOf(result.current.todos, gym.id)).toBe("open");
  });

  it("keeps a closed row through a re-fetch that no longer lists it", async () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const { result, rerender } = mount(client, {
      todos: [gym],
      shown: true,
      offline: false,
    });

    act(() => result.current.toggle(gym.id));
    await settle();
    rerender({ todos: [], shown: true, offline: false });
    expect(stateOf(result.current.todos, gym.id)).toBe("done");
  });

  it("reopens a closed row from its check", async () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const { result } = mount(client, {
      todos: [gym],
      shown: true,
      offline: false,
    });
    act(() => result.current.toggle(gym.id));
    await settle();
    act(() => result.current.toggle(gym.id));
    await settle();
    expect(client.updateTodo).toHaveBeenLastCalledWith(gym.id, {
      state: "open",
    });
    expect(stateOf(result.current.todos, gym.id)).toBe("open");
  });

  describe("closing a parent with open Sub-to-dos", () => {
    const parent = todo({ id: "td_parent", title: "Trip" });
    const pack = todo({ id: "td_pack", title: "Pack", parentId: parent.id });
    const book = todo({ id: "td_book", title: "Book", parentId: parent.id });
    const list = [parent, pack, book];

    /** 409 until `closeSubTodos: true`, like the API (docs/personal-space.md §4). */
    function cascadingClient() {
      const fake = fakeClient(list);
      fake.state.answer = (id, input) =>
        id === parent.id && input.state !== "open" && !input.closeSubTodos
          ? refused(409, "To-do has 2 open Sub-to-dos", { openSubTodos: 2 })
          : { ok: true, value: { ...parent, state: input.state ?? "open" } };
      return fake;
    }

    it("asks first, then Yes closes all three", async () => {
      const { client } = cascadingClient();
      const { result } = mount(client, {
        todos: list,
        shown: true,
        offline: false,
      });

      act(() => result.current.toggle(parent.id));
      // Nothing struck while the API decides.
      expect(stateOf(result.current.todos, parent.id)).toBe("open");
      await settle();
      expect(result.current.confirm).toEqual({
        id: parent.id,
        count: 2,
        state: "done",
      });
      expect(stateOf(result.current.todos, parent.id)).toBe("open");

      act(() => result.current.confirmCascade());
      expect(result.current.confirm).toBeNull();
      expect(result.current.todos?.map((t) => t.state)).toEqual([
        "done",
        "done",
        "done",
      ]);
      await settle();
      expect(client.updateTodo).toHaveBeenLastCalledWith(parent.id, {
        state: "done",
        closeSubTodos: true,
      });
      expect(result.current.todos?.map((t) => t.state)).toEqual([
        "done",
        "done",
        "done",
      ]);
    });

    it("Cancel does nothing", async () => {
      const { client } = cascadingClient();
      const { result } = mount(client, {
        todos: list,
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(parent.id));
      await settle();
      expect(result.current.confirm?.state).toBe("dropped");
      expect(result.current.toast).toBeNull();
      act(() => result.current.cancelCascade());
      expect(result.current.confirm).toBeNull();
      expect(client.updateTodo).toHaveBeenCalledTimes(1);
      expect(result.current.todos?.map((t) => t.state)).toEqual([
        "open",
        "open",
        "open",
      ]);
    });

    it("keeps another row's drop toast while it asks", async () => {
      const gym = todo({ title: "Gym" });
      const { client, state } = cascadingClient();
      const answer = state.answer;
      state.answer = (id, input) =>
        id === gym.id
          ? { ok: true, value: { ...gym, state: "dropped" } }
          : answer(id, input);
      const { result } = mount(client, {
        todos: [...list, gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(gym.id));
      await settle();
      act(() => result.current.toggle(parent.id));
      await settle();
      expect(result.current.confirm?.id).toBe(parent.id);
      expect(result.current.toast).toEqual({
        text: "Dropped “Gym”",
        canUndo: true,
      });
    });

    it("asks too when the 409 comes for Sub-to-dos the list didn't have", async () => {
      const { client } = cascadingClient();
      const { result } = mount(client, {
        todos: [parent],
        shown: true,
        offline: false,
      });
      act(() => result.current.toggle(parent.id));
      expect(stateOf(result.current.todos, parent.id)).toBe("done");
      await settle();
      // Put back, and asked.
      expect(stateOf(result.current.todos, parent.id)).toBe("open");
      expect(result.current.confirm?.count).toBe(2);
    });

    it("Undo after a cascading drop reopens the parent, then its Sub-to-dos", async () => {
      const { client } = cascadingClient();
      const { result } = mount(client, {
        todos: list,
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(parent.id));
      await settle();
      act(() => result.current.confirmCascade());
      await settle();
      expect(result.current.toast).toEqual({
        text: "Dropped “Trip”",
        canUndo: true,
      });

      act(() => result.current.undo());
      await settle();
      expect(client.updateTodo.mock.calls.slice(2)).toEqual([
        [parent.id, { state: "open" }],
        [pack.id, { state: "open" }],
        [book.id, { state: "open" }],
      ]);
      expect(result.current.todos?.map((t) => t.state)).toEqual([
        "open",
        "open",
        "open",
      ]);
      expect(result.current.toast).toBeNull();
    });
  });

  describe("dropping", () => {
    it("shows a 5 s toast whose Undo reopens the To-do", async () => {
      const gym = todo({
        title: "Gym @TRC",
        references: [{ key: "TRC", projectId: "pr_1", projectDeleted: false }],
      });
      const { client } = fakeClient([gym]);
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });

      act(() => result.current.drop(gym.id));
      expect(stateOf(result.current.todos, gym.id)).toBe("dropped");
      expect(result.current.toast).toEqual({
        text: "Dropped “Gym”",
        canUndo: true,
      });
      await settle();
      expect(client.updateTodo).toHaveBeenCalledWith(gym.id, {
        state: "dropped",
      });

      act(() => result.current.undo());
      expect(stateOf(result.current.todos, gym.id)).toBe("open");
      await settle();
      expect(client.updateTodo).toHaveBeenLastCalledWith(gym.id, {
        state: "open",
      });
      expect(stateOf(result.current.todos, gym.id)).toBe("open");
    });

    it("lets the toast go after 5 s, and Undo with it", async () => {
      const gym = todo({ title: "Gym" });
      const { client } = fakeClient([gym]);
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(gym.id));
      await settle();
      act(() => vi.advanceTimersByTime(TOAST_MS - 1));
      expect(result.current.toast).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.toast).toBeNull();
      act(() => result.current.undo());
      expect(client.updateTodo).toHaveBeenCalledTimes(1);
      expect(stateOf(result.current.todos, gym.id)).toBe("dropped");
    });

    it("leaves a closed row alone", async () => {
      const gym = todo({ title: "Gym", state: "done" });
      const { client } = fakeClient([gym]);
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(gym.id));
      expect(client.updateTodo).not.toHaveBeenCalled();
    });
  });

  describe("a refused write", () => {
    it("puts the row back with an error toast", async () => {
      const gym = todo({ title: "Gym" });
      const { client, state } = fakeClient([gym]);
      state.answer = () => refused(500, "Something broke");
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });

      act(() => result.current.toggle(gym.id));
      expect(stateOf(result.current.todos, gym.id)).toBe("done");
      await settle();
      expect(stateOf(result.current.todos, gym.id)).toBe("open");
      expect(result.current.toast).toEqual({
        text: "Not saved. Something broke",
        canUndo: false,
      });
    });

    it("replaces a drop's toast, so there is nothing to undo", async () => {
      const gym = todo({ title: "Gym" });
      const { client, state } = fakeClient([gym]);
      state.answer = () => ({
        ok: false,
        failure: { kind: "offline", reason: "timeout" },
      });
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(gym.id));
      await settle();
      expect(stateOf(result.current.todos, gym.id)).toBe("open");
      expect(result.current.toast).toEqual({
        text: OFFLINE_MESSAGE,
        canUndo: false,
      });
    });

    it("rolls back a failed Undo", async () => {
      const gym = todo({ title: "Gym" });
      const { client, state } = fakeClient([gym]);
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.drop(gym.id));
      await settle();
      state.answer = () => refused(500, "Something broke");
      act(() => result.current.undo());
      await settle();
      expect(stateOf(result.current.todos, gym.id)).toBe("dropped");
      expect(result.current.toast?.text).toBe("Not saved. Something broke");
    });

    it("doesn't undo a later click when an earlier answer comes back", async () => {
      const gym = todo({ title: "Gym" });
      const { client } = fakeClient([gym]);
      let answerFirst: (r: ApiResult<Todo>) => void = () => {};
      client.updateTodo.mockImplementationOnce(
        () => new Promise((resolve) => (answerFirst = resolve)),
      );
      const { result } = mount(client, {
        todos: [gym],
        shown: true,
        offline: false,
      });
      act(() => result.current.toggle(gym.id)); // done, answer held back
      act(() => result.current.toggle(gym.id)); // open again
      await settle();
      await act(async () => answerFirst(refused(500, "late")));
      expect(stateOf(result.current.todos, gym.id)).toBe("open");
      expect(result.current.toast).toBeNull();
    });
  });

  it("writes nothing while offline, and says so", () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const { result } = mount(client, {
      todos: [gym],
      shown: true,
      offline: true,
    });
    act(() => result.current.toggle(gym.id));
    act(() => result.current.drop(gym.id));
    expect(client.updateTodo).not.toHaveBeenCalled();
    expect(stateOf(result.current.todos, gym.id)).toBe("open");
    expect(result.current.toast).toEqual({
      text: OFFLINE_MESSAGE,
      canUndo: false,
    });
  });

  it("forgets the confirm and the toast when the window hides", async () => {
    const gym = todo({ title: "Gym" });
    const { client } = fakeClient([gym]);
    const { result, rerender } = mount(client, {
      todos: [gym],
      shown: true,
      offline: false,
    });
    act(() => result.current.drop(gym.id));
    await settle();
    rerender({ todos: [gym], shown: false, offline: false });
    expect(result.current.toast).toBeNull();
    expect(result.current.confirm).toBeNull();
  });
});
