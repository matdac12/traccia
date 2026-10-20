export const BACKGROUND_STORAGE_KEY = "traccia_background";
export const BACKGROUND_EFFECTS = [
  { value: "none", label: "None", description: "Show the original image." },
  { value: "dither", label: "Dither", description: "A textured, limited color palette." },
  { value: "ascii", label: "ASCII", description: "Recreate the image with colored characters." },
  { value: "halftone", label: "Halftone", description: "Recreate the image with print dots." },
  { value: "scanlines", label: "Scanlines", description: "Horizontal lines with a retro display feel." },
  { value: "haze", label: "Haze", description: "Gradually blur and fade into the page background." },
] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number]["value"];
export type BackgroundImage = { name: string; src: string };
export type BackgroundPreferences = {
  version: 1;
  enabled: boolean;
  image: BackgroundImage | null;
  effect: BackgroundEffect;
  opacity: number;
};
export const DEFAULT_BACKGROUND: BackgroundPreferences = { version: 1, enabled: false, image: null, effect: "haze", opacity: 24 };
export const BACKGROUND_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 100;

/** Stored preferences are untrusted. Keep image URLs local and opacity within a readable range. */
export function parseBackground(value: string | null): BackgroundPreferences {
  try {
    const data = JSON.parse(value ?? "null");
    if (data?.version !== 1) return DEFAULT_BACKGROUND;
    const image =
      data.image &&
      typeof data.image.name === "string" &&
      typeof data.image.src === "string" &&
      data.image.src.length <= MAX_IMAGE_LENGTH &&
      /^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/]+=*$/.test(data.image.src)
        ? { name: data.image.name.slice(0, 255), src: data.image.src }
        : null;
    return {
      version: 1,
      image,
      enabled: data.enabled === true && image !== null,
      effect: BACKGROUND_EFFECTS.find((effect) => effect.value === data.effect)?.value ?? "haze",
      opacity: typeof data.opacity === "number" && Number.isFinite(data.opacity) ? Math.min(65, Math.max(5, Math.round(data.opacity))) : 24,
    };
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export function validateBackgroundFile(file: Pick<File, "size" | "type">): void {
  if (!BACKGROUND_ACCEPT.split(",").includes(file.type)) throw new Error("Choose a PNG, JPEG, WebP or AVIF image.");
  if (file.size === 0) throw new Error("This image is empty. Choose another image.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an image smaller than 10 MB.");
}

export function loadBackgroundImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image. Choose another image."));
    image.src = src;
  });
}

/** Validate decoding, then keep the uploaded bytes intact: no resizing or lossy re-encoding. */
export async function prepareBackgroundImage(file: File): Promise<BackgroundImage> {
  validateBackgroundFile(file);
  const url = URL.createObjectURL(file);
  try {
    await loadBackgroundImage(url);
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read this image. Choose another image."));
      reader.readAsDataURL(file);
    });
    return { name: file.name, src };
  } finally {
    URL.revokeObjectURL(url);
  }
}
