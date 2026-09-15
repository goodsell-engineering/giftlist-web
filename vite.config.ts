import react from "@vitejs/plugin-react";
// `defineConfig` from vitest/config, not vite, so the `test` block below type-checks — it's a
// superset of vite's own config type, so nothing else here changes.
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Binds Vite to all interfaces so the container's published 5173 port reaches it — without
    // this the dev server only listens on the container's loopback and localhost:5173 never
    // connects from the host.
    host: "0.0.0.0",
    watch: {
      // inotify events don't reliably propagate across the bind-mounted source directory on
      // macOS/Windows Docker Desktop, so hot reload silently stops working without polling.
      usePolling: true,
    },
  },
  test: {
    // jsdom, not the default node environment: the SPA's tests render real DOM (React Testing
    // Library) and exercise routing (react-router's browser history), both of which need a DOM.
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // Explicit imports (`import { describe, it, expect } from "vitest"`) rather than injected
    // globals — keeps eslint's normal unused-import/no-undef checks meaningful in test files too.
    globals: false,
    env: {
      // Pins the timezone every test runs under, deliberately not the ambient ("whatever this
      // machine/container happens to be set to") one — batch-15 review, found by execution: a
      // DashboardPage test asserting a UTC-vs-local-midnight fix (parseExpiryDate) was falsifiable
      // on a developer's Europe/London machine in July (BST, UTC+1) but silently became
      // unfalsifiable the moment TZ=UTC (CI's default, once GL-30 adds CI) or a January date was
      // in play — Europe/London is UTC+0 for roughly half the year. Asia/Kolkata has a permanent,
      // non-zero, non-DST offset (UTC+5:30), so a local/UTC mixup is detectable on every date, on
      // every machine, in CI or not. Applied here (Vitest's own `test.env`, resolved before any
      // setup file or test module loads) rather than in setupTests.ts specifically so it takes
      // effect before the *first* Date/Intl call of the process, not just the first one after that
      // file's own imports finish evaluating.
      //
      // Do not delete this as dead/redundant config — it is the one thing standing between "this
      // test is real evidence" and "this test agrees with whatever timezone happened to run it".
      TZ: "Asia/Kolkata",
    },
  },
});
