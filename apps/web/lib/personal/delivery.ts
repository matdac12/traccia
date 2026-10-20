import type { ReminderFailure, Todo, TodoDelivery, TodoDeliveryReason } from "@traccia/shared";

/** Why a failed Reminder failed, in plain words (docs/personal-space.md §7.4 and §7.6). */
export const FAILURE_TEXT: Record<ReminderFailure, string> = {
  telegram_unauthorized: "Telegram rejected the bot token. Check the bot settings.",
  telegram_forbidden: "The bot can't message the chat. Check it isn't blocked and the chat was started.",
  telegram_rejected: "Telegram refused it. Check the bot settings.",
  gave_up: "Telegram couldn't be reached before the day ended.",
};

/** What a skipped Reminder says: its day had already passed when it was due (§4). */
export const SKIPPED_TEXT = "Skipped (day had passed)";

/** The sentence for a Reminder that failed or was skipped; null for the others. */
export function reminderNote(reminder: NonNullable<Todo["reminder"]>): string | null {
  if (reminder.status === "skipped") return SKIPPED_TEXT;
  if (reminder.status === "failed") return (reminder.failure && FAILURE_TEXT[reminder.failure]) || "The Reminder could not be sent.";
  return null;
}

/** The banner texts for each reason Reminders can't go out (§7.7). */
const BANNER_TEXT: Record<TodoDeliveryReason, string> = {
  not_configured: "Reminders are off: Telegram is not configured.",
  telegram_unauthorized: "Reminders can't be sent: the Telegram bot token was rejected.",
  telegram_forbidden: "Reminders can't be sent: the bot can't message the chat.",
};

/** The banner's text, or null when Reminders are being delivered (or the API named no reason). */
export function deliveryBanner(delivery: TodoDelivery | undefined): string | null {
  if (!delivery || delivery.ok || !delivery.reason) return null;
  return BANNER_TEXT[delivery.reason];
}
