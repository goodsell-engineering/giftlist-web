import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

import { describeReserveGiftError } from "./reservationsErrors";

describe("describeReserveGiftError", () => {
  it("DescribeReserveGiftError_ShouldReturnAlreadyReserved_WhenTheTrailerCarriesReservationAlreadyReservedCode", () => {
    // Arrange — ReserveGiftInteractor's own mapped failure, the losing side of the race.
    const error = new ConnectError(
      "This gift has already been reserved.",
      Code.Aborted,
      { "giftlist-error-code": "reservation.already_reserved" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("already-reserved");
  });

  it("DescribeReserveGiftError_ShouldReturnExpired_WhenTheTrailerCarriesReservationGiftlistExpiredCode", () => {
    // Arrange
    const error = new ConnectError(
      "This gift list has expired and can no longer accept reservations.",
      Code.Aborted,
      { "giftlist-error-code": "reservation.giftlist_expired" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("expired");
    expect(result.message).toMatch(/expired/i);
  });

  it("DescribeReserveGiftError_ShouldReturnNotFound_WhenTheTrailerCarriesReservationGiftlistNotFoundCode", () => {
    // Arrange
    const error = new ConnectError(
      "No such gift list exists.",
      Code.NotFound,
      { "giftlist-error-code": "reservation.giftlist_not_found" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeReserveGiftError_ShouldReturnNotFound_WhenTheTrailerCarriesReservationGiftlistDeletedCode", () => {
    // Arrange
    const error = new ConnectError(
      "This gift list no longer exists.",
      Code.NotFound,
      { "giftlist-error-code": "reservation.giftlist_deleted" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeReserveGiftError_ShouldReturnNotFound_WhenTheTrailerCarriesReservationGiftitemNotFoundCode", () => {
    // Arrange
    const error = new ConnectError(
      "No such gift item exists on this list.",
      Code.NotFound,
      { "giftlist-error-code": "reservation.giftitem_not_found" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeReserveGiftError_ShouldReturnInvalidToken_WhenTheTrailerCarriesGatewayInvalidShareTokenCode", () => {
    // Arrange — ReservationsGrpcService's own share-token shape check, before the command ever
    // reaches the bus.
    const error = new ConnectError(
      "A share token must be 21 alphanumeric characters.",
      Code.InvalidArgument,
      { "giftlist-error-code": "gateway.invalid_share_token" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("invalid-token");
  });

  it("DescribeReserveGiftError_ShouldReturnNotFound_WhenTheTrailerCarriesGatewayNotFoundCode", () => {
    // Arrange — a well-formed token that resolves to no list.
    const error = new ConnectError(
      "No gift list exists with this id.",
      Code.NotFound,
      { "giftlist-error-code": "gateway.not_found" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("not-found");
  });

  it("DescribeReserveGiftError_ShouldReturnInvalidId_WhenTheTrailerCarriesGatewayInvalidIdCode", () => {
    // Arrange
    const error = new ConnectError(
      "A required identifier was missing or invalid.",
      Code.InvalidArgument,
      { "giftlist-error-code": "gateway.invalid_id" },
    );

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("invalid-id");
  });

  it("DescribeReserveGiftError_ShouldReturnUnavailable_WhenStatusIsUnavailableWithNoTrailer", () => {
    // Arrange — e.g. RequestReplyBridge's own reply-timeout, mapped generically.
    const error = new ConnectError("unavailable", Code.Unavailable);

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("unavailable");
  });

  it("DescribeReserveGiftError_ShouldReturnUnknown_WhenTheErrorIsNotAConnectError", () => {
    // Arrange — e.g. a network-level failure the grpc-web transport didn't wrap.
    const error = new TypeError("Failed to fetch");

    // Act
    const result = describeReserveGiftError(error);

    // Assert
    expect(result.kind).toBe("unknown");
  });
});
