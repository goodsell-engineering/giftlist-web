// Registers jest-dom's matchers (toBeInTheDocument, etc.) with Vitest's `expect` — loaded once
// per test file via vite.config.ts's `test.setupFiles`.
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library normally unmounts after each test automatically, but only when it can
// detect a global `afterEach` — vite.config.ts's `test.globals: false` means there isn't one, so
// this does it explicitly. Without it, DOM from one test leaks into the next (e.g. two forms both
// matching the same label) rather than each test failing loudly on its own.
afterEach(cleanup);
