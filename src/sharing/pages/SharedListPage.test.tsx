import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import SharedListPage from "./SharedListPage";
import { useSharedGiftList } from "../hooks/useSharedGiftList";
import type { SharedGiftListState } from "../hooks/useSharedGiftList";

vi.mock("../hooks/useSharedGiftList", () => ({
  useSharedGiftList: vi.fn(),
}));

const useSharedGiftListMock = vi.mocked(useSharedGiftList);
const refetchMock = vi.fn();

function setState(state: SharedGiftListState) {
  useSharedGiftListMock.mockReturnValue({ state, refetch: refetchMock });
}

function renderSharedListPage() {
  return render(
    <MemoryRouter initialEntries={["/share/kQ7v-2xR9mZpL3wYbT1s"]}>
      <Routes>
        <Route path="/share/:shareToken" element={<SharedListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SharedListPage", () => {
  it("SharedListPage_ShouldRenderTheListAndItsItems_WhenReady", () => {
    // Arrange
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 42 * 86_400_000).toISOString(),
        items: [
          {
            itemId: "item-1",
            name: "Wireless Headphones",
            description: "Noise-cancelling, any colour",
            url: "https://example.com/headphones",
          },
        ],
      },
    });

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument();
    expect(
      screen.getByText("Noise-cancelling, any colour"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://example.com/headphones" }),
    ).toHaveAttribute("href", "https://example.com/headphones");
  });

  it("SharedListPage_ShouldNeverRenderAnyReservationStateOnAnItem_WhenReady", () => {
    // Arrange — ARCHITECTURE.md "Reservation privacy": nobody ever sees who reserved a gift, and
    // this ticket builds no reserve affordance at all yet (Phase 4). SharedGiftItem carries no
    // such field (see sharedGiftListQueries.ts), so this also pins that nothing renders one later
    // without this test failing first.
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          {
            itemId: "item-1",
            name: "Headphones",
            description: null,
            url: null,
          },
        ],
      },
    });

    // Act
    renderSharedListPage();

    // Assert
    const itemRow = screen.getByText("Headphones").closest("li");
    expect(itemRow).not.toBeNull();
    expect(itemRow).not.toHaveTextContent(/reserved/i);
    expect(itemRow).not.toHaveTextContent(/available/i);
    expect(
      screen.queryByRole("button", { name: /reserve/i }),
    ).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldRenderTheExpiryDateWithNoExpiredBanner_WhenTheListIsAlreadyExpired", () => {
    // Arrange — Ryan's decision, 2026-09-16: an expired list stays visible through the share
    // link, read-only. The expired banner is GL-42's job, not this ticket's — this pins that this
    // ticket does not jump ahead and build one.
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        items: [],
      },
    });

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldShowALoadingMessage_WhenStatusIsLoading", () => {
    // Arrange
    setState({ status: "loading" });

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByText("Loading shared list…")).toBeInTheDocument();
  });

  it("SharedListPage_ShouldShowTheGuestFacingMessage_WhenTheTokenDoesNotResolve", () => {
    // Arrange
    setState({
      status: "error",
      info: {
        kind: "not-found",
        message: "This list isn't available any more.",
      },
    });

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This list isn't available any more.",
    );
  });

  it("SharedListPage_ShouldOfferToTryAgain_WhenTheFailureIsTransportUnavailable", async () => {
    // Arrange
    setState({
      status: "error",
      info: {
        kind: "unavailable",
        message: "GiftList is temporarily unavailable.",
      },
    });
    const user = userEvent.setup();

    // Act
    renderSharedListPage();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    // Assert
    expect(refetchMock).toHaveBeenCalled();
  });
});
