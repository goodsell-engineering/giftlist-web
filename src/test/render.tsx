/**
 * Wraps React Testing Library's `render` in `MantineProvider`, configured with this app's own
 * theme (`../ui/theme` — the same one `App.tsx` mounts) so a component under test resolves the
 * same colors, radii, font-family and CSS variables it would in the running app, not RTL's
 * DOM-only defaults. Every other RTL export (`screen`, `waitFor`, `renderHook`, ...) passes
 * through unchanged. Every `*.test.tsx` in this repo imports from here instead of
 * `@testing-library/react` directly (GL-121) — none of them assert on Mantine styling, so this
 * file's only job is to make Mantine components (`useMantineTheme`, portals, etc.) not throw for
 * want of a provider.
 */
import type { ReactElement } from "react";
import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";

import { resolveDayjsLocale } from "../ui/dates";
import { theme, cssVariablesResolver } from "../ui/theme";

function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => (
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        forceColorScheme="light"
        // Disables Mantine's transitions and portal-based positioning work that has no useful
        // effect under jsdom and otherwise leaves timers/observers running past a test's end.
        env="test"
      >
        {/* Same DatesProvider as App.tsx, so a DatePickerInput under test formats its value the
            way the running app does (jsdom reports en-US, so the "en" dayjs locale). */}
        <DatesProvider settings={{ locale: resolveDayjsLocale() }}>
          {children}
        </DatesProvider>
      </MantineProvider>
    ),
    ...options,
  });
}

export * from "@testing-library/react";
export { render };
