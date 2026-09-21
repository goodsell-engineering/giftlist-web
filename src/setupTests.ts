// Registers jest-dom's matchers (toBeInTheDocument, etc.) with Vitest's `expect` — loaded once
// per test file via vite.config.ts's `test.setupFiles`.
import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library normally unmounts after each test automatically, but only when it can
// detect a global `afterEach` — vite.config.ts's `test.globals: false` means there isn't one, so
// this does it explicitly. Without it, DOM from one test leaks into the next (e.g. two forms both
// matching the same label) rather than each test failing loudly on its own.
afterEach(cleanup);

// The three shims Mantine's own testing guide lists (https://mantine.dev/guides/vitest/) — jsdom
// implements none of these, and several Mantine components (useMediaQuery/hiddenFrom/visibleFrom,
// ScrollArea, popover positioning) touch all three during mount, not just under a media-query or
// resize test. Without them, `src/test/render.tsx`'s MantineProvider wrapper throws or warns on
// otherwise-unrelated tests.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated, still called by some libraries
    removeListener: vi.fn(), // deprecated, still called by some libraries
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;

// jsdom's own getComputedStyle exists but Mantine's positioning code (Popover/Tooltip/etc.) calls
// it in ways jsdom doesn't fully implement; re-binding it through a plain wrapper — rather than
// stubbing it out entirely — is what Mantine's guide does, and keeps jest-dom matchers that rely
// on it (e.g. `toBeVisible`) working against the real computed styles.
const { getComputedStyle } = window;
window.getComputedStyle = (element) => getComputedStyle(element);
