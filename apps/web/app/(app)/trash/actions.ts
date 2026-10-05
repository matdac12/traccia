"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import { TRASH_TYPES, type RestoreResult, type TrashType } from "@/lib/api/schemas";
import { purgeItem, restoreItem } from "@/lib/api/trash";
import { errorText, type ActionError } from "@/components/trash/trash-model";

export type RestoreOutcome = { ok: true; result: RestoreResult } | ActionError;
export type PurgeOutcome = { ok: true } | ActionError;

function fail(err: unknown, verb: "restore" | "purge"): ActionError {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: errorText(err.code, err.message, verb) };
  return { ok: false, code: "unknown", message: `Could not ${verb} this item.` };
}

function valid(type: string, id: string): type is TrashType {
  return (TRASH_TYPES as readonly string[]).includes(type) && id.length > 0;
}

export async function restoreAction(type: string, id: string): Promise<RestoreOutcome> {
  if (!valid(type, id)) return { ok: false, code: "validation_error", message: "Invalid item." };
  try {
    const result = await restoreItem(type, id);
    revalidatePath("/", "layout");
    return { ok: true, result };
  } catch (err) {
    return fail(err, "restore");
  }
}

export async function purgeAction(type: string, id: string): Promise<PurgeOutcome> {
  if (!valid(type, id)) return { ok: false, code: "validation_error", message: "Invalid item." };
  try {
    await purgeItem(type, id);
    revalidatePath("/trash");
    return { ok: true };
  } catch (err) {
    return fail(err, "purge");
  }
}
