// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Attachments } from "../components/issue-detail/attachments";
import type { Attachment } from "../lib/api/schemas";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const del = vi.fn();
const restore = vi.fn();
vi.mock("../app/(app)/issues/[identifier]/actions", () => ({
  deleteAttachmentAction: (...a: unknown[]) => del(...a),
  restoreAttachmentAction: (...a: unknown[]) => restore(...a),
}));

const ID = (c: string) => `01J9ZZZZZZZZZZZZZZZZZZZZZ${c}`;
const att = (c: string, filename: string, mimeType: string, over: Partial<Attachment> = {}): Attachment => ({
  id: ID(c), filename, mimeType, sizeBytes: 2048, commentId: null, actor: "agent", createdAt: "2026-01-01T00:00:00.000Z", ...over,
});
const list = [att("A", "shot.png", "image/png"), att("B", "spec.pdf", "application/pdf"), att("C", "notes.txt", "text/plain")];

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
  del.mockReset();
  restore.mockReset();
});

describe("Attachments", () => {
  it("lists files: image previews in a lightbox, pdf opens in a new tab, other types download", async () => {
    render(<Attachments identifier="ATT-1" attachments={list} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    const pdf = screen.getByRole("link", { name: "Open spec.pdf in a new tab" });
    expect(pdf).toHaveAttribute("href", `/api/files/${ID("B")}`);
    expect(pdf).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Download notes.txt" })).toHaveAttribute("download", "notes.txt");
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview shot.png" }));
    expect(await screen.findByRole("img", { name: "shot.png" })).toHaveAttribute("src", `/api/files/${ID("A")}`);
  });

  it("uploads dropped files through the proxy route and refreshes", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));
    render(<Attachments identifier="ATT-1" attachments={[]} />);
    const file = new File(["hello"], "n.txt", { type: "text/plain" });
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/issues/ATT-1/attachments");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("refuses a disallowed type or an oversized file before uploading", async () => {
    render(<Attachments identifier="ATT-1" attachments={[]} />);
    const zip = new File(["x"], "a.zip", { type: "application/zip" });
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), { dataTransfer: { files: [zip, big] } });
    expect(await screen.findByText(/a\.zip is not an allowed type/)).toBeInTheDocument();
    expect(screen.getByText(/big\.pdf is 11\.0 MB; the limit is 10\.0 MB/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's error message when the server refuses an upload", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "validation_error", message: "File exceeds the 10485760 byte limit" } }, { status: 400 }));
    render(<Attachments identifier="ATT-1" attachments={[]} />);
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), { dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("File exceeds the 10485760 byte limit");
  });

  it("deletes with undo", async () => {
    del.mockResolvedValue({ ok: true });
    restore.mockResolvedValue({ ok: true });
    render(<Attachments identifier="ATT-1" attachments={list} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete notes.txt" }));
    expect(del).toHaveBeenCalledWith("ATT-1", ID("C"));
    expect(await screen.findByText(/notes\.txt moved to Trash/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download notes.txt" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(restore).toHaveBeenCalledWith("ATT-1", ID("C"));
    expect(await screen.findByRole("link", { name: "Download notes.txt" })).toBeInTheDocument();
  });

  it("puts the file back and says why when the delete fails", async () => {
    del.mockResolvedValue({ ok: false, code: "forbidden", message: "Not allowed" });
    render(<Attachments identifier="ATT-1" attachments={list} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete notes.txt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
    expect(screen.getByRole("link", { name: "Download notes.txt" })).toBeInTheDocument();
  });
});
