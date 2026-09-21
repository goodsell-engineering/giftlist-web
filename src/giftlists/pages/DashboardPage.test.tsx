import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import DashboardPage from "./DashboardPage";
import { AuthContext, type AuthContextValue } from "../../identity/auth/authContext";
import { fetchMyGiftLists } from "../api/giftListQueries";
import { createGiftListsClient } from "../api/giftListsClient";
import type { GiftListProjection } from "../api/giftListQueries";

// The real query/client would hit the network — replaced so these tests exercise the page's own
// wiring (loading/ready/error rendering, exact command fields, the create-then-navigate flow)
// without a server. Mirrors identity/pages/*.test.tsx's own precedent for mocking the transport
// boundary, not the page's logic.
vi.mock("../api/giftListQueries", () => ({
  fetchMyGiftLists: vi.fn(),
}));
vi.mock("../api/giftListsClient", () => ({
  createGiftListsClient: vi.fn(),
}));

const fetchMyGiftListsMock = vi.mocked(fetchMyGiftLists);
const createGiftListsClientMock = vi.mocked(createGiftListsClient);
const createGiftListMock = vi.fn();

const SESSION: AuthContextValue["session"] = {
  userId: "owner-1",
  accessToken: "token-abc",
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

function aGiftList(overrides: Partial<GiftListProjection> = {}): GiftListProjection {
  return {
    listId: "list-1",
    ownerId: "owner-1",
    name: "Birthday Wishlist",
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    shareToken: "share-token-1",
    createdAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

/**
 * Stands in for ListDetailOwnerPage so the create-flow test can assert what router state
 * DashboardPage actually navigated with, without depending on that page's own rendering.
 */
function ListDetailPageStub() {
  const location = useLocation();
  const justCreated = Boolean(
    (location.state as { justCreated?: boolean } | null)?.justCreated,
  );
  return <div>{`List detail page — justCreated: ${justCreated}`}</div>;
}

function renderDashboardPage() {
  const authValue: AuthContextValue = {
    session: SESSION,
    signUp: async () => {},
    logIn: async () => {},
    logOut: () => {},
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/lists/:listId"
            element={<ListDetailPageStub />}
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    fetchMyGiftListsMock.mockReset();
    createGiftListMock.mockReset();
    createGiftListsClientMock.mockReset();
    createGiftListsClientMock.mockReturnValue({
      createGiftList: createGiftListMock,
    } as unknown as ReturnType<typeof createGiftListsClient>);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
    });
  });

  it("DashboardPage_ShouldRenderEachList_WhenMyGiftListsSucceeds", async () => {
    // Arrange
    const giftLists = [
      aGiftList({ listId: "list-1", name: "Birthday Wishlist" }),
      aGiftList({
        listId: "list-2",
        name: "Housewarming",
        items: [{ itemId: "item-1", name: "Mug", description: null, url: null }],
      }),
    ];
    fetchMyGiftListsMock.mockResolvedValue(giftLists);

    // Act
    renderDashboardPage();

    // Assert
    expect(await screen.findByText("Birthday Wishlist")).toBeInTheDocument();
    expect(screen.getByText("Housewarming")).toBeInTheDocument();
    expect(screen.getByText(/1 item/)).toBeInTheDocument();
    expect(fetchMyGiftListsMock).toHaveBeenCalledWith("token-abc");
  });

  it("DashboardPage_ShouldShowAnEmptyStateMessage_WhenThereAreNoGiftLists", async () => {
    // Arrange
    fetchMyGiftListsMock.mockResolvedValue([]);

    // Act
    renderDashboardPage();

    // Assert
    expect(
      await screen.findByText("You don't have any gift lists yet."),
    ).toBeInTheDocument();
  });

  it("DashboardPage_ShouldCreateAListAndNavigateToItsDetailPage_WhenTheFormIsSubmitted", async () => {
    // Arrange
    fetchMyGiftListsMock.mockResolvedValue([]);
    createGiftListMock.mockResolvedValue({ listId: "new-list-id" });
    const user = userEvent.setup();
    renderDashboardPage();
    await screen.findByText("You don't have any gift lists yet.");

    // Act
    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("List name"), "Baby Shower");
    // Any date works here now that vite.config.ts pins the whole suite's TZ to Asia/Kolkata
    // (UTC+5:30, no DST) — a bug that parses this value at *local* midnight instead of UTC
    // midnight is then detectable year-round. It previously was not: an earlier version of this
    // test relied on the ambient (unpinned) timezone and a specific month to expose the same bug,
    // which made it pass or fail depending on the machine and the calendar (batch-15 review item
    // 4, found the hard way — see vite.config.ts's own comment on the pin).
    await user.type(screen.getByLabelText("Expires"), "2030-07-15");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    // Assert — the exact fields, not just "was called", is what would catch a swapped/garbled
    // expiry date reaching the wire.
    await waitFor(() =>
      expect(createGiftListMock).toHaveBeenCalledWith({
        name: "Baby Shower",
        // UTC midnight of the chosen day, not local midnight (batch-15 review item 4) — the "Z"
        // here is load-bearing: dropping it would make this assertion pass or fail depending on
        // the machine's own timezone rather than pinning the actual serialized value.
        expiresAt: timestampFromDate(new Date("2030-07-15T00:00:00Z")),
      }),
    );
    expect(await screen.findByText(/List detail page/)).toBeInTheDocument();
  });

  it("DashboardPage_ShouldNavigateWithJustCreatedRouterState_WhenTheFormIsSubmitted", async () => {
    // Arrange — batch-15 review item 3: the destination page only engages its NOT_FOUND retry
    // ladder when it knows it arrived via this exact flow; this is how it knows.
    fetchMyGiftListsMock.mockResolvedValue([]);
    createGiftListMock.mockResolvedValue({ listId: "new-list-id" });
    const user = userEvent.setup();
    renderDashboardPage();
    await screen.findByText("You don't have any gift lists yet.");

    // Act
    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("List name"), "Baby Shower");
    await user.type(screen.getByLabelText("Expires"), "2030-01-01");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    // Assert
    expect(await screen.findByText(/justCreated: true/)).toBeInTheDocument();
  });

  it("DashboardPage_ShouldShowTheMissingExpiryMessageAndNotCallTheRpc_WhenExpiryIsLeftEmpty", async () => {
    // Arrange — batch-15 review item 4: the form is `noValidate`, so an empty expiry used to
    // reach `timestampFromDate` as an Invalid Date, which throws — surfacing as a generic
    // "Something went wrong" instead of this specific, pre-existing message.
    fetchMyGiftListsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderDashboardPage();
    await screen.findByText("You don't have any gift lists yet.");

    // Act
    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("List name"), "Baby Shower");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an expiry date for this list.",
    );
    expect(createGiftListMock).not.toHaveBeenCalled();
  });

  it("DashboardPage_ShouldShowAnInlineError_AndShouldNotNavigate_WhenCreateGiftListFails", async () => {
    // Arrange
    fetchMyGiftListsMock.mockResolvedValue([]);
    createGiftListMock.mockRejectedValue(
      new ConnectError("An expiry date is required.", Code.InvalidArgument, {
        "giftlist-error-code": "gateway.missing_expiry",
      }),
    );
    const user = userEvent.setup();
    renderDashboardPage();
    await screen.findByText("You don't have any gift lists yet.");

    // Act
    await user.click(screen.getByRole("button", { name: "+ New list" }));
    await user.type(screen.getByLabelText("List name"), "Baby Shower");
    await user.type(screen.getByLabelText("Expires"), "2030-01-01");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an expiry date for this list.",
    );
    expect(screen.queryByText("List detail page")).not.toBeInTheDocument();
  });

  it("DashboardPage_ShouldCopyTheShareLinkToTheClipboard_NeverRenderingItAsALink_WhenShareIsClicked", async () => {
    // Arrange — ARCHITECTURE.md "Reservation privacy": the share link is copy-only, never a clickable anchor.
    const giftLists = [aGiftList({ shareToken: "kQ7v-2xR9mZpL3wYbT1s" })];
    fetchMyGiftListsMock.mockResolvedValue(giftLists);
    // userEvent.setup() installs its own clipboard stub, overwriting whatever
    // navigator.clipboard held before it ran — so this override has to come *after* setup(), not
    // before it (found the hard way: defining it earlier silently gets clobbered).
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderDashboardPage();
    await screen.findByText("Birthday Wishlist");

    // Act
    await user.click(screen.getByRole("button", { name: "Share" }));

    // Assert — jsdom's default test origin, per its own defaults (not localhost:5173, the real
    // dev server's port) — window.location.origin, not a hardcoded guess.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/share/kQ7v-2xR9mZpL3wYbT1s`,
      ),
    );
    const shareLinks = screen
      .queryAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("/share/"));
    expect(shareLinks).toHaveLength(0);
  });

  describe("expiry date boundary (GL-82)", () => {
    // Only `Date` is faked, not `setTimeout` — leaving the timer-driven parts of
    // Testing Library (`waitFor`/`findBy*`) on real timers, so they don't need manual advancing,
    // while `new Date()`/`Date.now()` inside the page return the pinned instant below.
    //
    // The pinned instant itself is chosen so UTC "today" and the suite's own Asia/Kolkata local
    // "today" (vite.config.ts's TZ pin, UTC+5:30) *disagree*: 2030-03-14T20:00:00Z is 01:30 IST
    // on 2030-03-15, so local "today" is already the 15th while UTC "today" is still the 14th.
    // The `min` assertion below is the one that a local/UTC mixup can actually falsify — picking
    // an instant where the two calendar days happened to coincide would make it pass whether the
    // fix used UTC or local, which is no test at all.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-03-14T20:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("DashboardPage_ShouldBoundTheExpiryInputsMinToUtcTomorrow_NotTheBrowsersLocalCalendarDay", async () => {
      // Arrange
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));

      // Assert — `min` is UTC *tomorrow* (the 15th), not UTC today (review: `min` is inclusive,
      // so today would advertise a guaranteed-failing choice as legal) and not the local
      // Asia/Kolkata day: local "tomorrow" is the 16th, so "2030-03-16" here would mean the local
      // day leaked into `min`.
      expect(screen.getByLabelText("Expires")).toHaveAttribute(
        "min",
        "2030-03-15",
      );
    });

    it("DashboardPage_ShouldRejectYesterdaysUtcDate_AndNotCallTheRpc_WhenSubmitted", async () => {
      // Arrange — the ordinary path GL-72's ticket found: a user picking a day that has already
      // gone by, which used to sail past this page entirely and fail invisibly, deep inside
      // GiftLists, leaving the destination page stuck "unresolved" forever.
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await user.type(screen.getByLabelText("Expires"), "2030-03-13");
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose an expiry date in the future",
      );
      expect(createGiftListMock).not.toHaveBeenCalled();
    });

    it("DashboardPage_ShouldRejectTodaysUtcDate_AndNotCallTheRpc_WhenSubmitted", async () => {
      // Arrange — review finding: picking today is not a foreseeable-only-by-the-server edge
      // case, it is a guaranteed failure for every user (parseExpiryDate turns it into
      // `T00:00:00Z`, and GiftLists' `ExpiryDate.IsInFuture` requires strictly *after* the
      // instant the server processes it, which UTC midnight of today never is by the time any
      // request arrives). This used to sail through as the one remaining path into the same
      // "unresolved" dead end this ticket exists to close.
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await user.type(screen.getByLabelText("Expires"), "2030-03-14");
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose an expiry date in the future",
      );
      expect(createGiftListMock).not.toHaveBeenCalled();
    });
  });
});
