import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import DashboardPage from "./DashboardPage";
import {
  AuthContext,
  type AuthContextValue,
} from "../../identity/auth/authContext";
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

function aGiftList(
  overrides: Partial<GiftListProjection> = {},
): GiftListProjection {
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
          <Route path="/lists/:listId" element={<ListDetailPageStub />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/**
 * The accessible name `@mantine/dates` gives a calendar day button — "20 September 2026", not
 * just "20" (its visible text): `Day`'s `aria-label` spells out the full date so a screen reader
 * doesn't have to guess which month a bare number belongs to. Anchored at the start with a
 * trailing space so day 2 ("2 September 2026") can't accidentally match day 20's button
 * ("20 September 2026") or vice versa.
 */
function dayButtonName(dayOfMonth: number): RegExp {
  return new RegExp(`^${dayOfMonth} `);
}

/**
 * Opens the "Expires" `DatePickerInput`'s popover and clicks the calendar day button for
 * `dayOfMonth` — the GL-122 replacement for typing straight into a native `<input type="date">`.
 * Only valid for a day that's actually rendered in the currently displayed month (the picker
 * opens on the browser's local "today" by default, per `@mantine/dates`), which every call site
 * below arranges for by pinning fake time to an instant in the same month as the day it picks.
 */
async function selectExpiryDay(user: UserEvent, dayOfMonth: number) {
  await user.click(screen.getByLabelText("Expires"));
  await user.click(
    await screen.findByRole("button", { name: dayButtonName(dayOfMonth) }),
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
        items: [
          { itemId: "item-1", name: "Mug", description: null, url: null },
        ],
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

  // `DatePickerInput` (GL-122) opens its calendar on the browser's local "today" and only renders
  // that one month's days as clickable buttons — unlike the native `<input type="date">` this
  // replaced, a test can't just type an arbitrary far-future string into it. Every test here pins
  // fake time to a fixed instant so "today" (and therefore which day-of-month buttons exist) is
  // known, and picks a day within days of that instant rather than years out — the exact date no
  // longer matters to these three tests, only that a picked, valid day reaches the RPC intact.
  describe("creating a list, via the date picker", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-06-01T04:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("DashboardPage_ShouldCreateAListAndNavigateToItsDetailPage_WhenTheFormIsSubmitted", async () => {
      // Arrange
      fetchMyGiftListsMock.mockResolvedValue([]);
      createGiftListMock.mockResolvedValue({ listId: "new-list-id" });
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 20);
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert — the exact fields, not just "was called", is what would catch a swapped/garbled
      // expiry date reaching the wire.
      await waitFor(() =>
        expect(createGiftListMock).toHaveBeenCalledWith({
          name: "Baby Shower",
          // UTC midnight of the chosen day, not local midnight (batch-15 review item 4) — the "Z"
          // here is load-bearing: dropping it would make this assertion pass or fail depending on
          // the machine's own timezone rather than pinning the actual serialized value.
          expiresAt: timestampFromDate(new Date("2030-06-20T00:00:00Z")),
        }),
      );
      expect(await screen.findByText(/List detail page/)).toBeInTheDocument();
    });

    it("DashboardPage_ShouldNavigateWithJustCreatedRouterState_WhenTheFormIsSubmitted", async () => {
      // Arrange — batch-15 review item 3: the destination page only engages its NOT_FOUND retry
      // ladder when it knows it arrived via this exact flow; this is how it knows.
      fetchMyGiftListsMock.mockResolvedValue([]);
      createGiftListMock.mockResolvedValue({ listId: "new-list-id" });
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 10);
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      expect(await screen.findByText(/justCreated: true/)).toBeInTheDocument();
    });

    it("DashboardPage_ShouldShowAnInlineError_AndShouldNotNavigate_WhenCreateGiftListFails", async () => {
      // Arrange
      fetchMyGiftListsMock.mockResolvedValue([]);
      createGiftListMock.mockRejectedValue(
        new ConnectError("An expiry date is required.", Code.InvalidArgument, {
          "giftlist-error-code": "gateway.missing_expiry",
        }),
      );
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 5);
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose an expiry date for this list.",
      );
      expect(screen.queryByText("List detail page")).not.toBeInTheDocument();
    });
  });

  describe("expiry date boundary (GL-82)", () => {
    // Only `Date` is faked, not `setTimeout` — leaving the timer-driven parts of
    // Testing Library (`waitFor`/`findBy*`) on real timers, so they don't need manual advancing,
    // while `new Date()`/`Date.now()` inside the page return the pinned instant below.
    //
    // The pinned instant itself is chosen so UTC "today" and the suite's own Asia/Kolkata local
    // "today" (vite.config.ts's TZ pin, UTC+5:30) *disagree*: 2030-03-14T20:00:00Z is 01:30 IST
    // on 2030-03-15, so local "today" is already the 15th while UTC "today" is still the 14th.
    // The assertions below are the ones a local/UTC mixup can actually falsify — picking an
    // instant where the two calendar days happened to coincide would make them pass whether the
    // fix used UTC or local, which is no test at all.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-03-14T20:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("DashboardPage_ShouldBoundTheExpiryPickersMinDateToUtcTomorrow_NotTheBrowsersLocalCalendarDay", async () => {
      // Arrange
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.click(screen.getByLabelText("Expires"));

      // Assert — UTC today (the 14th) must stay disabled (`minDate` is inclusive, so today would
      // otherwise advertise a guaranteed-failing choice as legal — see isExpiryDateNotInFuture's
      // doc comment), and UTC tomorrow (the 15th) must be selectable. The local Asia/Kolkata
      // calendar day disagrees with both of those: local "today" is already the 15th, so a
      // `minDate` computed from the browser's local "tomorrow" would be the 16th instead — which
      // is exactly the bug this asserts against by checking the 15th is *not* disabled.
      expect(
        await screen.findByRole("button", { name: dayButtonName(14) }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: dayButtonName(15) }),
      ).not.toBeDisabled();
    });

    it("DashboardPage_ShouldSubmitTheExactUtcCalendarDayPicked_WhenTheHostTimeZoneRunsAheadOfUtc", async () => {
      // Arrange — the regression test for `parseExpiryDate`/`DatePickerInput` together: a picked
      // day must survive the Asia/Kolkata offset (this describe block's pinned instant, see
      // above) and reach the RPC as the exact UTC calendar day chosen, not shifted by the host's
      // positive offset from UTC.
      fetchMyGiftListsMock.mockResolvedValue([]);
      createGiftListMock.mockResolvedValue({ listId: "new-list-id" });
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 15);
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      await waitFor(() =>
        expect(createGiftListMock).toHaveBeenCalledWith({
          name: "Baby Shower",
          expiresAt: timestampFromDate(new Date("2030-03-15T00:00:00Z")),
        }),
      );
    });

    it("DashboardPage_ShouldShowThePickedDayInTheLocalizedShortFormat_WhenADayIsPicked", async () => {
      // Arrange — `valueFormat="L"` is dayjs's localizedFormat token; without that plugin
      // registered the field renders the literal letter "L" after a pick (Batch 43 review, B1).
      // The RPC payload was right all along, which is why the Kolkata test above never saw it.
      // jsdom's navigator.language is en-US, so `DatesProvider` resolves the "en" dayjs locale.
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");

      // Act
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await selectExpiryDay(user, 15);

      // Assert
      expect(screen.getByLabelText("Expires")).toHaveTextContent("03/15/2030");
    });

    it("DashboardPage_ShouldRejectYesterdaysUtcDate_AndNotCallTheRpc_WhenSubmitted", async () => {
      // Arrange — the ordinary path GL-72's ticket found: a user picking a day that has already
      // gone by. With `minDate` now steering the picker away from past days at selection time
      // (GL-122), the reachable version of this bug is a day that was valid *when picked* and has
      // since gone by — a form left open, or (as here) time simply passing between picking and
      // submitting — which used to sail past this page entirely and fail invisibly, deep inside
      // GiftLists, leaving the destination page stuck "unresolved" forever.
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 16);

      // Act — three days pass: the 16th, valid when picked (minDate was the 15th), is now
      // yesterday relative to "now".
      vi.setSystemTime(new Date("2030-03-17T20:00:00Z"));
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
      // request arrives). Reached here the same way as the "yesterday" case above: the 15th was
      // valid (it *was* `minDate`) at the moment it was picked, and stops being valid the instant
      // it becomes "today" instead of "tomorrow".
      fetchMyGiftListsMock.mockResolvedValue([]);
      const user = userEvent.setup({ delay: null });
      renderDashboardPage();
      await screen.findByText("You don't have any gift lists yet.");
      await user.click(screen.getByRole("button", { name: "+ New list" }));
      await user.type(screen.getByLabelText("List name"), "Baby Shower");
      await selectExpiryDay(user, 15);

      // Act — one day passes: the 15th, valid when picked, is now "today".
      vi.setSystemTime(new Date("2030-03-15T20:00:00Z"));
      await user.click(screen.getByRole("button", { name: "Create list" }));

      // Assert
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose an expiry date in the future",
      );
      expect(createGiftListMock).not.toHaveBeenCalled();
    });
  });
});
