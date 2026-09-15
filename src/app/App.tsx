import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "../identity/auth/AuthProvider";
import { router } from "./router";

// AuthProvider wraps the router (not the other way round) so every route — including the
// RequireAuth guards inside router.tsx — can read the in-memory session via useAuth().
export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
