/**
 * The one place a `releaseSecret` (`ReserveGiftResponse.releaseSecret`) ever touches persistent
 * storage — `window.localStorage`, and nowhere else. `reservations.proto`'s own doc comment on
 * that field is explicit that it "appears in `ReserveGiftResponse` and NOWHERE ELSE... the
 * browser is responsible for keeping it", and ARCHITECTURE.md "Nobody can see *who* reserved"
 * states the client-side half of that rule directly: "'You reserved this' is rendered client-side
 * only, from `releaseSecret`s in that browser's own `localStorage`." This module never sends a
 * secret anywhere, never logs one, and exposes no function that returns every secret this browser
 * holds at once — only per-item presence (`hasReleaseSecret`) and a per-item save
 * (`saveReleaseSecret`), because that is all
 * `useReserveGift`'s "you reserved this" rendering ever needs. There is deliberately no
 * `getReleaseSecret` here yet: nothing in this codebase reads the secret's *value* back out until
 * a Release RPC exists to send it to (out of scope for GL-40 — see that ticket's own notes), and
 * exporting one now would be a function with no caller, an invitation for some future caller to
 * reach for `console.log(secret)` while debugging.
 *
 * Keyed on `(shareToken, itemId)`, not `itemId` alone — item ids are server-generated UUIDs with
 * no cross-list uniqueness guarantee promised anywhere in this codebase, and this file has no way
 * to check one.
 */
const STORAGE_KEY_PREFIX = "giftlist:reservation:";

function storageKey(shareToken: string, itemId: string): string {
  return `${STORAGE_KEY_PREFIX}${shareToken}:${itemId}`;
}

/**
 * Best-effort access to `window.localStorage`. A browser with storage disabled (private
 * browsing, a full quota, a locked-down embed, ...) degrades to "this browser never remembers its
 * own reservations" rather than throwing out of `useReserveGift`'s render path — reserving itself
 * still works, over the RPC, regardless of whether this module can persist anything.
 */
function withStorage<T>(run: (storage: Storage) => T, fallback: T): T {
  try {
    return run(window.localStorage);
  } catch {
    return fallback;
  }
}

/** Records that *this browser* reserved `itemId` on the list behind `shareToken`. */
export function saveReleaseSecret(
  shareToken: string,
  itemId: string,
  releaseSecret: string,
): void {
  withStorage(
    (storage) => storage.setItem(storageKey(shareToken, itemId), releaseSecret),
    undefined,
  );
}

/**
 * The entire client-side source of truth for "you reserved this" (ARCHITECTURE.md "Nobody can
 * see *who* reserved": "'You reserved this' is rendered client-side only, from `releaseSecret`s
 * in that browser's own `localStorage`") — never derived from any server field, because no server
 * field for this exists to derive it from.
 */
export function hasReleaseSecret(shareToken: string, itemId: string): boolean {
  return withStorage(
    (storage) => storage.getItem(storageKey(shareToken, itemId)) !== null,
    false,
  );
}
