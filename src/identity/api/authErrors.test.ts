import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

import { describeAuthError } from "./authErrors";

// Every case here pins the specific message a user sees, not just "an error happened" — Phase 1's
// exit criteria rule out a generic toast, and this file is the one place that decides the wording.
describe("describeAuthError", () => {
  it("DescribeAuthError_ShouldReturnInvalidCredentials_WhenTheTrailerCarriesInvalidCredentialsCode", () => {
    // Arrange — the real Gateway always sets this trailer (ErrorToRpcExceptionMapper puts
    // Error.Code on it for every mapped error), so a realistic UNAUTHENTICATED carries it too.
    const error = new ConnectError(
      "Email or password is incorrect.",
      Code.Unauthenticated,
      {
        "giftlist-error-code": "identity.invalid_credentials",
      },
    );

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("invalid-credentials");
    expect(result.message).toMatch(/incorrect/i);
  });

  it("DescribeAuthError_ShouldReturnEmailAlreadyRegistered_WhenTheTrailerCarriesEmailAlreadyRegisteredCode", () => {
    // Arrange
    const error = new ConnectError(
      "A user with this email is already registered.",
      Code.Aborted,
      { "giftlist-error-code": "identity.email_already_registered" },
    );

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("email-already-registered");
    expect(result.message).toMatch(/already registered/i);
  });

  it("DescribeAuthError_ShouldSurfaceServerMessage_WhenCodeIsInvalidArgument", () => {
    // Arrange — Identity's Error.Message is written to be shown to a user (CONVENTIONS.md "Errors"),
    // so validation failures pass it straight through rather than a generic re-derived string.
    // Validation codes (identity.password_too_short here) are deliberately not in the known-code
    // table — the message is dynamic per field, so this falls back to the InvalidArgument status.
    const error = new ConnectError(
      "Password must be at least 8 characters.",
      Code.InvalidArgument,
      {
        "giftlist-error-code": "identity.password_too_short",
      },
    );

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("validation");
    expect(result.message).toBe("Password must be at least 8 characters.");
  });

  it("DescribeAuthError_ShouldReturnReplyTimeout_WhenTheTrailerCarriesTheReplyTimeoutCode", () => {
    // Arrange — the exact scenario ErrorToRpcExceptionMapper documents: a reply-timeout UNAVAILABLE
    // is distinguishable only via the giftlist-error-code trailer, not the bare gRPC status.
    const error = new ConnectError("unavailable", Code.Unavailable, {
      "giftlist-error-code": "messaging.reply_timeout",
    });

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("reply-timeout");
    expect(result.message).toMatch(/still be processing/i);
  });

  it("DescribeAuthError_ShouldReturnGenericUnavailable_WhenUnavailableCarriesNoErrorCodeTrailer", () => {
    // Arrange — a genuine outage: same gRPC status as the reply-timeout case, but no trailer at
    // all, which is exactly the ambiguity the trailer exists to resolve.
    const error = new ConnectError("unavailable", Code.Unavailable);

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
    expect(result.message).not.toMatch(/still be processing/i);
  });

  it("DescribeAuthError_ShouldReturnGenericUnavailable_WhenUnavailableCarriesADifferentErrorCodeTrailer", () => {
    // Arrange — an UNAVAILABLE that carries a real code, just not the reply-timeout one, must not
    // be mistaken for "still working on it".
    const error = new ConnectError("unavailable", Code.Unavailable, {
      "giftlist-error-code": "messaging.broker_unreachable",
    });

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
  });

  it("DescribeAuthError_ShouldReturnGenericUnauthenticated_WhenUnauthenticatedCarriesAnUnrecognisedCode", () => {
    // Arrange — e.g. a not-yet-modelled "your session expired" failure. Must not be mislabelled
    // as "your password is wrong" just because it shares Unauthenticated's gRPC status with
    // identity.invalid_credentials — that mislabel is exactly what branching on status first did.
    const error = new ConnectError("token expired", Code.Unauthenticated, {
      "giftlist-error-code": "identity.token_expired",
    });

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("unauthenticated");
    expect(result.message).not.toMatch(/password/i);
  });

  it("DescribeAuthError_ShouldReturnGenericConflict_WhenAbortedCarriesAnUnrecognisedCode", () => {
    // Arrange — some other service's Conflict, sharing ABORTED with
    // identity.email_already_registered but not the same code. Must not render "email already
    // registered" for a conflict that has nothing to do with email.
    const error = new ConnectError("conflict", Code.Aborted, {
      "giftlist-error-code": "giftlist.expired",
    });

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("conflict");
    expect(result.message).not.toMatch(/email/i);
  });

  it("DescribeAuthError_ShouldReturnUnknown_WhenTheErrorIsNotAConnectError", () => {
    // Arrange — e.g. a network-level failure the grpc-web transport didn't wrap.
    const error = new TypeError("Failed to fetch");

    // Act
    const result = describeAuthError(error);

    // Assert
    expect(result.kind).toBe("unknown");
  });
});
