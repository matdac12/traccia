"use client";
import { Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppearance } from "@/components/traccia/appearance-provider";
import { accentFor, ACCENTS, DEFAULT_ACCENT, FONTS, normalizeHex } from "@/lib/appearance";
import { cn } from "@/lib/utils";

/** Accent and font, stored per browser in cookies (TRC-57). Changes apply immediately. */
export function AppearanceSettings() {
  const { accent, font, setAccent, setFont, reset } = useAppearance();
  const [draft, setDraft] = useState(accent);
  const invalid = normalizeHex(draft) === null;
  const adjustedIn = (["light", "dark"] as const).filter((t) => accentFor(accent, t).adjusted);

  const pick = (hex: string) => {
    setDraft(hex);
    setAccent(hex);
  };
  const type = (value: string) => {
    setDraft(value);
    const hex = normalizeHex(value);
    if (hex) setAccent(hex);
  };

  return (
    <section aria-labelledby="appearance-heading" className="space-y-6">
      <h2 id="appearance-heading" className="text-sm font-medium">Appearance</h2>

      <div className="space-y-3">
        <div>
          <h3 className="text-[13px] font-medium" id="accent-label">Accent color</h3>
          <p className="text-xs text-muted-foreground">Buttons, focus rings and the selected sidebar item. Status colors and the agent cyan stay fixed.</p>
        </div>
        <fieldset aria-labelledby="accent-label" className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          {ACCENTS.map((c) => {
            const selected = c.hex === accent;
            return (
              <button
                key={c.hex}
                type="button"
                                aria-pressed={selected}
                aria-label={c.name}
                title={c.name}
                onClick={() => pick(c.hex)}
                style={{ backgroundColor: c.hex, color: accentFor(c.hex, "light").foreground }}
                className="grid size-8 place-items-center rounded-full border border-black/10 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-white/15"
              >
                {selected ? <Check className="size-4" aria-hidden /> : null}
              </button>
            );
          })}
        </fieldset>
        <div className="flex items-center gap-2">
          <label htmlFor="accent-hex" className="text-xs text-muted-foreground">Custom hex</label>
          <Input
            id="accent-hex"
            value={draft}
            onChange={(e) => type(e.target.value)}
            onBlur={() => setDraft(invalid ? accent : (normalizeHex(draft) as string))}
            aria-invalid={invalid}
            aria-describedby="accent-hex-note"
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            placeholder="#ff9e0b"
            className="h-8 w-28 font-mono"
          />
          <span aria-hidden className="size-6 rounded-md border" style={{ backgroundColor: accent }} />
          <Button type="button" variant="ghost" size="sm" disabled={accent === DEFAULT_ACCENT} onClick={() => pick(DEFAULT_ACCENT)}>Reset</Button>
        </div>
        <p id="accent-hex-note" role={invalid || adjustedIn.length ? "alert" : undefined} className={cn("min-h-4 text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
          {invalid
            ? "Enter a hex color such as #ff9e0b or #f90."
            : adjustedIn.length
              ? `Low contrast against the ${adjustedIn.join(" and ")} theme background: the accent is adjusted there so it stays visible.`
              : null}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-[13px] font-medium" id="font-label">Font</h3>
          <p className="text-xs text-muted-foreground">Used across the whole interface. Code stays monospaced.</p>
        </div>
        <fieldset aria-labelledby="font-label" className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:grid-cols-3">
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
                            aria-pressed={f.value === font}
              data-font-option={f.value}
              onClick={() => setFont(f.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                f.value === font && "border-primary bg-accent/50",
              )}
            >
              <span className="block text-[13px] font-medium">{f.label}</span>
              <span className="block text-xs text-muted-foreground">{f.hint}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <p className="text-xs text-muted-foreground">Saved in this browser only.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => { reset(); setDraft(DEFAULT_ACCENT); }}>Reset appearance</Button>
    </section>
  );
}
