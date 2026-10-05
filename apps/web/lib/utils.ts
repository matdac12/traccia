import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "1 point", "3 points". */
export const pointsLabel = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
