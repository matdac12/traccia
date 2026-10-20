import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// waitFor/findBy* give up after 1 s by default, which a loaded machine (the
// pre-push hook runs the packages in parallel) can miss.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
