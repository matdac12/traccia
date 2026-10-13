import { expect, test } from "@playwright/test";

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

  for (const [label, effect] of [["None", "none"], ["Dither", "dither"], ["ASCII", "ascii"], ["Halftone", "halftone"], ["Scanlines", "scanlines"], ["Haze", "haze"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(layer).toHaveAttribute("data-effect", effect!);
    await expect(page.getByRole("img", { name: "Background preview" })).toHaveAttribute("data-effect", effect!);
    if (["dither", "ascii", "halftone"].includes(effect!)) {
      await expect.poll(() => layer.evaluate((element) => {
        const saved = JSON.parse(localStorage.getItem("traccia_background")!);
        return (element as HTMLElement).style.backgroundImage !== `url("${saved.image.src}")`;
      })).toBe(true);
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
