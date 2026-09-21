import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import SharedListPage from "./SharedListPage";
import { useSharedGiftList } from "../hooks/useSharedGiftList";
import type { SharedGiftListState } from "../hooks/useSharedGiftList";
import { useReserveGift } from "../hooks/useReserveGift";
import type {
  ItemReservationUiState,
  UseReserveGiftResult,
} from "../hooks/useReserveGift";
import type { ReserveGiftErrorInfo } from "../api/reservationsErrors";

vi.mock("../hooks/useSharedGiftList", () => ({
  useSharedGiftList: vi.fn(),
}));
vi.mock("../hooks/useReserveGift", () => ({
  useReserveGift: vi.fn(),
}));

const useSharedGiftListMock = vi.mocked(useSharedGiftList);
const useReserveGiftMock = vi.mocked(useReserveGift);
const refetchMock = vi.fn();
const reserveMock = vi.fn();
const dismissConflictMock = vi.fn();

function setState(state: SharedGiftListState) {
  useSharedGiftListMock.mockReturnValue({ state, refetch: refetchMock });
}

/**
 * Defaults every item to `"available"` and no error — most tests only care about one item's
 * state, so `stateFor`/`errorFor` here are simple constant functions a test overrides only when
 * the item id actually matters (the per-item error test below).
 */
function setReserveGift(overrides: Partial<UseReserveGiftResult> = {}) {
  useReserveGiftMock.mockReturnValue({
    reserve: reserveMock,
    stateFor: () => "available",
    errorFor: () => null,
    dismissConflict: dismissConflictMock,
    ...overrides,
  });
}

function stateForConstant(uiState: ItemReservationUiState) {
  return () => uiState;
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
  afterEach(() => {
    refetchMock.mockClear();
    reserveMock.mockClear();
    dismissConflictMock.mockClear();
  });

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
            reserved: false,
          },
        ],
      },
    });
    setReserveGift();

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

  it("SharedListPage_ShouldShowTheReserveButtonAndCallReserveWithTheItemId_WhenTheItemIsAvailable", async () => {
    // Arrange
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
            reserved: false,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("available") });
    const user = userEvent.setup();

    // Act
    renderSharedListPage();
    await user.click(
      screen.getByRole("button", { name: "Reserve this gift" }),
    );

    // Assert
    expect(reserveMock).toHaveBeenCalledWith("item-1");
  });

  it("SharedListPage_ShouldShowYouReservedThisWithNoButton_WhenTheStateIsReservedByYou", () => {
    // Arrange — the client-side-only "you reserved this" state (ARCHITECTURE.md "Nobody can see
    // *who* reserved"): never sourced from `item.reserved`, which this fixture leaves `false` on
    // purpose to prove `uiState` alone drives this, not the server field.
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          {
            itemId: "item-1",
            name: "Monstera Plant",
            description: null,
            url: null,
            reserved: false,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("reserved-by-you") });

    // Act
    renderSharedListPage();

    // Assert
    const itemRow = screen.getByText("Monstera Plant").closest("li");
    expect(itemRow).toHaveTextContent("You reserved this");
    expect(itemRow).toHaveTextContent(/remembered locally/i);
    expect(
      screen.queryByRole("button", { name: /reserve this gift/i }),
    ).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldShowASomeoneJustTookThisOneNotice_WhenTheStateIsJustTaken", async () => {
    // Arrange — the race-safe rollback state: this browser tried to reserve it and lost. Not an
    // error toast (this ticket's own scope note): rendered inline, with a way to dismiss it, not
    // as a modal or a page-level alert.
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          {
            itemId: "item-1",
            name: "Espresso Machine",
            description: null,
            url: null,
            reserved: true,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("just-taken") });
    const user = userEvent.setup();

    // Act
    renderSharedListPage();

    // Assert
    const itemRow = screen.getByText("Espresso Machine").closest("li");
    expect(itemRow).toHaveTextContent(/someone just took this one/i);
    expect(
      screen.queryByRole("button", { name: /reserve this gift/i }),
    ).not.toBeInTheDocument();

    // Act — dismissing folds it back into the plain "Reserved" badge.
    await user.click(screen.getByRole("button", { name: "OK" }));

    // Assert
    expect(dismissConflictMock).toHaveBeenCalledWith("item-1");
  });

  it("SharedListPage_ShouldRenderOnlyTheReservedBadgeWithNoButtonOrIdentifyingDetail_WhenTheItemIsReservedBySomeoneElse", () => {
    // Arrange — ARCHITECTURE.md "Reservation privacy": nobody ever sees who reserved a gift. The
    // only reservation fact rendered for an item this browser did not reserve itself is the
    // plain "✓ Reserved" badge — no name, no timestamp, nothing that could correlate it to a
    // person, and (this file's own header) no server field exists to render one from even if a
    // future edit tried.
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
            reserved: true,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("reserved") });

    // Act
    renderSharedListPage();

    // Assert
    const itemRow = screen.getByText("Headphones").closest("li");
    expect(itemRow).not.toBeNull();
    expect(itemRow).toHaveTextContent("Reserved");
    expect(itemRow).not.toHaveTextContent(/you reserved this/i);
    expect(itemRow).not.toHaveTextContent(/someone just took this one/i);
    expect(
      screen.queryByRole("button", { name: /reserve/i }),
    ).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldRenderThePerItemErrorMessage_WhenReservingFailedForAReasonThatIsNotARace", () => {
    // Arrange — e.g. `reservation.giftlist_expired`: an ordinary, per-item error, not a page-level
    // one — the rest of the list stays usable.
    const error: ReserveGiftErrorInfo = {
      kind: "expired",
      message: "This gift list has expired and can no longer accept reservations.",
    };
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
            reserved: false,
          },
        ],
      },
    });
    setReserveGift({
      stateFor: stateForConstant("available"),
      errorFor: (itemId) => (itemId === "item-1" ? error : null),
    });

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This gift list has expired and can no longer accept reservations.",
    );
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
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByText("Ada's Birthday Wishlist")).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldShowALoadingMessage_WhenStatusIsLoading", () => {
    // Arrange
    setState({ status: "loading" });
    setReserveGift();

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
    setReserveGift();

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
    setReserveGift();
    const user = userEvent.setup();

    // Act
    renderSharedListPage();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    // Assert
    expect(refetchMock).toHaveBeenCalled();
  });
});
