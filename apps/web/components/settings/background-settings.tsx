"use client";
import { Upload } from "lucide-react";
import { BackgroundImageLayer } from "@/components/traccia/background-image";
import { useBackground } from "@/components/traccia/background-provider";
import { BACKGROUND_ACCEPT, BACKGROUND_EFFECTS } from "@/lib/background";
import { cn } from "@/lib/utils";

export function BackgroundSettings() {
  const context = useBackground();
  if (!context) return null;
  const { background, ready, uploading, error, update, upload } = context;
  const disabled = !ready || uploading;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[13px] font-medium" id="background-heading">
          Background image
        </h3>
        <p className="text-xs text-muted-foreground">A personal backdrop for your pages. The sidebar stays solid.</p>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={background.enabled}
          disabled={disabled || !background.image}
          onChange={(event) => update({ enabled: event.target.checked })}
          className="size-4 accent-primary"
        />
        Enable background image
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            "relative inline-flex h-8 items-center gap-2 overflow-hidden rounded-md border bg-background px-3 text-xs font-medium focus-within:ring-[3px] focus-within:ring-ring/50",
            disabled && "opacity-50",
          )}
        >
          <Upload className="size-3.5" aria-hidden />
          {uploading ? "Processing image…" : background.image ? "Replace image" : "Upload image"}
          <input
            type="file"
            aria-label="Upload background image"
            aria-describedby="background-upload-note"
            accept={BACKGROUND_ACCEPT}
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        <span className="min-w-0 break-all text-xs text-muted-foreground">{background.image?.name ?? "No image selected"}</span>
      </div>
      <p id="background-upload-note" className="text-xs text-muted-foreground">
        PNG, JPEG, WebP or AVIF, up to 10 MB. Centered and scaled to fill.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {background.image ? (
        <>
          <fieldset aria-label="Background effect" disabled={disabled} className="m-0 min-w-0 space-y-2 border-0 p-0">
            <legend className="mb-2 text-xs font-medium">Effect</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {BACKGROUND_EFFECTS.map((effect) => (
                <button
                  key={effect.value}
                  type="button"
                  aria-pressed={background.effect === effect.value}
                  title={effect.description}
                  onClick={() => update({ effect: effect.value })}
                  className={cn(
                    "rounded-md border px-2 py-2 text-xs outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                    background.effect === effect.value && "border-primary bg-accent/50",
                  )}
                >
                  {effect.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{BACKGROUND_EFFECTS.find((effect) => effect.value === background.effect)?.description}</p>
          </fieldset>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="background-opacity">Background opacity</label>
              <output htmlFor="background-opacity">{background.opacity}%</output>
            </div>
            <input
              id="background-opacity"
              type="range"
              min="5"
              max="65"
              step="1"
              value={background.opacity}
              disabled={disabled}
              onChange={(event) => update({ opacity: Number(event.target.value) })}
              className="block w-full accent-primary"
            />
          </div>
          <div className="relative isolate h-40 overflow-hidden rounded-md border bg-background">
            <BackgroundImageLayer background={background} preview />
            <div aria-hidden className="relative z-10 flex h-full flex-col justify-center gap-2 px-6">
              <span className="text-[13px] font-medium">Your workspace, your backdrop</span>
              <span className="text-xs text-muted-foreground">A preview of the image behind your content.</span>
            </div>
          </div>
          {!background.enabled ? <p className="text-xs text-muted-foreground">Background is off. Your image and display choices are remembered.</p> : null}
        </>
      ) : null}
    </div>
  );
}
