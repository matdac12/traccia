// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKGROUND } from "../lib/background";
import { readBackground, writeBackground } from "../lib/background-storage";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", new JSDOM("", { url: "http://localhost" }).window.localStorage);
});
afterEach(() => vi.restoreAllMocks());

describe("background image storage", () => {
  it("stores original image data larger than localStorage's quota", async () => {
    const image = { name: "4k.png", src: `data:image/png;base64,${"A".repeat(8_000_000)}` };
    await writeBackground({ ...DEFAULT_BACKGROUND, image, enabled: true });
    expect((await readBackground()).image).toEqual(image);
  });

  it("migrates an existing disabled background with its image and display choices", async () => {
    const previous = { ...DEFAULT_BACKGROUND, image: { name: "old.png", src: "data:image/png;base64,AAAA" }, effect: "scanlines", opacity: 37 };
    localStorage.setItem("traccia_background", JSON.stringify(previous));
    expect(await readBackground()).toEqual(previous);
    expect(localStorage.getItem("traccia_background")).toBeNull();
    expect(await readBackground()).toEqual(previous);
  });

  it("preference updates retain the original image without rewriting it", async () => {
    const image = { name: "4k.png", src: "data:image/png;base64,AAAA" };
    await writeBackground({ ...DEFAULT_BACKGROUND, image, enabled: true });
    await writeBackground({ ...DEFAULT_BACKGROUND, image, opacity: 40 }, false);
    expect(await readBackground()).toMatchObject({ image, opacity: 40, enabled: false });
  });

  it("an image write failure cannot partially replace the previously saved preferences", async () => {
    const previous = { ...DEFAULT_BACKGROUND, image: { name: "old.png", src: "data:image/png;base64,AAAA" } };
    await writeBackground(previous);
    const put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === "image") throw new DOMException("Full", "QuotaExceededError");
      return put.call(this, value, key);
    });
    await expect(writeBackground({ ...previous, enabled: true, opacity: 65 })).rejects.toThrow("Full");
    fault.mockRestore();
    expect(await readBackground()).toEqual(previous);
  });
});
