import type { TodoDelivery } from "@traccia/shared";
import { BellOff } from "lucide-react";
import { deliveryBanner } from "@/lib/personal/delivery";

/** A slim banner above the list while Reminders can't go out (docs/personal-space.md §7.7); nothing when they can. */
export function DeliveryBanner({ delivery }: { delivery: TodoDelivery | undefined }) {
  const text = deliveryBanner(delivery);
  if (!text) return null;
  return (
    <div role="status" data-reason={delivery?.reason} className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-1.5 text-[12px] text-destructive md:px-8">
      <BellOff className="size-3.5 shrink-0" aria-hidden />
      {text}
    </div>
  );
}
