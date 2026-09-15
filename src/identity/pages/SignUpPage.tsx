/**
 * Mockup: mockups/signup.html (screen 1 of 6)
 *
 * Sign-up form, wired to the real grpc-web SignUp command (GL-19). Password confirmation is
 * checked client-side only (the field doesn't exist on the wire request) — everything else
 * (email format, password length, display name) is validated by Identity and surfaced verbatim
 * via describeAuthError, so there is no duplicated business validation here.
 */
import { useId, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { describeAuthError } from "../api/authErrors";

export default function SignUpPage() {
  const { session, signUp } = useAuth();
  const navigate = useNavigate();

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

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
    <main>
      <h1>Create your account</h1>
      <p>Start a gift list in under a minute.</p>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div>
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={confirmId}>Confirm password</label>
          <input
            id={confirmId}
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
