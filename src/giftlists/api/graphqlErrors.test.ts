import { describe, expect, it } from "vitest";

import { describeGiftListReadError } from "./graphqlErrors";
import { GraphQlRequestError, GraphQlTransportError } from "./graphqlClient";

describe("describeGiftListReadError", () => {
  it("DescribeGiftListReadError_ShouldReturnNotFound_WhenErrorCodeIsGatewayNotFound", () => {
    // Arrange — GetGiftListInteractor's own mapped failure (ErrorToGraphQlErrorMapper).
    const error = new GraphQlRequestError([
      {
        message: "No gift list exists with this id.",
        extensions: { code: "NOT_FOUND", errorCode: "gateway.not_found" },
      },
    ]);

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeGiftListReadError_ShouldReturnForbidden_WhenErrorCodeIsGatewayForbidden", () => {
    // Arrange — the ownership check GetGiftListInteractor's own doc comment calls "the security
    // boundary the whole read model exists behind".
    const error = new GraphQlRequestError([
      {
        message: "You do not own this gift list.",
        extensions: { code: "FORBIDDEN", errorCode: "gateway.forbidden" },
      },
    ]);

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("forbidden");
    expect(result.message).toMatch(/do not own/i);
  });

  it("DescribeGiftListReadError_ShouldReturnUnauthenticated_WhenErrorCodeIsGatewayUnauthenticated", () => {
    // Arrange — HttpContextExtensions.RequireUserId's own mapped failure.
    const error = new GraphQlRequestError([
      {
        message: "A valid access token is required.",
        extensions: {
          code: "UNAUTHENTICATED",
          errorCode: "gateway.unauthenticated",
        },
      },
    ]);

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("unauthenticated");
  });

  it("DescribeGiftListReadError_ShouldFallBackToCategory_WhenErrorCodeIsUnrecognised", () => {
    // Arrange — a NOT_FOUND category this file has no specific errorCode entry for yet (e.g. a
    // future use case reusing NOT_FOUND under a code this file doesn't know). Must still resolve
    // to "not-found", not "unknown" — falling all the way through here would silently regress
    // every future NOT_FOUND-shaped failure to the generic message.
    const error = new GraphQlRequestError([
      {
        message: "Some other not-found failure.",
        extensions: { code: "NOT_FOUND", errorCode: "some.other_code" },
      },
    ]);

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeGiftListReadError_ShouldReturnUnavailable_WhenTheRequestNeverProducedAGraphQlResponse", () => {
    // Arrange — the transport itself failed (e.g. the Gateway is down), never mind GraphQL.
    const error = new GraphQlTransportError("Could not reach GiftList.");

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
  });

  it("DescribeGiftListReadError_ShouldReturnUnknown_WhenTheErrorIsNeitherGraphQlErrorType", () => {
    // Arrange
    const error = new TypeError("boom");

    // Act
    const result = describeGiftListReadError(error);

    // Assert
    expect(result.kind).toBe("unknown");
  });
});
