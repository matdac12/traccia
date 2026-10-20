// @vitest-environment jsdom
import { BroadcastChannel } from "node:worker_threads";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JSDOM } from "jsdom";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "../components/settings/appearance-settings";
import { AppearanceProvider } from "../components/traccia/appearance-provider";
import { prepareBackgroundImage } from "../lib/background";
import { readBackground } from "../lib/background-storage";
import * as storageModule from "../lib/background-storage";

// jsdom cannot decode/rasterize images. Keep the provider, controls and IndexedDB operations real;
// replace only the bitmap preparation boundary, which is exercised in the browser.
vi.mock("../lib/background", async (original) => ({
  ...(await original<typeof import("../lib/background")>()),
  prepareBackgroundImage: vi.fn(),
}));

async function settings() {
  const view = render(
    <AppearanceProvider initialAccent="#ff9e0b" initialFont="mono">
      <AppearanceSettings />
    </AppearanceProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText("Upload background image")).toBeEnabled());
  return view;
}

const image = { name: "mountains.png", src: "data:image/png;base64,iVBORw0KGgo=" };
function saved(overrides = {}) {
  localStorage.setItem("traccia_background", JSON.stringify({ version: 1, enabled: true, effect: "haze", opacity: 24, image, ...overrides }));
}

describe("background settings", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new JSDOM("", { url: "http://localhost" }).window.localStorage);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("BroadcastChannel", BroadcastChannel);
    vi.mocked(prepareBackgroundImage).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts without an image, with backgrounds off and an upload control", async () => {
    await settings();
    expect(screen.getByRole("heading", { name: "Background image" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked();
    expect(screen.getByLabelText("Upload background image")).toHaveAttribute("type", "file");
    expect(screen.queryByRole("img", { name: "Background preview" })).toBeNull();
  });

  it("restores the saved image and controls after a reload", async () => {
    saved({ effect: "scanlines", opacity: 37 });
    const view = await settings();
    expect(await screen.findByRole("img", { name: "Background preview" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable background image" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Scanlines" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Background opacity" })).toHaveValue("37");
    view.unmount();
    await settings();
    expect(await screen.findByRole("img", { name: "Background preview" })).toBeInTheDocument();
  });

  it("retains the image and display choices when disabled, including after a reload", async () => {
    saved();
    const view = await settings();
    await screen.findByRole("img", { name: "Background preview" });
    await userEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.change(screen.getByRole("slider", { name: "Background opacity" }), { target: { value: "40" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable background image" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked());
    expect(await readBackground()).toMatchObject({ enabled: false, effect: "none", opacity: 40, image });
    view.unmount();
    await settings();
    await screen.findByText("mountains.png");
    expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable background image" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("slider", { name: "Background opacity" })).toHaveValue("40");
  });

  it("shows a storage failure without changing the saved or active background", async () => {
    saved();
    await settings();
    await screen.findByRole("img", { name: "Background preview" });
    const storage = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await userEvent.click(screen.getByRole("button", { name: "None" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(screen.getByRole("button", { name: "Haze" })).toHaveAttribute("aria-pressed", "true");
    storage.mockRestore();
  });

  it("ignores corrupt stored data and keeps the settings usable", async () => {
    localStorage.setItem("traccia_background", "broken json");
    await settings();
    await waitFor(() => expect(screen.getByLabelText("Upload background image")).not.toBeDisabled());
    expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked();
  });

  it("reset appearance disables the background without deleting its image", async () => {
    saved({ effect: "none", opacity: 40 });
    await settings();
    await screen.findByRole("img", { name: "Background preview" });
    await userEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked());
    expect(await readBackground()).toMatchObject({ enabled: false, effect: "haze", opacity: 24, image });
  });

  it("uploads activate the image and replacement uploads preserve the selected display controls", async () => {
    vi.mocked(prepareBackgroundImage).mockResolvedValue(image);
    await settings();
    await userEvent.upload(screen.getByLabelText("Upload background image"), new File(["image"], "mountains.png", { type: "image/png" }));
    await screen.findByRole("img", { name: "Background preview" });
    expect(screen.getByRole("checkbox", { name: "Enable background image" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Scanlines" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable background image" }));
    vi.mocked(prepareBackgroundImage).mockResolvedValue({ ...image, name: "forest.png" });
    await userEvent.upload(screen.getByLabelText("Upload background image"), new File(["image"], "forest.png", { type: "image/png" }));
    await screen.findByText("forest.png");
    expect(await readBackground()).toMatchObject({ enabled: true, effect: "scanlines", image: { name: "forest.png" } });
  });

  it("failed uploads preserve the previous image and show the processing error", async () => {
    saved();
    vi.mocked(prepareBackgroundImage).mockRejectedValue(new Error("Could not read this image."));
    await settings();
    await screen.findByRole("img", { name: "Background preview" });
    await userEvent.upload(screen.getByLabelText("Upload background image"), new File(["broken"], "broken.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read this image.");
    expect(await readBackground()).toMatchObject({ image });
  });

  it("prevents reset while an upload is pending so its completion cannot undo a reset", async () => {
    let finish!: (result: typeof image) => void;
    vi.mocked(prepareBackgroundImage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await settings();
    await userEvent.upload(screen.getByLabelText("Upload background image"), new File(["image"], "mountains.png", { type: "image/png" }));
    expect(screen.getByRole("button", { name: "Reset appearance" })).toBeDisabled();
    finish(image);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset appearance" })).not.toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Enable background image" })).not.toBeChecked());
  });

  it("a sync read started earlier cannot undo newer local effect and opacity changes", async () => {
    saved();
    await settings();
    const read = storageModule.readBackground;
    const old = await read();
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(storageModule, "readBackground").mockImplementationOnce(async () => {
      started();
      await pending;
      return old;
    });
    const otherTab = new BroadcastChannel("traccia-background");
    try {
      otherTab.postMessage("updated");
      await reading;
      await userEvent.click(screen.getByRole("button", { name: "None" }));
      await waitFor(async () => expect((await read()).effect).toBe("none"));
      await act(async () => {
        finish();
        await pending;
      });
      fireEvent.change(screen.getByRole("slider", { name: "Background opacity" }), { target: { value: "40" } });
      await waitFor(async () => expect(await read()).toMatchObject({ effect: "none", opacity: 40 }));
    } finally {
      finish();
      otherTab.close();
    }
  });
});
