"use server";

import { restoreBodySchema } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import type { RestoreResult, TrashType } from "@/lib/api/schemas";
import { purgeItem } from "@/lib/api/trash";
import { restoreFromTrash } from "@/lib/trash-restore";
import { errorText, type ActionError } from "@/components/trash/trash-model";

export type RestoreOutcome = { ok: true; result: RestoreResult } | ActionError;
export type PurgeOutcome = { ok: true } | ActionError;

function fail(err: unknown, verb: "restore" | "purge"): ActionError {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: errorText(err.code, err.message, verb) };
  return { ok: false, code: "unknown", message: `Could not ${verb} this item.` };
}

/** Same shape as the API's restore body, which covers every trash type. */
function parse(type: string, id: string) {
  const r = restoreBodySchema.safeParse({ type, id });
  return r.success ? (r.data as { type: TrashType; id: string }) : null;
}

export async function restoreAction(type: string, id: string): Promise<RestoreOutcome> {
  const input = parse(type, id);
  if (!input) return { ok: false, code: "validation_error", message: "Invalid item." };
  // A restore brings items back into issue lists and the project nav too.
  const attempt = await restoreFromTrash(input.type, input.id, () => revalidatePath("/", "layout"));
  return attempt.ok ? attempt : fail(attempt.error, "restore");
}

export async function purgeAction(type: string, id: string): Promise<PurgeOutcome> {
  const input = parse(type, id);
  if (!input) return { ok: false, code: "validation_error", message: "Invalid item." };
  try {
    await purgeItem(input.type, input.id);
    revalidatePath("/trash");
    return { ok: true };
  } catch (err) {
    return fail(err, "purge");
  }
}
