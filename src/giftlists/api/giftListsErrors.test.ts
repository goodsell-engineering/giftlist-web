import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

import { describeGiftListsCommandError } from "./giftListsErrors";

describe("describeGiftListsCommandError", () => {
  it("DescribeGiftListsCommandError_ShouldReturnInvalidId_WhenTheTrailerCarriesInvalidIdCode", () => {
    // Arrange — GiftListsGrpcService.ParseId's own mapped failure.
    const error = new ConnectError(
      "A required identifier was missing or invalid.",
      Code.InvalidArgument,
      { "giftlist-error-code": "gateway.invalid_id" },
    );

    // Act
    const result = describeGiftListsCommandError(error);

    // Assert
    expect(result.kind).toBe("invalid-id");
    expect(result.message).toMatch(/identified/i);
  });

  it("DescribeGiftListsCommandError_ShouldReturnMissingExpiry_WhenTheTrailerCarriesMissingExpiryCode", () => {
    // Arrange
    const error = new ConnectError(
      "An expiry date is required.",
      Code.InvalidArgument,
      { "giftlist-error-code": "gateway.missing_expiry" },
    );

    // Act
    const result = describeGiftListsCommandError(error);

    // Assert
    expect(result.kind).toBe("missing-expiry");
    expect(result.message).toMatch(/expiry/i);
  });

  it("DescribeGiftListsCommandError_ShouldReturnUnauthenticated_WhenStatusIsUnauthenticatedWithNoTrailer", () => {
    // Arrange — RequireAuthorization() rejecting an absent/expired token; ASP.NET's own
    // authentication middleware raises this before ErrorToRpcExceptionMapper ever runs, so there
    // is no giftlist-error-code trailer to read here.
    const error = new ConnectError("", Code.Unauthenticated);

    // Act
    const result = describeGiftListsCommandError(error);

    // Assert
    expect(result.kind).toBe("unauthenticated");
    expect(result.message).toMatch(/log in/i);
  });

  it("DescribeGiftListsCommandError_ShouldReturnUnavailable_WhenStatusIsUnavailable", () => {
    // Arrange
    const error = new ConnectError("unavailable", Code.Unavailable);

    // Act
    const result = describeGiftListsCommandError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
  });

  it("DescribeGiftListsCommandError_ShouldReturnUnknown_WhenTheErrorIsNotAConnectError", () => {
    // Arrange — e.g. a network-level failure the grpc-web transport didn't wrap.
    const error = new TypeError("Failed to fetch");

    // Act
    const result = describeGiftListsCommandError(error);

    // Assert
    expect(result.kind).toBe("unknown");
  });
});
