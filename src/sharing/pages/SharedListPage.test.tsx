import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "../../test/render";
import { elementsWithExactTextContent } from "../../test/textContent";
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
import type {
  SharedGiftItem,
  SharedGiftListView,
} from "../api/sharedGiftListQueries";
import { fetchSharedGiftList } from "../api/sharedGiftListQueries";
import { subscribeToSharedGiftListChanged } from "../api/sharedGiftListSubscription";
import { aShareToken } from "../../test/shareTokens";

vi.mock("../hooks/useSharedGiftList", () => ({
  useSharedGiftList: vi.fn(),
}));
vi.mock("../hooks/useReserveGift", () => ({
  useReserveGift: vi.fn(),
}));

vi.mock("../api/sharedGiftListQueries", () => ({
  fetchSharedGiftList: vi.fn(),
}));
vi.mock("../api/sharedGiftListSubscription", () => ({
  subscribeToSharedGiftListChanged: vi.fn(),
}));

const fetchSharedGiftListMock = vi.mocked(fetchSharedGiftList);
const subscribeMock = vi.mocked(subscribeToSharedGiftListChanged);
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

function anItem(overrides: Partial<SharedGiftItem> = {}): SharedGiftItem {
  return {
    itemId: "item-1",
    name: "Item",
    description: null,
    url: null,
    reserved: false,
    priority: 3,
    ...overrides,
  };
}

function readyState(
  items: SharedGiftItem[],
  expiresAt = new Date(Date.now() + 86_400_000).toISOString(),
): { status: "ready"; giftList: SharedGiftListView } {
  return {
    status: "ready",
    giftList: { listId: "list-1", name: "Ada's Birthday Wishlist", expiresAt, items },
  };
}

