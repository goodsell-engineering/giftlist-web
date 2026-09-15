/**
 * Session state for the signed-in user (GL-19). Held in memory only, via React state — never
 * `localStorage`, `sessionStorage`, or a cookie set from JS. A page refresh losing the session is
 * the accepted Phase 1 trade-off (see the GL-19 Jira issue); do not "improve" on it by persisting
 * the access token anywhere that survives a reload.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { authClient } from "../api/authClient";
import {
  AuthContext,
  type AuthContextValue,
  type AuthSession,
} from "./authContext";

function toSession(reply: {
  userId: string;
  accessToken: string;
  accessTokenExpiresAt?: Timestamp;
}): AuthSession {
  if (!reply.accessTokenExpiresAt) {
    // Both SignUpResponse and LoginResponse always populate this field (see identity.proto and
    // AuthGrpcService.ToResponse) — unreachable in practice. Throwing rather than defaulting to
    // "expired now" (or "never expires") matters because RequireAuth now checks this field
    // (GL-19 review): a silent default can never be observed to be wrong, and either default
    // would either lock a real user out for no reason or quietly defeat the expiry check.
    throw new Error(
      "Auth response from the Gateway is missing accessTokenExpiresAt.",
    );
  }

  return {
    userId: reply.userId,
    accessToken: reply.accessToken,
    accessTokenExpiresAt: timestampDate(reply.accessTokenExpiresAt),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const response = await authClient.signUp({
        email,
        password,
        displayName,
      });
      setSession(toSession(response));
    },
    [],
  );

  const logIn = useCallback(async (email: string, password: string) => {
    const response = await authClient.login({ email, password });
    setSession(toSession(response));
  }, []);

  const logOut = useCallback(() => setSession(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, signUp, logIn, logOut }),
    [session, signUp, logIn, logOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
