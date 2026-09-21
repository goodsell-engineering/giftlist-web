import { describe, expect, it } from "vitest";

import { describeSharedGiftListReadError } from "./sharedGiftListErrors";
import {
  GraphQlRequestError,
  GraphQlTransportError,
} from "../../giftlists/api/graphqlClient";

describe("describeSharedGiftListReadError", () => {
  it("DescribeSharedGiftListReadError_ShouldReturnInvalidToken_WhenErrorCodeIsGatewayInvalidShareToken", () => {
    // Arrange — ViewGiftListInteractor's own mapped failure: the token is the wrong shape,
    // rejected before any database round-trip.
    const error = new GraphQlRequestError([
      {
        message: "The share token is not well-formed.",
        extensions: {
          code: "BAD_USER_INPUT",
          errorCode: "gateway.invalid_share_token",
        },
      },
    ]);

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("invalid-token");
    expect(result.message).toMatch(/link doesn't look right/i);
  });

  it("DescribeSharedGiftListReadError_ShouldReturnNotFound_WithGuestCopy_WhenErrorCodeIsGatewayNotFound", () => {
    // Arrange — well-formed token, resolves to nothing. Must not reuse the owner-facing
    // "No gift list exists with this id." wording, which reads oddly to a guest who just
    // followed a link.
    const error = new GraphQlRequestError([
      {
        message: "No gift list exists for this token.",
        extensions: { code: "NOT_FOUND", errorCode: "gateway.not_found" },
      },
    ]);

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("not-found");
    expect(result.message).not.toMatch(/No gift list exists with this id\./);
  });

  it("DescribeSharedGiftListReadError_ShouldFallBackToInvalidToken_WhenTheCategoryIsBadUserInputButTheCodeIsUnrecognised", () => {
    // Arrange
    const error = new GraphQlRequestError([
      {
        message: "Some other bad-input failure.",
        extensions: { code: "BAD_USER_INPUT", errorCode: "some.other_code" },
      },
    ]);

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("invalid-token");
  });

  it("DescribeSharedGiftListReadError_ShouldFallBackToNotFound_WhenTheCategoryIsNotFoundButTheCodeIsUnrecognised", () => {
    // Arrange
    const error = new GraphQlRequestError([
      {
        message: "Some other not-found failure.",
        extensions: { code: "NOT_FOUND", errorCode: "some.other_code" },
      },
    ]);

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeSharedGiftListReadError_ShouldReturnUnavailable_WhenTheRequestNeverProducedAGraphQlResponse", () => {
    // Arrange
    const error = new GraphQlTransportError("Could not reach GiftList.");

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
  });

  it("DescribeSharedGiftListReadError_ShouldReturnUnknown_WhenTheErrorIsNeitherGraphQlShapedType", () => {
    // Arrange
    const error = new TypeError("boom");

    // Act
    const result = describeSharedGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("unknown");
  });
});
