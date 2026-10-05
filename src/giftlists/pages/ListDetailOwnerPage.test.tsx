import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test/render";
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
const changeGiftItemDescriptionMock = vi.fn();
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
    changeGiftItemDescriptionMock.mockReset();
    deleteGiftListMock.mockReset();
    createGiftListsClientMock.mockReset();
    createGiftListsClientMock.mockReturnValue({
      renameGiftList: renameGiftListMock,
      addGiftItem: addGiftItemMock,
      removeGiftItem: removeGiftItemMock,
      changeGiftItemDescription: changeGiftItemDescriptionMock,
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

  it("ListDetailOwnerPage_ShouldSendTheTrimmedDescriptionAndConfirmIt_WhenAnEditIsSaved", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    const textbox = screen.getByLabelText("Description");
    await user.clear(textbox);
    await user.type(textbox, "  New description  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    await waitFor(() =>
      expect(changeGiftItemDescriptionMock).toHaveBeenCalledWith({
        listId: "list-1",
        itemId: "item-1",
        description: "New description",
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [
            {
              itemId: "item-1",
              name: "Headphones",
              description: "New description",
              url: null,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      predicate(
        aGiftList({
          items: [
            {
              itemId: "item-1",
              name: "Headphones",
              description: "Old description",
              url: null,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("ListDetailOwnerPage_ShouldSendNoDescriptionAndConfirmNull_WhenTheFieldIsEmptiedAndSaved", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act — whitespace-only counts as emptied, same as the trimmed-blank rule on AddGiftItem.
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    const textbox = screen.getByLabelText("Description");
    await user.clear(textbox);
    await user.type(textbox, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    await waitFor(() =>
      expect(changeGiftItemDescriptionMock).toHaveBeenCalledWith({
        listId: "list-1",
        itemId: "item-1",
        description: undefined,
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [
            {
              itemId: "item-1",
              name: "Headphones",
              description: null,
              url: null,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("ListDetailOwnerPage_ShouldSendAndConfirmTheServerTrimmedDescription_WhenItEndsInANextLineCharacter", async () => {
    // Arrange — U+0085 (NEL) is whitespace to .NET's string.Trim() but not to JS's String.trim(),
    // so the web must normalise the same way GiftLists does rather than trusting JS trim().
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    const textbox = screen.getByLabelText("Description");
    fireEvent.change(textbox, { target: { value: "New\u0085" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    await waitFor(() =>
      expect(changeGiftItemDescriptionMock).toHaveBeenCalledWith({
        listId: "list-1",
        itemId: "item-1",
        description: "New",
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [
            {
              itemId: "item-1",
              name: "Headphones",
              description: "New",
              url: null,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("ListDetailOwnerPage_ShouldSendNoDescriptionAndConfirmNull_WhenTheFieldHoldsOnlyANextLineCharacter", async () => {
    // Arrange — same U+0085 gap as above, but for the fully-emptied case: GiftLists treats a
    // description of just U+0085 as IsNullOrWhiteSpace and stores null, so the web must send no
    // description and wait for null, not for "\u0085" to still be present.
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    const textbox = screen.getByLabelText("Description");
    fireEvent.change(textbox, { target: { value: "\u0085" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    await waitFor(() =>
      expect(changeGiftItemDescriptionMock).toHaveBeenCalledWith({
        listId: "list-1",
        itemId: "item-1",
        description: undefined,
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [
            {
              itemId: "item-1",
              name: "Headphones",
              description: null,
              url: null,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("ListDetailOwnerPage_ShouldPrefillTheCurrentDescription_WhenEditDescriptionIsOpened", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Noise-cancelling",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );

    // Assert
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Noise-cancelling",
    );
  });

  it("ListDetailOwnerPage_ShouldOfferAddDescription_WhenTheItemHasNone", () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        { itemId: "item-1", name: "Headphones", description: null, url: null },
      ],
    });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert
    expect(
      screen.getByRole("button", { name: "Add description" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit description" }),
    ).not.toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldCapTheDescriptionAt2000AndShowTheCounter_When2001CharactersArePasted", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        { itemId: "item-1", name: "Headphones", description: null, url: null },
      ],
    });
    setState({ status: "ready", giftList });
    const user = userEvent.setup();
    renderListDetailPage();
    await user.click(screen.getByRole("button", { name: "Add description" }));
    const textbox = screen.getByLabelText("Description");
    const tooLong = "a".repeat(2001);

    // Act
    await user.click(textbox);
    await user.paste(tooLong);

    // Assert
    expect(textbox).toHaveValue("a".repeat(2000));
    expect(screen.getByText("2000 / 2000")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldRenderNoEditDescriptionControl_WhenTheListHasExpired", () => {
    // Arrange
    const giftList = aGiftList({
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Noise-cancelling",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert
    expect(
      screen.queryByRole("button", { name: "Edit description" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add description" }),
    ).not.toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldShowTheNotConfirmedNoticeAndReenableSave_WhenTheDescriptionChangeCannotBeConfirmed", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    confirmChangeMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert — reuses the shared notice (D3), not a page-local string.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /hasn't shown up yet/i,
    );
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("ListDetailOwnerPage_ShouldShowAnInlineError_WhenTheChangeDescriptionRpcFails", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(confirmChangeMock).not.toHaveBeenCalled();
  });

  it("ListDetailOwnerPage_ShouldCloseWithoutCallingTheRpc_WhenCancelIsClicked", async () => {
    // Arrange
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Assert
    expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
    expect(changeGiftItemDescriptionMock).not.toHaveBeenCalled();
  });

  it("ListDetailOwnerPage_ShouldDisableEveryEditDescriptionButton_WhileASaveIsStillConfirming", async () => {
    // Arrange — S1 review fix: editingItemId/descriptionValue are shared page state, one save at
    // a time. If another row's button stayed enabled while item 1's save was still waiting on
    // confirmChange, clicking it would call startEditDescription and stomp that state — closing
    // item 1's form (or resetting its text) out from under the in-flight save. Every row's
    // button must be disabled for the whole confirmChange wait, not just the RPC.
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Old description",
          url: null,
        },
        {
          itemId: "item-2",
          name: "Mug",
          description: null,
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });
    changeGiftItemDescriptionMock.mockResolvedValue({});
    let resolveConfirm: (value: boolean) => void = () => {};
    confirmChangeMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const user = userEvent.setup();
    renderListDetailPage();

    // Act — start saving item 1's description; confirmChange is still pending.
    await user.click(
      screen.getByRole("button", { name: "Edit description" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Assert — both this row's button (now "Edit description" behind the open form) and item
    // 2's ("Add description", never opened) are disabled while the save is still confirming.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add description" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getAllByRole("button", { name: "Edit description" })[0],
    ).toBeDisabled();

    // Cleanup — let the pending confirmChange settle so it doesn't leak into later tests.
    resolveConfirm(true);
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
  });

  it("ListDetailOwnerPage_ShouldKeepLineBreaksAndWrapLongWordsInTheDescription_WhenItHasNewlines", () => {
    // Arrange — D4: the subtitle keeps line breaks and wraps long unbroken words instead of
    // collapsing whitespace or overflowing the card.
    const giftList = aGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: "Line one\nLine two",
          url: null,
        },
      ],
    });
    setState({ status: "ready", giftList });

    // Act
    renderListDetailPage();

    // Assert
    const description = screen.getByText((_, element) =>
      element?.textContent === "Line one\nLine two",
    );
    expect(description).toHaveStyle({
      whiteSpace: "pre-line",
      overflowWrap: "anywhere",
    });
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

  it("ListDetailOwnerPage_ShouldSendTheTrimmedDescriptionAndClearTheField_WhenAnItemIsAddedWithADescription", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Hoodie");
    await user.type(
      screen.getByLabelText("Description (optional)"),
      "  Size M, navy  ",
    );
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    await waitFor(() =>
      expect(addGiftItemMock).toHaveBeenCalledWith({
        listId: "list-1",
        name: "Hoodie",
        url: undefined,
        description: "Size M, navy",
      }),
    );
    await waitFor(() => expect(confirmChangeMock).toHaveBeenCalled());
    const predicate = confirmChangeMock.mock.calls[0][0] as (
      list: GiftListProjection,
    ) => boolean;
    expect(
      predicate(
        aGiftList({
          items: [
            { itemId: "new-item", name: "x", description: null, url: null },
          ],
        }),
      ),
    ).toBe(true);
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
  });

  it("ListDetailOwnerPage_ShouldShowHowManyDescriptionCharactersAreUsed_WhenTheOwnerTypes", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    const user = userEvent.setup();
    renderListDetailPage();
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();

    // Act
    await user.type(screen.getByLabelText("Description (optional)"), "hello");

    // Assert
    expect(screen.getByText("5 / 2000")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldCapTheAddItemDescriptionAt2000AndShowTheCounter_When2001CharactersArePasted", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    const user = userEvent.setup();
    renderListDetailPage();
    const textbox = screen.getByLabelText("Description (optional)");

    // Act
    await user.click(textbox);
    await user.paste("a".repeat(2001));

    // Assert
    expect(textbox).toHaveValue("a".repeat(2000));
    expect(screen.getByText("2000 / 2000")).toBeInTheDocument();
  });

  it("ListDetailOwnerPage_ShouldSendNoDescription_WhenTheAddItemDescriptionIsOnlySpaces", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Mug");
    await user.type(screen.getByLabelText("Description (optional)"), "   ");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    await waitFor(() => expect(addGiftItemMock).toHaveBeenCalledTimes(1));
    expect(addGiftItemMock.mock.calls[0][0].description).toBeUndefined();
    expect(addGiftItemMock).toHaveBeenCalledWith({
      listId: "list-1",
      name: "Mug",
      url: undefined,
    });
  });

  it("ListDetailOwnerPage_ShouldSendNoDescription_WhenTheAddItemDescriptionIsOnlyANextLineCharacter", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    addGiftItemMock.mockResolvedValue({ itemId: "new-item" });
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Mug");
    // fireEvent: user.type would not reliably deliver U+0085 as a key.
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "\u0085" },
    });
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    await waitFor(() => expect(addGiftItemMock).toHaveBeenCalledTimes(1));
    expect(addGiftItemMock.mock.calls[0][0].description).toBeUndefined();
  });

  it("ListDetailOwnerPage_ShouldKeepTheTypedDescription_WhenTheAddItemRpcFails", async () => {
    // Arrange
    setState({ status: "ready", giftList: aGiftList() });
    addGiftItemMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderListDetailPage();

    // Act
    await user.type(screen.getByLabelText("Item name"), "Mug");
    await user.type(screen.getByLabelText("Description (optional)"), "Blue");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    // Assert
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("Blue");
  });

  it("ListDetailOwnerPage_ShouldRenderNoDescriptionSubtitle_WhenTheItemHasNoDescription", () => {
    // Arrange
    setState({
      status: "ready",
      giftList: aGiftList({
        items: [
          {
            itemId: "item-1",
            name: "Headphones",
            description: null,
            url: "https://example.com/h",
          },
        ],
      }),
    });

    // Act
    renderListDetailPage();

    // Assert
    const name = screen.getByText("Headphones");
    expect(name.nextElementSibling).toBe(
      screen.getByRole("link", { name: "https://example.com/h" }),
    );
  });
});
