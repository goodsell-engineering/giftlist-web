/**
 * Mockup: mockups/signup.html (screen 1 of 6)
 *
 * Sign-up form, wired to the real grpc-web SignUp command (GL-19). Password confirmation is
 * checked client-side only (the field doesn't exist on the wire request) — everything else
 * (email format, password length, display name) is validated by Identity and surfaced verbatim
 * via describeAuthError, so there is no duplicated business validation here.
 *
 * Restyled onto AuthCard/Mantine form controls in GL-121 — labels, error copy, the AuthProvider
 * contract and the client-side password-match check are all unchanged from before that story; only
 * the markup changed.
 */
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
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

export default function SignUpPage() {
  const { session, signUp } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signUp(email, password, displayName);
      navigate("/dashboard", { replace: true });
    } catch (reason) {
      setError(describeAuthError(reason).message);
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCard>
      <Brand />
      <Title order={1} size="h2" mt="xs">
        Create your account
      </Title>
      <Text c="var(--gl-text-muted)" size="sm" mb="lg">
        Start a gift list in under a minute.
      </Text>
      <Box
        component="form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            name="name"
            type="text"
            autoComplete="name"
            required
            withAsterisk={false}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
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
            autoComplete="new-password"
            required
            withAsterisk={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordInput
            label="Confirm password"
            name="confirm"
            autoComplete="new-password"
            required
            withAsterisk={false}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" fullWidth disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
        </Stack>
      </Box>
      <Text ta="center" mt="lg" size="sm" c="var(--gl-text-muted)">
        Already have an account?{" "}
        <Anchor component={Link} to="/login">
          Log in
        </Anchor>
      </Text>
    </AuthCard>
  );
}
