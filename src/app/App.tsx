import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "../identity/auth/AuthProvider";
import { theme, cssVariablesResolver } from "../ui/theme";
import { resolveDayjsLocale } from "../ui/dates";
import { router } from "./router";

// MantineProvider/DatesProvider wrap everything else so every route resolves the same theme and
// date-locale settings — light scheme only for now (forceColorScheme="light"); dark is a later
// decision (GL-121). AuthProvider then wraps the router (not the other way round) so every route
// — including the RequireAuth guards inside router.tsx — can read the in-memory session via
// useAuth().
export default function App() {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme="light"
    >
      <DatesProvider settings={{ locale: resolveDayjsLocale() }}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
