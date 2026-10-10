// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Memory, ProjectDocument } from "../lib/api/schemas";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const act = { createMemoryAction: vi.fn(), updateMemoryAction: vi.fn(), deleteMemoryAction: vi.fn(), restoreDocumentationAction: vi.fn(), deleteDocumentAction: vi.fn(), updateDocumentAction: vi.fn() };
vi.mock("@/app/(app)/projects/[id]/documentation/actions", () => ({
  createMemoryAction: (...a: unknown[]) => act.createMemoryAction(...a),
  updateMemoryAction: (...a: unknown[]) => act.updateMemoryAction(...a),
  deleteMemoryAction: (...a: unknown[]) => act.deleteMemoryAction(...a),
  restoreDocumentationAction: (...a: unknown[]) => act.restoreDocumentationAction(...a),
  deleteDocumentAction: (...a: unknown[]) => act.deleteDocumentAction(...a),
  updateDocumentAction: (...a: unknown[]) => act.updateDocumentAction(...a),
}));

const { MemoriesView } = await import("../components/documentation/memories-view");
const { FilesView } = await import("../components/documentation/files-view");

const memory: Memory = { id: "M1", projectId: "p1", title: "Use pnpm", body: "Run **pnpm** only", tags: ["tooling"], createdBy: "agent", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
const doc: ProjectDocument = { id: "D1", projectId: "p1", filename: "spec.pdf", mimeType: "application/pdf", sizeBytes: 2048, description: "The spec", createdBy: "you", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };

describe("MemoriesView", () => {
  it("lists memories with tags, links tag filters and shows an empty state", () => {
    const { rerender } = render(<MemoriesView projectId="p1" memories={[memory]} tags={["tooling"]} activeTag="" query="" />);
    expect(screen.getByText("Use pnpm")).toBeInTheDocument();
    expect(screen.getAllByText("tooling").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "tooling" })).toHaveAttribute("href", "/projects/p1/documentation?tag=tooling");
    rerender(<MemoriesView projectId="p1" memories={[]} tags={[]} activeTag="" query="" />);
    expect(screen.getByText("No memories yet")).toBeInTheDocument();
    rerender(<MemoriesView projectId="p1" memories={[]} tags={[]} activeTag="" query="zzz" />);
    expect(screen.getByText("No matching memories")).toBeInTheDocument();
  });

  it("creates a memory from the dialog", async () => {
    act.createMemoryAction.mockResolvedValue({ ok: true, data: undefined });
    render(<MemoriesView projectId="p1" memories={[]} tags={[]} activeTag="" query="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /New memory/ }));
    await user.type(screen.getByLabelText("Title"), "Fact");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.type(screen.getByLabelText("Tags"), "a, b");
    await user.click(screen.getByRole("button", { name: "Create memory" }));
    expect(act.createMemoryAction).toHaveBeenCalledWith("p1", { title: "Fact", body: "Body", tags: ["a", "b"] });
    expect(refresh).toHaveBeenCalled();
  });

  it("opens a memory, edits it with the last-seen updatedAt, and shows a conflict", async () => {
    act.updateMemoryAction.mockResolvedValue({ ok: false, error: "x", fieldErrors: {}, conflict: true });
    render(<MemoriesView projectId="p1" memories={[memory]} tags={[]} activeTag="" query="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Use pnpm/ }));
    expect(screen.getByText("pnpm", { selector: "strong" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Use pnpm 10");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(act.updateMemoryAction).toHaveBeenCalledWith("p1", "M1", { title: "Use pnpm 10", body: "Run **pnpm** only", tags: ["tooling"] }, "2026-01-02T00:00:00.000Z");
    expect(screen.getByLabelText("Title")).toHaveValue("Use pnpm 10");
  });

  it("deletes after confirmation and offers undo", async () => {
    act.deleteMemoryAction.mockResolvedValue({ ok: true, data: undefined });
    act.restoreDocumentationAction.mockResolvedValue({ ok: true, data: undefined });
    render(<MemoriesView projectId="p1" memories={[memory]} tags={[]} activeTag="" query="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Use pnpm/ }));
    await user.click(screen.getByRole("button", { name: "Delete memory" }));
    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(act.deleteMemoryAction).toHaveBeenCalledWith("p1", "M1");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(act.restoreDocumentationAction).toHaveBeenCalledWith("p1", "memory", "M1");
  });
});

describe("FilesView", () => {
  it("lists documents with download/open links through the proxy route", () => {
    render(<FilesView projectId="p1" documents={[doc]} query="" />);
    expect(screen.getByRole("link", { name: "spec.pdf" })).toHaveAttribute("href", "/api/files/doc/D1");
    expect(screen.getByText("The spec")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace spec.pdf" })).toBeInTheDocument();
  });

  it("uploads a chosen file to the project's streaming route and refuses a disallowed type up front", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FilesView projectId="p1" documents={[]} query="" />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Choose documents to upload");
    await user.upload(input, new File(["hi"], "a.txt", { type: "text/plain" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/projects/p1/documents");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBeInstanceOf(FormData);
    fetchMock.mockClear();
    const bad = new File(["x"], "a.exe", { type: "application/x-msdownload" });
    const fire = (await import("@testing-library/react")).fireEvent;
    fire.change(input, { target: { files: [bad] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("not an allowed type");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("replaces a document: uploads the new file with the old description, then deletes the old one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    act.deleteDocumentAction.mockResolvedValue({ ok: true, data: undefined });
    render(<FilesView projectId="p1" documents={[doc]} query="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Replace spec.pdf" }));
    await user.upload(screen.getByLabelText("Replace document"), new File(["%PDF"], "spec2.pdf", { type: "application/pdf" }));
    const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(form.get("description")).toBe("The spec");
    expect(act.deleteDocumentAction).toHaveBeenCalledWith("p1", "D1");
    vi.unstubAllGlobals();
  });
});
