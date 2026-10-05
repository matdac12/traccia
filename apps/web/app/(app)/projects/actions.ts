"use server";
import { createProjectInputSchema, type ProjectStatus } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { createProject } from "@/lib/api/projects";

export type CreateProjectValues = { name: string; description: string; status: ProjectStatus };

/** Issue keys are shared (ADR 0002), so the key is left to the API's default. */
export async function createProjectAction(values: CreateProjectValues): Promise<ActionResult<{ id: string }>> {
  const parsed = createProjectInputSchema.safeParse({
    name: values.name,
    description: values.description || undefined,
    status: values.status,
  });
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  let project: Awaited<ReturnType<typeof createProject>>;
  try {
    project = await createProject(parsed.data);
  } catch (err) {
    return toFailure(err);
  }
  // The layout (sidebar, project picker) lists projects too.
  revalidatePath("/", "layout");
  return success({ id: project.id });
}
