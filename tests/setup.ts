import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library's auto-cleanup hook is registered against
// jest/jasmine globals by default. Under vitest we wire it up here so
// every rendered component / hook is unmounted between tests and its
// effect cleanups run — without this, window-level event listeners
// (e.g. useKeyboardShortcuts) leak across tests.
afterEach(() => {
  cleanup();
});
