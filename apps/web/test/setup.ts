import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// waitFor/findBy* give up after 1 s by default, which a loaded machine (the
// pre-push hook runs both packages in parallel) can miss.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

// jsdom has no ResizeObserver; Radix tooltips/popovers measure with it as soon as
// they open, so any test that hovers or focuses a tooltip trigger would throw.
// Individual tests may still stub their own.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
