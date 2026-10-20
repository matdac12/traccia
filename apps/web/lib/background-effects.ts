import { loadBackgroundImage, type BackgroundEffect } from "./background";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered color dithering; preserve alpha so transparent uploads stay transparent. */
export function ditherPixels(data: Uint8ClampedArray, width: number): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    const pixel = offset / 4;
    const threshold = (BAYER[(Math.floor(pixel / width) % 4) * 4 + ((pixel % width) % 4)]! / 16 - 0.5) * 64;
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.round((data[offset + channel]! + threshold) / 85) * 85;
    }
  }
}

export type BackgroundRenderSize = { width: number; height: number; dpr: number; light: boolean };

/** Rasterize at the element's actual size. Character/dot spacing is in CSS pixels, including on Retina displays. */
export async function renderBackgroundEffect(src: string, effect: BackgroundEffect, size: BackgroundRenderSize): Promise<string> {
  if (!["dither", "ascii", "halftone"].includes(effect)) return src;
  const image = await loadBackgroundImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size.width * size.dpr));
  canvas.height = Math.max(1, Math.round(size.height * size.dpr));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not render the background effect.");
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  if (effect === "dither") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    ditherPixels(pixels.data, canvas.width);
    context.putImageData(pixels, 0, 0);
  } else {
    const cellWidth = (effect === "ascii" ? 6 : 4) * size.dpr;
    const cellHeight = (effect === "ascii" ? 8 : 4) * size.dpr;
    const samples = document.createElement("canvas");
    samples.width = Math.ceil(canvas.width / cellWidth);
    samples.height = Math.ceil(canvas.height / cellHeight);
    const sampleContext = samples.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) throw new Error("Could not render the background effect.");
    sampleContext.drawImage(canvas, 0, 0, samples.width, samples.height);
    const { data } = sampleContext.getImageData(0, 0, samples.width, samples.height);
    const original = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = size.light ? "#ffffff" : "#0f1012";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = `${8 * size.dpr}px monospace`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    const characters = " .:-=+*#%@";
    for (let y = 0; y < samples.height; y++) {
      for (let x = 0; x < samples.width; x++) {
        const offset = (y * samples.width + x) * 4;
        const [r, g, b, alpha] = [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const density = size.light ? 1 - luma : luma;
        context.fillStyle = `rgba(${r},${g},${b},${alpha / 255})`;
        const cx = x * cellWidth + cellWidth / 2;
        const cy = y * cellHeight + cellHeight / 2;
        if (effect === "ascii") {
          context.fillText(characters[Math.round(Math.sqrt(density) * (characters.length - 1))]!, cx, cy);
        } else {
          context.beginPath();
          context.arc(cx, cy, (0.3 + 0.7 * Math.sqrt(density)) * cellWidth * 0.46, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    // Retain the image's fine detail and alpha while adding the texture, rather than replacing it with isolated cells.
    const texture = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < original.data.length; offset += 4) {
      for (let channel = 0; channel < 3; channel++) {
        original.data[offset + channel] = original.data[offset + channel]! * 0.6 + texture.data[offset + channel]! * 0.4;
      }
    }
    context.putImageData(original, 0, 0);
  }
  return canvas.toDataURL("image/png");
}
