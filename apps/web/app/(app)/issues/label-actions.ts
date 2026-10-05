"use server";
import { createLabelInputSchema } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { createLabel } from "@/lib/api/labels";
import type { Label } from "@/lib/api/schemas";

export type NewLabelValues = { name: string; color: string; /** Project-scoped (true) or global. */ scoped: boolean };

/** Creates a label from an issue form's dropdown. Scoped labels belong to `projectId`, global ones to nobody. */
export async function createLabelInPlaceAction(projectId: string, values: NewLabelValues): Promise<ActionResult<Label>> {
  const parsed = createLabelInputSchema.safeParse({ name: values.name, color: values.color, project: values.scoped ? projectId : null });
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const label = await createLabel(parsed.data);
    revalidatePath("/", "layout");
    return success(label);
  } catch (err) {
    return toFailure(err);
  }
}
