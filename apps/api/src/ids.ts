import { monotonicFactory } from "ulid";

// Monotonic so ids created within the same millisecond still sort in creation order.
const ulid = monotonicFactory();

export const newId = (): string => ulid();
