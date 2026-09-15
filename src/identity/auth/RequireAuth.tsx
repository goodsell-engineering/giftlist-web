import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./useAuth";

/**
 * Route guard (GL-19): redirects to `/login` when there is no in-memory session, or the session
 * has expired. `/login` and `/signup` stay outside this guard (they must be reachable while
 * signed out); every other app route — dashboard, list detail, the owner's share preview — goes
 * through it.
 *
 * There is no server call here and nothing to await: the session either exists (and is still
 * live) in memory right now or it doesn't (a page refresh always loses it, per the in-memory-only
 * rule), so this is a synchronous check, not a loading state.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  // Expiry is checked, not just presence. accessTokenExpiresAt used to be captured and never
  // read (GL-19 review), so a session that expired hours ago still satisfied this guard — a
  // guarantee-shaped field that guaranteed nothing. This is a client-side convenience only: it
  // is the server that actually enforces the token's lifetime, and this check exists so the
  // batch that adds an Authorization interceptor does not inherit a guard that already admits
  // expired sessions.
  if (!session || session.accessTokenExpiresAt <= new Date()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
