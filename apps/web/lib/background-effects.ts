import { loadBackgroundImage, type BackgroundEffect } from "./background";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered color dithering; preserve alpha so transparent uploads stay transparent. */
export function ditherPixels(data: Uint8ClampedArray, width: number): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    const pixel = offset / 4;
    const threshold = (BAYER[(Math.floor(pixel / width) % 4) * 4 + pixel % width % 4]! / 16 - 0.5) * 64;
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.round((data[offset + channel]! + threshold) / 85) * 85;
    }
  }
}

/** Raster effects are computed only when the image or effect changes, never on opacity changes. */
export async function renderBackgroundEffect(src: string, effect: BackgroundEffect): Promise<string> {
  if (!["dither", "ascii", "halftone"].includes(effect)) return src;
  const image = await loadBackgroundImage(src);
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not render the background effect.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (effect === "dither") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    ditherPixels(pixels.data, canvas.width);
    context.putImageData(pixels, 0, 0);
  } else {
    const cell = effect === "ascii" ? 9 : 8;
    const samples = document.createElement("canvas");
    samples.width = Math.ceil(canvas.width / cell);
    samples.height = Math.ceil(canvas.height / cell);
    const sampleContext = samples.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) throw new Error("Could not render the background effect.");
    sampleContext.drawImage(image, 0, 0, samples.width, samples.height);
    const { data } = sampleContext.getImageData(0, 0, samples.width, samples.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#08090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = `${cell}px monospace`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    const characters = " .:-=+*#%@";
    for (let y = 0; y < samples.height; y++) {
      for (let x = 0; x < samples.width; x++) {
        const offset = (y * samples.width + x) * 4;
        const [r, g, b, alpha] = [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
        const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        context.fillStyle = `rgba(${r},${g},${b},${alpha / 255})`;
        const cx = x * cell + cell / 2;
        const cy = y * cell + cell / 2;
        if (effect === "ascii") {
          context.fillText(characters[Math.round(light * (characters.length - 1))]!, cx, cy);
        } else {
          context.beginPath();
          context.arc(cx, cy, Math.max(0.5, Math.sqrt(light) * cell * 0.48), 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  }
  return canvas.toDataURL("image/png");
}
