import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "1 Reminder", "3 Reminders". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 point", "3 points". */
export const pointsLabel = (n: number) => plural(n, "point", "points");
