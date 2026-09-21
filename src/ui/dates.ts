/**
 * Locale-aware date formatting and dayjs locale resolution (GL-121). The three existing
 * `toLocaleDateString()` call sites (DashboardPage, ListDetailOwnerPage, SharedListPage) are left
 * alone here on purpose — GL-122/123/124 replace them with `formatCalendarDate` when they restyle
 * those pages — but the source of truth for *how* a calendar date should be formatted is stated
 * once, in this file, from here on.
 */
import "dayjs/locale/en";
import "dayjs/locale/en-gb";
import "dayjs/locale/en-au";
import "dayjs/locale/en-ie";
import "dayjs/locale/de";
import "dayjs/locale/fr";
import "dayjs/locale/es";
import "dayjs/locale/nl";

/**
 * Renders the calendar day `iso` (an ISO-8601 string — `GiftListProjection.expiresAt`'s shape;
 * see that field's own doc comment) as a locale-formatted date, e.g. "12 Oct 2026" (en-GB) or
 * "Oct 12, 2026" (en-US).
 *
 * `timeZone: "UTC"` is mandatory, not an incidental option: `expiresAt` is stored as UTC midnight
 * (`ExpiryDate`, GiftLists' domain type), and formatting it in the *viewer's* local time zone
 * shows the previous calendar day for anyone west of UTC — e.g. a US Pacific viewer (UTC−8) sees
 * "11 Oct 2026" for a list that expires "12 Oct 2026" UTC. Pinning the formatter to UTC makes the
 * rendered day match the day the value actually represents, regardless of where the browser is.
 *
 * `locale` defaults to the browser's own locale (`Intl.DateTimeFormat`'s behaviour when the first
 * argument is `undefined`) and is otherwise for tests only — production call sites should not pass
 * it, so the format always follows the same locale-detection path `DatesProvider` uses (see
 * `resolveDayjsLocale` below).
 */
export function formatCalendarDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * The dayjs locale files this app registers eagerly (the imports above) — the handful of locales
 * covering the demo's expected audience, not an attempt at every dayjs locale. Extending this list
 * means adding both the id here and its `import "dayjs/locale/…"` above; the two are deliberately
 * kept next to each other rather than generated, so an unregistered locale id can't silently slip
 * back into this array.
 */
const SUPPORTED_DAYJS_LOCALES = [
  "en",
  "en-gb",
  "en-au",
  "en-ie",
  "de",
  "fr",
  "es",
  "nl",
] as const;

type SupportedDayjsLocale = (typeof SUPPORTED_DAYJS_LOCALES)[number];

const FALLBACK_DAYJS_LOCALE: SupportedDayjsLocale = "en";

function isSupportedDayjsLocale(value: string): value is SupportedDayjsLocale {
  return (SUPPORTED_DAYJS_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves a BCP-47 language tag (`navigator.language`'s shape, e.g. "en-GB", "de-DE", "pt-BR")
 * to one of `SUPPORTED_DAYJS_LOCALES`, falling back to "en" for anything this app hasn't loaded a
 * dayjs locale file for.
 *
 * Takes `browserLanguage` as a parameter — defaulting to `navigator.language` — rather than
 * reading `navigator` internally, so GL-122's date picker (and this file's own tests) can call it
 * with an explicit value instead of depending on jsdom's/the test runner's navigator. Exported for
 * exactly that reuse: `DatesProvider`'s `settings.locale` (App.tsx) and GL-122's date picker are
 * meant to resolve the same locale the same way, not two independent guesses.
 */
export function resolveDayjsLocale(
  // `globalThis.navigator?.language` rather than `navigator.language`: a default parameter only
  // fills a *missing* argument, so if the property itself were undefined the old default would
  // have been passed through and `.toLowerCase()` would throw at App mount (Batch 42 review, S1).
  browserLanguage: string | undefined = globalThis.navigator?.language,
): SupportedDayjsLocale {
  const lower = (browserLanguage ?? "").toLowerCase();
  if (isSupportedDayjsLocale(lower)) {
    return lower;
  }

  const [language] = lower.split("-");
  if (language !== undefined && isSupportedDayjsLocale(language)) {
    return language;
  }

  return FALLBACK_DAYJS_LOCALE;
}
