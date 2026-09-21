/**
 * Mockup: mockups/login.html (screen 2 of 6)
 *
 * Log-in form, wired to the real grpc-web Login command (GL-19). On success the session is held
 * in memory only (see AuthProvider) and the user is sent back to wherever RequireAuth redirected
 * them from (via the router's `location.state.from`), defaulting to /dashboard when there wasn't
 * one — see LogInPage.test.tsx's redirect test. On failure, describeAuthError maps the grpc-web
 * error to a specific, field-relevant message — never a generic toast.
 *
 * Restyled onto AuthCard/Mantine form controls in GL-121 — labels, error copy, the redirect
 * behaviour and the AuthProvider contract are all unchanged from before that story; only the
 * markup changed.
 */
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Anchor,
  Box,
  Button,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { useAuth } from "../auth/useAuth";
import { describeAuthError } from "../api/authErrors";
import { AuthCard } from "../../ui/AuthCard";
import { Brand } from "../../ui/Brand";

interface LocationState {
  from?: { pathname: string };
}

export default function LogInPage() {
  const { session, logIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Computed once, from the same expression, and used by both the paths below that can send the
  // user onward: the early return just below (session already set on this render, e.g. because
  // logIn() just resolved and re-rendered this component before handleSubmit's own navigate()
  // call below gets to run) and handleSubmit's navigate() call. Those two used to disagree — this
  // one always won the race (see RequireAuth's redirect through here) — so a signed-in-mid-render
  // redirect and the post-submit redirect now can only ever go to the same place.
  const redirectTo =
    (location.state as LocationState | null)?.from?.pathname ?? "/dashboard";

  // Already signed in (e.g. followed a stale /login link, or logIn() below just resolved) —
  // nothing left to do here but land wherever RequireAuth sent this user from.
  if (session) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await logIn(email, password);
      navigate(redirectTo, { replace: true });
    } catch (reason) {
      setError(describeAuthError(reason).message);
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCard>
      <Brand />
      <Title order={1} size="h2" mt="xs">
        Welcome back
      </Title>
      <Text c="var(--gl-text-muted)" size="sm" mb="lg">
        Log in to manage your gift lists.
      </Text>
      <Box
        component="form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <Stack gap="md">
          <TextInput
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            withAsterisk={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="current-password"
            required
            withAsterisk={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" fullWidth disabled={isSubmitting}>
            {isSubmitting ? "Logging in…" : "Log in"}
          </Button>
        </Stack>
      </Box>
      <Text ta="center" mt="lg" size="sm" c="var(--gl-text-muted)">
        Don&apos;t have an account?{" "}
        <Anchor component={Link} to="/signup">
          Sign up
        </Anchor>
      </Text>
    </AuthCard>
  );
}
