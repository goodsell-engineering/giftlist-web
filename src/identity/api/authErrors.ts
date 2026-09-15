/**
 * Maps a failed grpc-web call from {@link authClient} onto a specific, user-facing message
 * (GL-19) — Phase 1's exit criteria explicitly rule out a generic toast/500 for these calls.
 *
 * Branches on the stable `Error.Code` first, not the gRPC status. `ErrorToRpcExceptionMapper`
 * (gateway/src/Gateway.Infrastructure/Platform/Transport/ErrorToRpcExceptionMapper.cs) puts that
 * code on the `giftlist-error-code` trailer for *every* error it maps, and CONVENTIONS.md "Errors"'s
 * status table is many-to-one: `ABORTED` is every `Conflict` from every service, `UNAUTHENTICATED`
 * is every `Unauthenticated` failure — not just "bad password". Branching on the gRPC status
 * alone would render "That email is already registered" for some other service's conflict, or
 * "Email or password is incorrect" for e.g. an expired token, the moment either exists. The gRPC
 * status switch below only ever runs as a fallback, for a code this file doesn't recognise (or a
 * response with no trailer at all — e.g. something that never went through the mapper).
 */
import { Code, ConnectError } from "@connectrpc/connect";

// Mirrors ErrorToRpcExceptionMapper.ErrorCodeTrailerName (gateway/src/Gateway.Infrastructure/
// Platform/Transport/ErrorToRpcExceptionMapper.cs) — lowercase, exact string, not derivable from
// generated TS since it's a Gateway-side constant with no shared codegen.
const ERROR_CODE_TRAILER = "giftlist-error-code";

// Mirrors RequestReplyErrors.ReplyTimeoutCode (buildingblocks/src/BuildingBlocks/Messaging/
// RequestReply/RequestReplyErrors.cs) — the code the request/reply bridge uses when Identity
// never replies in time, as opposed to a genuine broker/service outage.
const REPLY_TIMEOUT_CODE = "messaging.reply_timeout";

/** Which branch of the mapping fired — tests pin this, not just the rendered string. */
export type AuthErrorKind =
  | "invalid-credentials"
  | "email-already-registered"
  | "validation"
  | "reply-timeout"
  | "unauthenticated"
  | "conflict"
  | "unavailable"
  | "unknown";

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  message: string;
}

// Stable, per-code messages this file knows specifically — mirrors identity/src/
// Identity.Application/Users/UserErrors.cs's codes plus BuildingBlocks' reply-timeout code.
// Deliberately does *not* include the Validation codes (identity.email_invalid,
// identity.password_too_short, etc.): those carry a dynamic, already-user-safe message from the
// server (CONVENTIONS.md "Errors") that this file would only be re-deriving worse, so they're handled
// by the InvalidArgument fallback below instead, via `error.rawMessage`.
const KNOWN_ERROR_CODES: Readonly<Record<string, AuthErrorInfo>> = {
  "identity.invalid_credentials": {
    kind: "invalid-credentials",
    message:
      "Email or password is incorrect. Check your details and try again.",
  },
  "identity.email_already_registered": {
    kind: "email-already-registered",
    message: "That email is already registered. Try logging in instead.",
  },
  [REPLY_TIMEOUT_CODE]: {
    kind: "reply-timeout",
    message:
      "This is taking longer than expected. Your request may still be processing " +
      "— please wait a moment and try again.",
  },
};

export function describeAuthError(reason: unknown): AuthErrorInfo {
  const error = ConnectError.from(reason);
  const giftlistErrorCode = error.metadata.get(ERROR_CODE_TRAILER);

  const known = giftlistErrorCode
    ? KNOWN_ERROR_CODES[giftlistErrorCode]
    : undefined;
  if (known) {
    return known;
  }

  // No trailer, or a code this file has no specific wording for yet. Kept deliberately generic
  // per status — see the file header for why picking a *specific* known-code message here (e.g.
  // "your password is wrong") would be wrong for a code we don't actually recognise.
  switch (error.code) {
    case Code.Unauthenticated:
      return { kind: "unauthenticated", message: "Please log in again." };

    case Code.Aborted:
      return {
        kind: "conflict",
        message:
          "That didn't go through because of a conflicting change. Please try again.",
      };

    case Code.InvalidArgument:
      // Identity's Error.Message never contains PII and is written to be shown to a user
      // (CONVENTIONS.md "Errors") — e.g. "Enter a valid email address.", "Password must be at least
      // 8 characters." Surfacing it directly avoids re-deriving per-field copy client-side, and
      // there's nothing to key on by code here: every validation failure is InvalidArgument.
      return {
        kind: "validation",
        message:
          error.rawMessage || "Check the details you entered and try again.",
      };

    case Code.Unavailable:
      return {
        kind: "unavailable",
        message:
          "GiftList is temporarily unavailable. Please try again shortly.",
      };

    default:
      return {
        kind: "unknown",
        message: "Something went wrong. Please try again.",
      };
  }
}
