/**
 * The `AuthSession` shape and the raw React context (GL-19). Kept in a plain `.ts` file, not a
 * component file, so `AuthProvider.tsx` and `useAuth.ts` can each export only what
 * react-refresh/only-export-components expects of them (a component, and a hook, respectively).
 */
import { createContext } from "react";

export interface AuthSession {
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
}

export interface AuthContextValue {
  session: AuthSession | null;
  /** Throws the raw grpc-web error (a `ConnectError`) on failure — see `describeAuthError`. */
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  /** Throws the raw grpc-web error (a `ConnectError`) on failure — see `describeAuthError`. */
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
