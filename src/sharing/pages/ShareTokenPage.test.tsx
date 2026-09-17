import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ShareTokenPage from "./ShareTokenPage";
import { useShareTokenOwnership } from "../hooks/useShareTokenOwnership";
import type { ShareTokenOwnershipState } from "../hooks/useShareTokenOwnership";
import { useSharedGiftList } from "../hooks/useSharedGiftList";
import type { SharedGiftListState } from "../hooks/useSharedGiftList";
import type { GiftListProjection } from "../../giftlists/api/giftListQueries";

vi.mock("../hooks/useShareTokenOwnership", () => ({
  useShareTokenOwnership: vi.fn(),
}));
vi.mock("../hooks/useSharedGiftList", () => ({
  useSharedGiftList: vi.fn(),
}));

const useShareTokenOwnershipMock = vi.mocked(useShareTokenOwnership);
const useSharedGiftListMock = vi.mocked(useSharedGiftList);

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

function setOwnership(state: ShareTokenOwnershipState) {
  useShareTokenOwnershipMock.mockReturnValue(state);
}

function setSharedState(state: SharedGiftListState) {
  useSharedGiftListMock.mockReturnValue({ state, refetch: vi.fn() });
}

function renderShareTokenPage(initialPath = "/share/share-token-1") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/share/:shareToken" element={<ShareTokenPage />} />
        <Route
          path="/lists/:listId"
          element={<div>Owner list detail page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ShareTokenPage", () => {
  it("ShareTokenPage_ShouldShowALoadingState_WhileOwnershipIsBeingChecked", () => {
    // Arrange
    setOwnership({ status: "checking" });

    // Act
    renderShareTokenPage();

    // Assert
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(useSharedGiftListMock).not.toHaveBeenCalled();
  });

  it("ShareTokenPage_ShouldRenderTheGuestView_WhenTheViewerIsNotTheOwner", () => {
    // Arrange
    setOwnership({ status: "guest" });
    setSharedState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [],
      },
    });

    // Act
    renderShareTokenPage();

    // Assert
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
    expect(screen.queryByText("This is your own list")).not.toBeInTheDocument();
  });

  it("ShareTokenPage_ShouldRenderTheSpoilerInterstitial_WhenTheViewerIsSignedInAsTheOwner", () => {
    // Arrange
    setOwnership({
      status: "owner",
      list: aGiftList({ name: "Ada's Birthday Wishlist" }),
    });

    // Act
    renderShareTokenPage();

    // Assert
    expect(screen.getByText("This is your own list")).toBeInTheDocument();
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
    expect(useSharedGiftListMock).not.toHaveBeenCalled();
  });

  it("ShareTokenPage_ShouldSwitchToTheGuestView_WhenTheOwnerChoosesToContinueAsGuest", async () => {
    // Arrange — the one deliberate act ARCHITECTURE.md "Owner shouldn't see what's reserved"
    // asks for: clicking through is a choice, not a default.
    setOwnership({
      status: "owner",
      list: aGiftList({ name: "Ada's Birthday Wishlist" }),
    });
    setSharedState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [],
      },
    });
    const user = userEvent.setup();

    // Act
    renderShareTokenPage();
    await user.click(
      screen.getByRole("button", {
        name: "I understand, show me the guest view",
      }),
    );

    // Assert
    expect(screen.queryByText("This is your own list")).not.toBeInTheDocument();
    expect(screen.getByText("Shared gift list")).toBeInTheDocument();
  });
});
