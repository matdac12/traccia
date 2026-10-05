import type { Priority } from "@traccia/shared";

export const PRIORITY_LABEL: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

/** Estimate choices offered when creating an issue (Fibonacci-ish, like the detail panel). */
export const ESTIMATES = [1, 2, 3, 5, 8, 13];
