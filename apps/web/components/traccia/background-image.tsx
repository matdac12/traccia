"use client";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import type { BackgroundEffect, BackgroundPreferences } from "@/lib/background";
import { renderBackgroundEffect, type BackgroundRenderSize } from "@/lib/background-effects";
import { useBackground } from "./background-provider";

export function BackgroundImageLayer({ background, preview = false }: { background: BackgroundPreferences; preview?: boolean }) {
  const src = background.image?.src ?? "";
  const effect = background.effect;
  const { resolvedTheme } = useTheme();
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const light = resolvedTheme !== "dark";
  const [processed, setProcessed] = useState<{ src: string; effect: BackgroundEffect; result: string; size: BackgroundRenderSize } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = layer.current;
    if (!element || !src) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = { width: box.width, height: box.height, dpr: window.devicePixelRatio || 1 };
      setSize((previous) => previous.width === next.width && previous.height === next.height && previous.dpr === next.dpr ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [src]);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (src && size.width > 0 && size.height > 0 && ["dither", "ascii", "halftone"].includes(effect)) {
      const renderSize = { ...size, light };
      renderBackgroundEffect(src, effect, renderSize).then((result) => {
        if (!cancelled) setProcessed({ src, effect, result, size: renderSize });
      }).catch(() => { if (!cancelled) setFailed(true); });
    }
    return () => { cancelled = true; };
  }, [src, effect, size, light]);
  if (!src) return null;
  const rendered = processed?.src === src && processed.effect === effect && processed.size.width === size.width
    && processed.size.height === size.height && processed.size.dpr === size.dpr && processed.size.light === light ? processed.result : src;
  const style = { backgroundImage: `url("${rendered}")`, opacity: background.opacity / 100 };
  return (
    <>
      <div
        ref={layer}
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
