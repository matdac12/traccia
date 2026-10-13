"use client";
import { useEffect, useState } from "react";
import type { BackgroundEffect, BackgroundPreferences } from "@/lib/background";
import { renderBackgroundEffect } from "@/lib/background-effects";
import { useBackground } from "./background-provider";

export function BackgroundImageLayer({ background, preview = false }: { background: BackgroundPreferences; preview?: boolean }) {
  const src = background.image?.src ?? "";
  const effect = background.effect;
  const [processed, setProcessed] = useState<{ src: string; effect: BackgroundEffect; result: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (src && ["dither", "ascii", "halftone"].includes(effect)) {
      renderBackgroundEffect(src, effect).then((result) => {
        if (!cancelled) setProcessed({ src, effect, result });
      }).catch(() => { if (!cancelled) setFailed(true); });
    }
    return () => { cancelled = true; };
  }, [src, effect]);
  if (!src) return null;
  const rendered = processed?.src === src && processed.effect === effect ? processed.result : src;
  const style = { backgroundImage: `url("${rendered}")`, opacity: background.opacity / 100 };
  return (
    <>
      <div
        role="img"
        aria-label={preview ? "Background preview" : undefined}
        aria-hidden={preview ? undefined : true}
        className="background-image-layer"
        data-effect={effect}
        data-preview={preview || undefined}
        style={style}
      >
        {effect === "haze" ? <><span className="background-haze-soft" /><span className="background-haze-strong" /></> : null}
      </div>
      {preview && failed ? <p role="alert" className="absolute inset-x-2 bottom-2 rounded bg-background p-2 text-xs text-destructive">Could not render this effect. Try another effect or image.</p> : null}
    </>
  );
}

export function AppBackground() {
  const context = useBackground();
  if (!context?.background.enabled) return null;
  return <BackgroundImageLayer background={context.background} />;
}
