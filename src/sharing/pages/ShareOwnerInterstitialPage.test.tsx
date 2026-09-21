import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ShareOwnerInterstitialPage from "./ShareOwnerInterstitialPage";
import type { GiftListProjection } from "../../giftlists/api/giftListQueries";

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

function renderInterstitial(
  onContinueAsGuest: () => void,
  list: GiftListProjection = aGiftList(),
) {
  return render(
    <MemoryRouter initialEntries={["/share/share-token-1"]}>
      <Routes>
        <Route
          path="/share/:shareToken"
          element={
            <ShareOwnerInterstitialPage
              list={list}
              onContinueAsGuest={onContinueAsGuest}
            />
          }
        />
        <Route
          path="/lists/:listId"
          element={<div>Owner list detail page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ShareOwnerInterstitialPage", () => {
  it("ShareOwnerInterstitialPage_ShouldNameTheOwnedList_WhenRendered", () => {
    // Arrange
    // Act
    renderInterstitial(vi.fn(), aGiftList({ name: "Ada's Birthday Wishlist" }));

    // Assert
    expect(screen.getByText("This is your own list")).toBeInTheDocument();
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
  });

  it("ShareOwnerInterstitialPage_ShouldNeverRenderAnyReservationState_WhenRendered", () => {
    // Arrange — ARCHITECTURE.md "Nobody can see who reserved": even on the one page that admits
    // the owner is deliberately peeking, nobody is ever shown *who* reserved anything.
    // Act
    renderInterstitial(vi.fn());

    // Assert
    expect(screen.queryByText(/reserved by/i)).not.toBeInTheDocument();
  });

  it("ShareOwnerInterstitialPage_ShouldNavigateToTheOwnersListDetailPage_WhenTakeMeBackIsClicked", async () => {
    // Arrange
    const user = userEvent.setup();
    renderInterstitial(vi.fn(), aGiftList({ listId: "list-42" }));

    // Act
    await user.click(
      screen.getByRole("button", { name: "Take me back to my list" }),
    );

    // Assert
    expect(screen.getByText("Owner list detail page")).toBeInTheDocument();
  });

  it("ShareOwnerInterstitialPage_ShouldCallOnContinueAsGuest_WhenTheGuestViewButtonIsClicked", async () => {
    // Arrange
    const onContinueAsGuest = vi.fn();
    const user = userEvent.setup();
    renderInterstitial(onContinueAsGuest);

    // Act
    await user.click(
      screen.getByRole("button", {
        name: "I understand, show me the guest view",
      }),
    );

    // Assert
    expect(onContinueAsGuest).toHaveBeenCalledTimes(1);
  });
});
