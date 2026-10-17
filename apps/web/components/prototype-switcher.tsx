"use client";
// PROTOTYPE: floating variant switcher for throwaway UI prototypes (`?variant=`). Never rendered in production.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { shortcutBlocked } from "@/lib/is-typing";

export function PrototypeSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const current = Math.max(0, variants.findIndex((v) => v.key === (params.get("variant") ?? variants[0].key)));
  const go = (i: number) => {
    const q = new URLSearchParams(params.toString());
    q.set("variant", variants[(i + variants.length) % variants.length].key);
    router.replace(`${path}?${q}`, { scroll: false });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") go(current - 1);
      if (e.key === "ArrowRight") go(current + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  const v = variants[current];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#111] p-1 text-white shadow-xl ring-1 ring-white/15">
      <button type="button" aria-label="Previous variant" onClick={() => go(current - 1)} className="grid size-8 place-items-center rounded-full hover:bg-white/15"><ChevronLeft className="size-4" /></button>
      <span className="min-w-40 px-2 text-center font-mono text-[12px]">
        <span className="text-[#ff9e0b]">{v.key}</span> ({v.name}) <span className="text-white/50">{current + 1}/{variants.length}</span>
      </span>
      <button type="button" aria-label="Next variant" onClick={() => go(current + 1)} className="grid size-8 place-items-center rounded-full hover:bg-white/15"><ChevronRight className="size-4" /></button>
    </div>
  );
}
