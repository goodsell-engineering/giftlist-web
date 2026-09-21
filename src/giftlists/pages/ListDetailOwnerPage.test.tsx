import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ListDetailOwnerPage from "./ListDetailOwnerPage";
import { AuthContext, type AuthContextValue } from "../../identity/auth/authContext";
import { useGiftList, type GiftListState } from "../hooks/useGiftList";
import { createGiftListsClient } from "../api/giftListsClient";
import type { GiftListProjection } from "../api/giftListQueries";

// The real hook fetches over GraphQL and manages its own retry/confirmation logic — both already
// covered by hooks/useGiftList.test.ts in isolation. Mocking it here (rather than the network
// boundary underneath it) lets these tests drive every one of its states directly and cheaply,
// including "unresolved"/"not-found", without waiting on the hook's real retry timers.
vi.mock("../hooks/useGiftList", () => ({
  useGiftList: vi.fn(),
}));
vi.mock("../api/giftListsClient", () => ({
  createGiftListsClient: vi.fn(),
}));

const useGiftListMock = vi.mocked(useGiftList);
const createGiftListsClientMock = vi.mocked(createGiftListsClient);
const refetchMock = vi.fn();
const confirmChangeMock = vi.fn();
const confirmDeletedMock = vi.fn();

const renameGiftListMock = vi.fn();
const addGiftItemMock = vi.fn();
const removeGiftItemMock = vi.fn();
const deleteGiftListMock = vi.fn();

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
    shareToken: "kQ7v-2xR9mZpL3wYbT1s",
    createdAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

function setState(state: GiftListState) {
  useGiftListMock.mockReturnValue({
    state,
    isConfirming: false,
    refetch: refetchMock,
    confirmChange: confirmChangeMock,
    confirmDeleted: confirmDeletedMock,
  });
}