function renderSharedListPage() {
  return render(
    <MemoryRouter initialEntries={[`/share/${aShareToken()}`]}>
      <Routes>
        <Route path="/share/:shareToken" element={<SharedListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SharedListPage", () => {
  afterEach(() => {
    refetchMock.mockClear();
    fetchSharedGiftListMock.mockReset();
    subscribeMock.mockReset();
    reserveMock.mockClear();
    dismissConflictMock.mockClear();
  });

  it("SharedListPage_ShouldPassTheLiveItemsToUseReserveGift_WhenReady", () => {
    // Arrange — useReserveGift's own reply-timeout reconciliation (this file's own header)
    // depends on receiving the live server view, kept fresh over the page's own subscription.
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
            priority: 3,
          },
        ],
      },
    });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(useReserveGiftMock).toHaveBeenCalledWith(
      aShareToken(),
      expect.arrayContaining([
        expect.objectContaining({ itemId: "item-1", reserved: true }),
      ]),
    );
  });

  it("SharedListPage_ShouldPassNoLiveItemsToUseReserveGift_WhenNotYetReady", () => {
    // Arrange
    setState({ status: "loading" });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(useReserveGiftMock).toHaveBeenCalledWith(aShareToken(), []);
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
            priority: 3,
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

  it("SharedListPage_ShouldOfferNoWayToEditADescription_WhenItemsHaveDescriptions", () => {
    // Arrange — TC-T2-06: the guest view gets no edit control at all (GL-137, the owner-only
    // edit flow lives on ListDetailOwnerPage instead).
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
            url: null,
            reserved: false,
            priority: 3,
          },
        ],
      },
    });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(
      screen.queryByRole("button", { name: /description/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /description/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /description/i }),
    ).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldKeepLineBreaksAndWrapLongWordsInTheDescription_WhenItHasNewlines", () => {
    // Arrange — D4: the subtitle keeps line breaks and wraps long unbroken words instead of
    // collapsing whitespace or overflowing the card.
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
            description: "Line one\nLine two",
            url: null,
            reserved: false,
            priority: 3,
          },
        ],
      },
    });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    const description = screen.getByText(
      (_, element) => element?.textContent === "Line one\nLine two",
    );
    expect(description).toHaveStyle({
      whiteSpace: "pre-line",
      overflowWrap: "anywhere",
    });
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
            priority: 3,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("available") });
    const user = userEvent.setup();

    // Act
    renderSharedListPage();
    await user.click(screen.getByRole("button", { name: "Reserve this gift" }));

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
            priority: 3,
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
            priority: 3,
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
            priority: 3,
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
      message:
        "This gift list has expired and can no longer accept reservations.",
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
            priority: 3,
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

  it("SharedListPage_ShouldShowReservedByYouAndTheHonestNotice_WhenTheRpcRepliedWithReplyTimeout", () => {
    // Arrange — GL-41/GL-42: a reply-timeout stays optimistic ("reserved-by-you", no button) with
    // an honest notice alongside it, not rolled back and not rendered as an ordinary failure.
    const error: ReserveGiftErrorInfo = {
      kind: "reply-timeout",
      message:
        "This is taking longer than expected. If it went through, this gift is already " +
        "reserved. If it didn't, it stays unavailable until the list expires.",
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
            priority: 3,
          },
        ],
      },
    });
    setReserveGift({
      stateFor: stateForConstant("reserved-by-you"),
      errorFor: (itemId) => (itemId === "item-1" ? error : null),
    });

    // Act
    renderSharedListPage();

    // Assert
    const itemRow = screen.getByText("Headphones").closest("li");
    expect(itemRow).toHaveTextContent("You reserved this");
    expect(itemRow).toHaveTextContent(/unavailable until the list expires/i);
    expect(
      screen.queryByRole("button", { name: /reserve this gift/i }),
    ).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldRenderAnExpiredBannerInsteadOfTheCountdown_WhenTheListIsAlreadyExpired", () => {
    // Arrange — Ryan's decision, 2026-09-16: an expired list stays visible through the share
    // link, read-only. GL-42 is the ticket that renders the expired banner this test now pins —
    // "in 0 days" (the old, clamped-at-zero countdown) reads as "today" to a guest, not "over".
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
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.queryByText(/⏳/)).not.toBeInTheDocument();
  });

  it("SharedListPage_ShouldDisableTheReserveButton_WhenTheListIsAlreadyExpired", () => {
    // Arrange — GL-42's other half: the guest never gets as far as the RPC's own
    // `reservation.giftlist_expired` rejection, because the button is disabled first.
    setState({
      status: "ready",
      giftList: {
        listId: "list-1",
        name: "Ada's Birthday Wishlist",
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        items: [
          {
            itemId: "item-1",
            name: "Headphones",
            description: null,
            url: null,
            reserved: false,
            priority: 3,
          },
        ],
      },
    });
    setReserveGift({ stateFor: stateForConstant("available") });

    // Act
    renderSharedListPage();

    // Assert
    expect(
      screen.getByRole("button", { name: "Reserve this gift" }),
    ).toBeDisabled();
  });

  it("SharedListPage_ShouldShowALoadingMessage_WhenStatusIsLoading", () => {
    // Arrange — the same `ui/LoadingScreen` (and copy) `ShareTokenPage`'s own "checking" branch
    // renders, so the two read as one continuous wait (GL-42, folded from GL-39's own review).
    setState({ status: "loading" });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByText("Loading…")).toBeInTheDocument();
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

  it("SharedListPage_ShouldRenderNoDescriptionSubtitle_WhenTheItemHasNoDescription", () => {
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
            url: "https://example.com/h",
            reserved: false,
            priority: 3,
          },
        ],
      },
    });
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    const name = screen.getByText("Headphones");
    // The priority badge sits between the name and the link, so a missing description leaves
    // nothing else there.
    const badge = name.nextElementSibling;
    expect(badge).toHaveTextContent("Priority: Want");
    expect(badge?.nextElementSibling).toBe(
      screen.getByRole("link", { name: "https://example.com/h" }),
    );
  });

  it("SharedListPage_ShouldShowThePriorityLevelBadgeAndNoLegend_WhenTheItemHasAPriority", () => {
    // Arrange
    setState(readyState([anItem({ itemId: "i1", name: "Lamp", priority: 2 })]));
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    const row = screen.getByText("Lamp").closest("li") as HTMLElement;
    expect(
      elementsWithExactTextContent(row, "Priority: Would like").length,
    ).toBeGreaterThan(0);
    const outsideRows = document.body.cloneNode(true) as HTMLElement;
    outsideRows.querySelectorAll("li").forEach((li) => li.remove());
    expect(outsideRows).not.toHaveTextContent(/Priority/);
  });

  it("SharedListPage_ShouldShowThePushedPriorityLevelWithoutARefetch_WhenASubscriptionPushArrives", async () => {
    // Arrange — the real hook over mocked api modules: this test is about the live path.
    const actual = await vi.importActual<
      typeof import("../hooks/useSharedGiftList")
    >("../hooks/useSharedGiftList");
    useSharedGiftListMock.mockImplementation(actual.useSharedGiftList);
    setReserveGift();
    fetchSharedGiftListMock.mockResolvedValue(
      readyState([anItem({ itemId: "i1", name: "Lamp", priority: 2 })])
        .giftList,
    );
    let pushed: ((view: SharedGiftListView) => void) | null = null;
    subscribeMock.mockImplementation((_token, handlers) => {
      pushed = handlers.onData;
      return { close: vi.fn() };
    });
    renderSharedListPage();
    await screen.findByText("Lamp");

    // Act
    act(() => {
      pushed?.(
        readyState([anItem({ itemId: "i1", name: "Lamp", priority: 5 })])
          .giftList,
      );
    });

    // Assert
    const row = screen.getByText("Lamp").closest("li") as HTMLElement;
    expect(
      elementsWithExactTextContent(row, "Priority: Would love").length,
    ).toBeGreaterThan(0);
    expect(fetchSharedGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("SharedListPage_ShouldShowThePriorityBadgeAlongsideTheExpiredBanner_WhenTheListHasExpired", () => {
    // Arrange
    setState(
      readyState(
        [anItem({ itemId: "i1", name: "Lamp", priority: 4 })],
        new Date(Date.now() - 86_400_000).toISOString(),
      ),
    );
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
    const row = screen.getByText("Lamp").closest("li") as HTMLElement;
    expect(
      elementsWithExactTextContent(row, "Priority: Really want").length,
    ).toBeGreaterThan(0);
  });

  it("SharedListPage_ShouldOfferNoWayToChangePriority_WhenTheListIsLive", async () => {
    // Arrange
    setState(readyState([anItem({ itemId: "i1", name: "Lamp", priority: 3 })]));
    setReserveGift();
    renderSharedListPage();
    const row = screen.getByText("Lamp").closest("li") as HTMLElement;
    const badge = elementsWithExactTextContent(row, "Priority: Want")[0];

    // Act
    await userEvent.click(badge);

    // Assert
    for (const role of ["combobox", "listbox", "radio", "textbox"]) {
      expect(within(row).queryByRole(role)).not.toBeInTheDocument();
    }
    expect(reserveMock).not.toHaveBeenCalled();
    expect(
      elementsWithExactTextContent(row, "Priority: Want").length,
    ).toBeGreaterThan(0);
  });

  it("SharedListPage_ShouldMapEachStoredPriorityToItsLevelName_InRowOrder", () => {
    // Arrange
    setState(
      readyState(
        [1, 2, 3, 4, 5].map((priority, index) =>
          anItem({ itemId: `i${index}`, name: `Item ${"ABCDE"[index]}`, priority }),
        ),
      ),
    );
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    const rows = screen.getAllByRole("listitem");
    const expected = [
      "Priority: Nice to have",
      "Priority: Would like",
      "Priority: Want",
      "Priority: Really want",
      "Priority: Would love",
    ];
    expected.forEach((text, index) => {
      expect(rows[index]).toHaveTextContent(`Item ${"ABCDE"[index]}`);
      expect(
        elementsWithExactTextContent(rows[index], text).length,
      ).toBeGreaterThan(0);
    });
  });

  it("SharedListPage_ShouldKeepTheReceivedItemOrder_WhateverThePriorities", () => {
    // Arrange
    setState(
      readyState([
        anItem({ itemId: "a", name: "First", priority: 5 }),
        anItem({ itemId: "b", name: "Second", priority: 1 }),
        anItem({ itemId: "c", name: "Third", priority: 3 }),
      ]),
    );
    setReserveGift();

    // Act
    renderSharedListPage();

    // Assert
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("First");
    expect(rows[1]).toHaveTextContent("Second");
    expect(rows[2]).toHaveTextContent("Third");
  });
});
