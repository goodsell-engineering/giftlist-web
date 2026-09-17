import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useShareTokenOwnership } from "./useShareTokenOwnership";
import { fetchMyGiftLists } from "../../giftlists/api/giftListQueries";
import type { GiftListProjection } from "../../giftlists/api/giftListQueries";
import {
  AuthContext,
  type AuthContextValue,
} from "../../identity/auth/authContext";

vi.mock("../../giftlists/api/giftListQueries", () => ({
  fetchMyGiftLists: vi.fn(),
}));

const fetchMyGiftListsMock = vi.mocked(fetchMyGiftLists);

const SIGNED_IN_SESSION: AuthContextValue["session"] = {
  userId: "owner-1",
  accessToken: "token-abc",
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const EXPIRED_SESSION: AuthContextValue["session"] = {
  userId: "owner-1",
  accessToken: "token-abc",
  accessTokenExpiresAt: new Date(Date.now() - 1000),
};

function aGiftList(
  overrides: Partial<GiftListProjection> = {},
): GiftListProjection {
  return {
    listId: "list-1",
    ownerId: "owner-1",
    name: "Birthday Wishlist",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    shareToken: "share-token-1",
    createdAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

function withSession(session: AuthContextValue["session"]) {
  const authValue: AuthContextValue = {
    session,
    signUp: async () => {},
    logIn: async () => {},
    logOut: () => {},
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    );
  };
}

describe("useShareTokenOwnership", () => {
  it("UseShareTokenOwnership_ShouldReturnGuest_WhenThereIsNoSession", () => {
    // Arrange
    // Act
    const { result } = renderHook(
      () => useShareTokenOwnership("share-token-1"),
      {
        wrapper: withSession(null),
      },
    );

    // Assert
    expect(result.current).toEqual({ status: "guest" });
    expect(fetchMyGiftListsMock).not.toHaveBeenCalled();
  });

  it("UseShareTokenOwnership_ShouldReturnGuest_WhenTheSessionHasExpired", () => {
    // Arrange
    // Act
    const { result } = renderHook(
      () => useShareTokenOwnership("share-token-1"),
      {
        wrapper: withSession(EXPIRED_SESSION),
      },
    );

    // Assert
    expect(result.current).toEqual({ status: "guest" });
    expect(fetchMyGiftListsMock).not.toHaveBeenCalled();
  });

  it("UseShareTokenOwnership_ShouldStartChecking_ThenResolveToOwner_WhenTheTokenMatchesOneOfTheSignedInUsersOwnLists", async () => {
    // Arrange
    const owned = aGiftList({ shareToken: "share-token-1" });
    fetchMyGiftListsMock.mockResolvedValue([
      aGiftList({ listId: "list-2", shareToken: "some-other-token" }),
      owned,
    ]);

    // Act
    const { result } = renderHook(
      () => useShareTokenOwnership("share-token-1"),
      {
        wrapper: withSession(SIGNED_IN_SESSION),
      },
    );

    // Assert
    expect(result.current).toEqual({ status: "checking" });
    await waitFor(() =>
      expect(result.current).toEqual({ status: "owner", list: owned }),
    );
    expect(fetchMyGiftListsMock).toHaveBeenCalledWith("token-abc");
  });

  it("UseShareTokenOwnership_ShouldResolveToGuest_WhenSignedInButTheTokenIsNotOneOfTheirOwnLists", async () => {
    // Arrange
    fetchMyGiftListsMock.mockResolvedValue([
      aGiftList({ shareToken: "some-other-token" }),
    ]);

    // Act
    const { result } = renderHook(
      () => useShareTokenOwnership("share-token-1"),
      {
        wrapper: withSession(SIGNED_IN_SESSION),
      },
    );

    // Assert
    await waitFor(() => expect(result.current).toEqual({ status: "guest" }));
  });

  it("UseShareTokenOwnership_ShouldFailOpenToGuest_WhenTheOwnershipCheckItselfFails", async () => {
    // Arrange — a network/gateway failure here must never block the page (this file's own doc
    // comment): worst case is the owner seeing the guest view they could always reach anyway.
    fetchMyGiftListsMock.mockRejectedValue(new Error("gateway unavailable"));

    // Act
    const { result } = renderHook(
      () => useShareTokenOwnership("share-token-1"),
      {
        wrapper: withSession(SIGNED_IN_SESSION),
      },
    );

    // Assert
    await waitFor(() => expect(result.current).toEqual({ status: "guest" }));
  });
});