function renderListDetailPage() {
  const authValue: AuthContextValue = {
    session: SESSION,
    signUp: async () => {},
    logIn: async () => {},
    logOut: () => {},
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={["/lists/list-1"]}>
        <Routes>
          <Route path="/lists/:listId" element={<ListDetailOwnerPage />} />
          <Route path="/dashboard" element={<div>Dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ListDetailOwnerPage", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    confirmChangeMock.mockReset();
    confirmChangeMock.mockResolvedValue(true);
    confirmDeletedMock.mockReset();
    confirmDeletedMock.mockResolvedValue(true);
    renameGiftListMock.mockReset();
    addGiftItemMock.mockReset();
    removeGiftItemMock.mockReset();
    deleteGiftListMock.mockReset();
    createGiftListsClientMock.mockReset();
    createGiftListsClientMock.mockReturnValue({
      renameGiftList: renameGiftListMock,
      addGiftItem: addGiftItemMock,
      removeGiftItem: removeGiftItemMock,
      deleteGiftList: deleteGiftListMock,
    } as unknown as ReturnType<typeof createGiftListsClient>);
  });

  it("ListDetailOwnerPage_ShouldRenderTheListAndItsItems_WhenReady", () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        { itemId: "item-1", name: "Headphones", description: "Noise-cancelling", url: null },
      ],
    });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert
    expect(screen.getByText("Birthday Wishlist")).toBeInTheDocument();
    expect(screen.getByText("Headphones")).toBeInTheDocument();
    expect(screen.getByText("Noise-cancelling")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldNeverRenderAnyReservationStateOnAnItem_WhenReady", () => {
    // Arrange — ARCHITECTURE.md "Reservation privacy": the owner's List Detail view never shows reservation state.
    // GiftListProjection/GiftItemProjection carry no such field at all (see giftListQueries.ts),
    // so this also pins that no one adds a `reserved`/similar per-item badge later without this
    // test failing first. Scoped to each item row specifically — the page's own static privacy
    // notice text legitimately uses the word "reserved" to explain *why* this page hides it, so a
    // page-wide text search for that word would be a false positive on the very sentence that
    // documents the guarantee.
    const giftList = aGiftList({
      items: [
        { itemId: "item-1", name: "Headphones", description: null, url: null },
      ],
    });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert
    const itemRow = screen.getByText("Headphones").closest("li");
    expect(itemRow).not.toBeNull();
    expect(itemRow).not.toHaveTextContent(/reserved/i);
    expect(itemRow).not.toHaveTextContent(/available/i);
  });

  it("ListDetailOwnerPage_ShouldRenderTheShareLinkAsCopyOnly_NeverAsAClickableAnchor_WhenReady", () => {
    // Arrange — ARCHITECTURE.md "Reservation privacy": the share link is copy-only, never a clickable anchor.
    const giftList = aGiftList({ shareToken: "kQ7v-2xR9mZpL3wYbT1s" });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert — the link text is on the page, but not inside an <a>.
    expect(
      screen.getByText(`${window.location.origin}/share/kQ7v-2xR9mZpL3wYbT1s`),
    ).toBeInTheDocument();
    const shareLinks = screen
      .queryAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("/share/"));
    expect(shareLinks).toHaveLength(0);
  });

  it("ListDetailOwnerPage_ShouldCopyTheShareLinkToTheClipboard_WhenCopyLinkIsClicked", async () => {
    // Arrange
    const giftList = aGiftList({ shareToken: "kQ7v-2xR9mZpL3wYbT1s" });
    setState({ status: "ready", giftList });
    const user = userEvent.setup();
    renderListDetailPage();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    // Act
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    // Assert
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/share/kQ7v-2xR9mZpL3wYbT1s`,
      ),
    );
  });

  it("ListDetailOwnerPage_ShouldShowALoadingMessage_WhenStatusIsLoadingOrPending", () => {
    // Arrange
    setState({ status: "loading" });

    // Act
    renderListDetailPage();

    // Assert
    expect(screen.getByText("Loading your gift list…")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldShowAForbiddenMessage_WhenTheCallerDoesNotOwnTheList", () => {
    // Arrange
    setState({ status: "forbidden" });

    // Act
    renderListDetailPage();

    // Assert
    expect(screen.getByRole("alert")).toHaveTextContent(/do not own/i);
  });

  it("ListDetailOwnerPage_ShouldShowAPlainDoesNotExistMessage_WhenStatusIsNotFound", () => {
    // Arrange — batch-15 review item 3: an ordinary NOT_FOUND (bookmark, mistyped id, back button
    // onto a list just deleted) is confident, not ambiguous — no GL-72-shaped hedging belongs
    // here, unlike "unresolved" below.
    setState({ status: "not-found" });

    // Act
    renderListDetailPage();

    // Assert
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/doesn't exist/i);
    expect(alert).not.toHaveTextContent(/processing/i);
  });

  it("ListDetailOwnerPage_ShouldShowAnHonestAmbiguousMessage_WhenTheListStaysUnresolved", () => {
    // Arrange — the residual GL-72 leaves open: this state must not claim the list exists, and
    // must not claim it doesn't either. The ticket number itself must never reach this text
    // (batch-15 review item 2) — it means nothing to the person reading it.
    setState({ status: "unresolved" });

    // Act
    renderListDetailPage();

    // Assert
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/processing/i);
    expect(alert).not.toHaveTextContent(/^No gift list exists/);
    expect(alert).not.toHaveTextContent(/GL-72/);
  });

  it("ListDetailOwnerPage_ShouldRefetch_WhenCheckAgainIsClickedWhileUnresolved", async () => {
    // Arrange
    setState({ status: "unresolved" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Check again" }));

    // Assert — re-triggers the hook's own refetch, not a page-local guess.
    expect(refetchMock).toHaveBeenCalled();
  });

  it("ListDetailOwnerPage_ShouldRenameTheListAndConfirmTheChange_WhenTheRenameFormIsSubmitted", async () => {
    // Arrange
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    renameGiftListMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("List name");
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    await waitFor(() =>
      expect(renameGiftListMock).toHaveBeenCalledWith({
        listId: "list-1",
        name: "New Name",
      }),
    );
    // The write RPC resolving is not treated as proof the rename applied (batch-15 review item 1)
    // — confirmChange is what actually decides that, so its predicate is what matters here, not
    // just "was called". A predicate that ignored the new name (e.g. always true) would pass a
    // looser assertion but fail this one.
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(predicate(aGiftList({ name: "New Name" }))).toBe(true);
    expect(predicate(aGiftList({ name: "Birthday Wishlist" }))).toBe(false);
  });

  it("ListDetailOwnerPage_ShouldShowAWarning_WhenTheRenameCannotBeConfirmed", async () => {
    // Arrange — batch-15 review item 1: the change must never be presented as settled when it
    // could not be confirmed within the ladder.
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    renameGiftListMock.mockResolvedValue({});
    confirmChangeMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("List name");
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    expect(await screen.findByRole("status")).toHaveTextContent(
      /hasn't shown up yet/i,
    );
  });

  it("ListDetailOwnerPage_ShouldAddAnItemAndConfirmItAppears_WhenTheAddItemFormIsSubmitted", async () => {
    // Arrange
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
    await user.type(
      screen.getByLabelText("Link (optional)"),
      "https://example.com/machine",
    );
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    await waitFor(() =>
      expect(addGiftItemMock).toHaveBeenCalledWith({
        listId: "list-1",
        name: "Espresso Machine",
        url: "https://example.com/machine",
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [{ itemId: "new-item", name: "x", description: null, url: null }],
        }),
      ),
    ).toBe(true);
    expect(predicate(aGiftList({ items: [] }))).toBe(false);
  });

  it("ListDetailOwnerPage_ShouldShowAnInlineErrorAndNeverCallTheRpc_WhenTheLinkHasNoScheme", async () => {
    // Arrange — GL-78's whole point: "www.example.com"/"example.com" are the *normal* way an
    // owner gets this field wrong (no scheme), not an edge case. A fixture that only ever feeds
    // the form a valid URL cannot see this defect (the ticket's own trap warning) — this is the
    // scheme-less fixture, deliberately.
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
    await user.type(screen.getByLabelText("Link (optional)"), "www.example.com");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert — synchronous, in-field rejection; the grpc-web call (and everything after it,
    // including confirmChange) never happens, because GiftLists would silently discard this exact
    // value inside its fire-and-forget handler and the item would just never appear.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /http:\/\/ or https:\/\//i,
    );
    expect(addGiftItemMock).not.toHaveBeenCalled();
    expect(confirmChangeMock).not.toHaveBeenCalled();
  });

  it("ListDetailOwnerPage_ShouldAllowSubmission_WhenTheLinkFieldIsLeftBlank", async () => {
    // Arrange — the field is optional (CONVENTIONS.md-aligned: "must be http/https" is not a rule
    // about the absence of a value); this must not be conflated with the scheme-less case above.
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    await waitFor(() =>
      expect(addGiftItemMock).toHaveBeenCalledWith({
        listId: "list-1",
        name: "Espresso Machine",
        url: undefined,
      }),
    );
  });

  // GL-78, rounds 2-4: a fixture that only feeds the form shapes chosen from what we already
  // expected (a valid URL, or the one scheme-less shape the ticket originally named) cannot see a
  // divergence from the real domain check — the same lesson as GL-63's whole-second timestamp and
  // GL-24's January date. Each of these eleven was confirmed, by running the exact
  // `GiftItemUrl.IsAbsoluteHttpUrl` check against a real .NET `Uri.TryCreate`, to have once been
  // (rounds 1-3, before that round's fix) or still be, absent the fix, something that would be
  // accepted here while the domain rejects it — i.e. each one would reach AddGiftItem, get a
  // 200/itemId back, and then the item would silently never appear. The last two (round 4) are
  // the port group's own gap: `[0-9]{1,5}` is a digit-count bound, not a value bound, so it
  // matched "65536"/"99999" before `GIFT_ITEM_URL_MAX_PORT` was added — the one place this
  // guard's grammar was actually looser than `Uri`, not just narrower.
  it.each([
    ["http:example.com", "missing the double slash after the scheme"],
    ["http://.", "a hostname that is just a dot"],
    ["http:///evil.example", "extra slashes WHATWG skips past to find a host"],
    ["http://evil.com\\@good.com", "backslash before @ in the authority"],
    ["http://good.com\\@evil.com", "backslash before @, other side"],
    ["http://evil.com\\.good.com", "backslash instead of a dot in the host"],
    ["http://a\\b", "bare backslash after the host"],
    ["http://exam%70le.com", "percent-encoded host character"],
    ["http://foo@bar@example.com", "doubled @ in the authority"],
    ["http://example.com:65536", "port one above the maximum valid TCP port"],
    ["http://example.com:99999", "port with five digits but out of range"],
  ])(
    "ListDetailOwnerPage_ShouldRejectTheLink_WhenItIsOneOfTheConfirmedNetUriDivergences (%s: %s)",
    async (value) => {
      // Arrange
      const giftList = aGiftList();
      setState({ status: "ready", giftList });
      const user = userEvent.setup();
      renderListDetailPage();

      // Act
      await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
      // user.paste, not user.type: several fixtures here contain "{", "[", or other characters
      // user-event's keyboard parser would otherwise try to read as special-key syntax — paste
      // sidesteps that entirely, and is also how a real owner would get most of these into the
      // field anyway (pasting a copied link, not typing brackets by hand).
      await user.click(screen.getByLabelText("Link (optional)"));
      await user.paste(value);
      await user.click(screen.getByRole("button", { name: "Add item" }));

      // Assert — rejected client-side, never reaches the grpc-web call.
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /http:\/\/ or https:\/\//i,
      );
      expect(addGiftItemMock).not.toHaveBeenCalled();
    },
  );

  // GL-78 review round 3: the guard is a *conservative* allowlist, not an attempted exact mirror
  // of the domain — see isAcceptableGiftItemUrl's own comment. These three are all accepted by
  // GiftItemUrl (confirmed against a real .NET Uri.TryCreate) but are deliberately, intentionally
  // rejected here anyway, because they land in the safe direction (a recoverable in-field message,
  // never a silent server-side rejection of something the SPA waved through).
  it.each([
    ["http://例え.jp", "a raw (non-punycode) non-ASCII hostname"],
    ["https://[::1]/", "an IPv6 literal"],
    ["http://example.com.", "a trailing-dot FQDN"],
  ])(
    "ListDetailOwnerPage_ShouldRejectTheLink_WhenItIsADeliberatelyDroppedButDomainValidShape (%s: %s)",
    async (value) => {
      // Arrange
      const giftList = aGiftList();
      setState({ status: "ready", giftList });
      const user = userEvent.setup();
      renderListDetailPage();

      // Act
      await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
      await user.click(screen.getByLabelText("Link (optional)"));
      await user.paste(value);
      await user.click(screen.getByRole("button", { name: "Add item" }));

      // Assert
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /http:\/\/ or https:\/\//i,
      );
      expect(addGiftItemMock).not.toHaveBeenCalled();
    },
  );

  // The other half of the same conservative-allowlist criterion: ordinary product-page-shaped
  // links must keep working — a validator narrow enough to close every divergence above but that
  // also rejects real links would just move the silent-vanish defect to "reject something normal
  // users actually type", which is not an improvement.
  it.each([
    "https://www.amazon.co.uk/dp/B01234",
    "https://example.com",
    "http://example.com",
    "https://example.com/path?q=1&x=2#frag",
    "https://sub.example.co.uk/a/b/c",
    "http://localhost:3000/",
    "https://www.etsy.com/listing/123456789/some-item-name",
    "http://xn--nxasmq6b.com",
    "https://192.168.1.1/",
  ])(
    "ListDetailOwnerPage_ShouldAcceptTheLink_WhenItIsAnOrdinaryProductUrl (%s)",
    async (value) => {
      // Arrange
      const giftList = aGiftList();
      setState({ status: "ready", giftList });
      addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
      const user = userEvent.setup();
      renderListDetailPage();

      // Act
      await user.type(screen.getByLabelText("Item name"), "Espresso Machine");
      await user.click(screen.getByLabelText("Link (optional)"));
      await user.paste(value);
      await user.click(screen.getByRole("button", { name: "Add item" }));

      // Assert
      await waitFor(() =>
        expect(addGiftItemMock).toHaveBeenCalledWith({
          listId: "list-1",
          name: "Espresso Machine",
          url: value,
        }),
      );
    },
  );

  it("ListDetailOwnerPage_ShouldRemoveAnItemAndConfirmItDisappears_WhenRemoveIsClicked", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [{ itemId: "item-1", name: "Headphones", description: null, url: null }],
    });
    setState({ status: "ready", giftList });
    removeGiftItemMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Remove" }));

    // Assert
    await waitFor(() =>
      expect(removeGiftItemMock).toHaveBeenCalledWith({
        listId: "list-1",
        itemId: "item-1",
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [{ itemId: "item-1", name: "Headphones", description: null, url: null }],
        }),
      ),
    ).toBe(false);
    expect(predicate(aGiftList({ items: [] }))).toBe(true);
  });

  it("ListDetailOwnerPage_ShouldDeleteTheListAndNavigateToDashboard_WhenDeletionIsConfirmed", async () => {
    // Arrange — batch-15 review item 1: the page must not navigate away the instant the write RPC
    // returns; it waits for confirmDeleted() so the dashboard can never show a just-deleted list.
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    deleteGiftListMock.mockResolvedValue({});
    confirmDeletedMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    // Assert
    await waitFor(() =>
      expect(deleteGiftListMock).toHaveBeenCalledWith({ listId: "list-1" }),
    );
    await waitFor(() => expect(confirmDeletedMock).toHaveBeenCalled());
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldStayAndShowAnInlineMessage_WhenDeletionCannotBeConfirmed", async () => {
    // Arrange — the honest-failure path: deletion accepted by the Gateway, but not yet (or never)
    // reflected. Must not navigate away and silently leave the dashboard showing a stale entry.
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    deleteGiftListMock.mockResolvedValue({});
    confirmDeletedMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /hasn't been confirmed/i,
    );
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldShowAnInlineErrorAndNotNavigate_WhenDeleteRpcFails", async () => {
    // Arrange
    const giftList = aGiftList();
    setState({ status: "ready", giftList });
    deleteGiftListMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    // Assert
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(confirmDeletedMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });
});
