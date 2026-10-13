import { expect, test, type Page } from "@playwright/test";

// A small two-color bitmap; real browser decoding and canvas rendering are part of this scenario.
const bitmap = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAAz0lEQVR4nO3QAQ2DUABEMYRNBCKmZMKmBDHIePeTJlXQ6/ndx/l8/8e58jXRu/I10btEixady9dE7xItWnQuXxO9S7Ro0bl8TfQu0aJF5/I10btEixady9dE7xItWnQuXxO9S7Ro0bl8TfQu0aJF5/I10btEixady9dE7xItWnQuXxO9S7Ro0bl8TfQu0aJF5/I10btEixady9dE7xItWnQuXxO9S7Ro0bl8TfQu0aJF5/I10btEixady9dE7xItWnQuXxO9S7Ro0bl8TfSuF+a2JFhkBzWlAAAAAElFTkSuQmCC", "base64");

test("personal background upload, effects, replacement and disable survive navigation and reload", async ({ page }) => {
  await page.goto("/settings");
  const upload = page.getByLabel("Upload background image");
  const toggle = page.getByRole("checkbox", { name: "Enable background image" });
  const layer = page.locator("main > .background-image-layer");
  await expect(toggle).not.toBeChecked();
  await expect(layer).toHaveCount(0);
  await upload.setInputFiles({ name: "wallpaper.png", mimeType: "image/png", buffer: bitmap });
  await expect(toggle).toBeChecked();
  await expect(layer).toHaveAttribute("data-effect", "haze");
  await expect(page.getByRole("slider", { name: "Background opacity" })).toHaveValue("24");
  await expect(layer).toHaveCSS("background-size", "cover");
  await expect(page.locator("aside .background-image-layer")).toHaveCount(0);
  const originalBackground = await layer.evaluate((element) => (element as HTMLElement).style.backgroundImage);

  for (const [label, effect] of [["None", "none"], ["Dither", "dither"], ["ASCII", "ascii"], ["Halftone", "halftone"], ["Scanlines", "scanlines"], ["Haze", "haze"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(layer).toHaveAttribute("data-effect", effect!);
    await expect(page.getByRole("img", { name: "Background preview" })).toHaveAttribute("data-effect", effect!);
    if (["dither", "ascii", "halftone"].includes(effect!)) {
      await expect.poll(() => layer.evaluate((element, original) => {
        return (element as HTMLElement).style.backgroundImage !== original;
      }, originalBackground)).toBe(true);
    }
  }

  await upload.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("alert").filter({ hasText: "Could not read this image" })).toBeVisible();
  await expect(page.getByText("wallpaper.png", { exact: true })).toBeVisible();

  await toggle.uncheck();
  await expect(layer).toHaveCount(0);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("wallpaper.png", { exact: true })).toBeVisible();
  await upload.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: bitmap });
  await expect(toggle).toBeChecked();
  await expect(page.getByText("replacement.png", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(layer).toHaveAttribute("data-effect", "haze");
  await page.reload();
  await expect(layer).toHaveAttribute("data-effect", "haze");
});

async function upload4k(page: Page) {
  await expect(page.getByLabel("Upload background image")).toBeEnabled();
  return page.getByLabel("Upload background image").evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#224477";
    for (let x = 0; x < canvas.width; x += 16) context.fillRect(x, 1080, 1, 1080);
    const original = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "4k.png", { type: "image/png" }));
    const input = element as HTMLInputElement;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return original;
  });
}

test("4K uploads retain their original pixels and file bytes", async ({ page }) => {
  await page.goto("/settings");
  const original = await upload4k(page);
  await page.getByRole("button", { name: "None", exact: true }).click();
  const layer = page.locator("main > .background-image-layer");
  await expect(layer).toHaveAttribute("data-effect", "none");
  const result = await layer.evaluate(async (element) => {
    const src = (element as HTMLElement).style.backgroundImage.slice(5, -2);
    const image = new Image();
    image.src = src;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, src };
  });
  expect({ width: result.width, height: result.height }).toEqual({ width: 3840, height: 2160 });
  expect(result.src).toBe(original);
  await page.reload();
  await expect(layer).toHaveAttribute("data-effect", "none");
  expect(await layer.evaluate((element) => (element as HTMLElement).style.backgroundImage.slice(5, -2))).toBe(original);
});

async function verifyFineEffects(page: Page) {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("/settings");
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await upload4k(page);
  const layer = page.locator("main > .background-image-layer");
  await expect(layer).toHaveAttribute("data-effect", "haze");
  const original = await layer.evaluate((element) => (element as HTMLElement).style.backgroundImage);
  for (const label of ["ASCII", "Halftone"]) {
    const before = await layer.evaluate((element) => (element as HTMLElement).style.backgroundImage);
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(layer).toHaveAttribute("data-effect", label.toLowerCase());
    await expect.poll(() => layer.evaluate((element, raw) => (element as HTMLElement).style.backgroundImage !== raw, before)).toBe(true);
    const dimensions = await layer.evaluate(async (element) => {
      const image = new Image();
      image.src = (element as HTMLElement).style.backgroundImage.slice(5, -2);
      await image.decode();
      const box = element.getBoundingClientRect();
      return { actual: [image.naturalWidth, image.naturalHeight], expected: [Math.round(box.width * devicePixelRatio), Math.round(box.height * devicePixelRatio)] };
    });
    expect(dimensions.actual, `${label} must not stretch a small raster over the page`).toEqual(dimensions.expected);
    expect(await layer.evaluate((element) => (element as HTMLElement).style.backgroundImage)).not.toBe(original);
    if (label === "Halftone") {
      const largestDot = await layer.evaluate(async (element) => {
        const image = new Image();
        image.src = (element as HTMLElement).style.backgroundImage.slice(5, -2);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, Math.round(2 * devicePixelRatio), canvas.width, 1);
        let run = 0;
        let largest = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          run = data[offset]! > 250 ? run + 1 : 0;
          largest = Math.max(largest, run);
        }
        return largest / devicePixelRatio;
      });
      expect(largestDot).toBeGreaterThan(0);
      expect(largestDot, "print dots should stay fine instead of growing into large blocks").toBeLessThanOrEqual(4);
    }
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect.poll(() => layer.evaluate(async (element) => {
    const image = new Image();
    image.src = (element as HTMLElement).style.backgroundImage.slice(5, -2);
    await image.decode();
    const box = element.getBoundingClientRect();
    return image.naturalWidth === Math.round(box.width * devicePixelRatio) && image.naturalHeight === Math.round(box.height * devicePixelRatio);
  })).toBe(true);
}

test("ASCII and halftone render a fine grid at the actual display size", async ({ page }) => {
  await verifyFineEffects(page);
});

test.describe("Retina backgrounds", () => {
  test.use({ deviceScaleFactor: 2 });
  test("ASCII and halftone remain sharp with small dots on Retina displays", async ({ page }) => {
    await verifyFineEffects(page);
  });
});
