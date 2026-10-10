"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import {
  createMemory,
  deleteDocument,
  deleteMemory,
  restoreDocumentation,
  updateDocument,
  updateMemory,
} from "@/lib/api/documentation";
import {
  DOCUMENT_DESCRIPTION_MAX,
  MEMORY_BODY_MAX_BYTES,
  MEMORY_TAG_MAX,
  MEMORY_TAGS_MAX,
  MEMORY_TITLE_MAX,
  REF,
} from "@/lib/documentation";

// Writes from the Documentation tab. Each validates, calls the server-only API client (as `you`) and refreshes the tab.
// Uploads go through the streaming route handler at /api/projects/[id]/documents; everything else is here.

const refSchema = z.string().regex(REF, "not a valid reference");

const memoryFields = z.object({
  title: z.string().trim().min(1, "A memory needs a title").max(MEMORY_TITLE_MAX),
  body: z.string().refine((b) => new TextEncoder().encode(b).length <= MEMORY_BODY_MAX_BYTES, { message: `Must be at most ${MEMORY_BODY_MAX_BYTES / 1024} KiB` }),
  tags: z.array(z.string().trim().min(1).max(MEMORY_TAG_MAX, `Tags are at most ${MEMORY_TAG_MAX} characters`)).max(MEMORY_TAGS_MAX, `At most ${MEMORY_TAGS_MAX} tags`),
});
export type MemoryValues = z.input<typeof memoryFields>;

const documentFields = z.object({
  filename: z.string().trim().min(1, "A document needs a name"),
  description: z.string().max(DOCUMENT_DESCRIPTION_MAX, `Must be at most ${DOCUMENT_DESCRIPTION_MAX} characters`),
});
export type DocumentValues = z.input<typeof documentFields>;

/** Validate, call the API, refresh the tab. A conflict also refreshes, so the page shows the latest version. */
async function run<S extends z.ZodType>(projectId: string, schema: S, input: unknown, call: (data: z.output<S>) => Promise<unknown>): Promise<ActionResult> {
  if (!refSchema.safeParse(projectId).success) return failure("Not a valid project.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    await call(parsed.data);
  } catch (err) {
    const result = toFailure(err);
    if (!result.ok && result.conflict) revalidatePath(`/projects/${projectId}/documentation`, "layout");
    return result;
  }
  revalidatePath(`/projects/${projectId}/documentation`, "layout");
  return success(undefined);
}

const idInput = z.object({ id: refSchema });

export async function createMemoryAction(projectId: string, values: MemoryValues) {
  return run(projectId, memoryFields, values, (d) => createMemory(projectId, d));
}

/** `expectedUpdatedAt` is the memory's `updatedAt` as the user last saw it; a stale value is a conflict and nothing is saved. */
export async function updateMemoryAction(projectId: string, id: string, values: MemoryValues, expectedUpdatedAt: string) {
  return run(projectId, memoryFields.extend({ id: refSchema }), { ...values, id }, ({ id: memoryId, ...d }) => updateMemory(memoryId, { ...d, expectedUpdatedAt }));
}

/** Soft delete; the UI offers an undo (`restoreDocumentationAction`). */
export async function deleteMemoryAction(projectId: string, id: string) {
  return run(projectId, idInput, { id }, (d) => deleteMemory(d.id));
}

export async function updateDocumentAction(projectId: string, id: string, values: DocumentValues, expectedUpdatedAt: string) {
  return run(projectId, documentFields.extend({ id: refSchema }), { ...values, id }, ({ id: documentId, ...d }) => updateDocument(documentId, { ...d, expectedUpdatedAt }));
}

export async function deleteDocumentAction(projectId: string, id: string) {
  return run(projectId, idInput, { id }, (d) => deleteDocument(d.id));
}

export async function restoreDocumentationAction(projectId: string, type: "memory" | "document", id: string) {
  return run(projectId, z.object({ type: z.enum(["memory", "document"]), id: refSchema }), { type, id }, (d) => restoreDocumentation(d.type, d.id));
}
