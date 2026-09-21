import { describe, expect, it } from "vitest";

import { formatCalendarDate, resolveDayjsLocale } from "./dates";

describe("formatCalendarDate", () => {
  it("formatCalendarDate_ShouldRenderDayMonthYear_WhenLocaleIsEnGb", () => {
    // Arrange
    const iso = "2026-10-12T00:00:00Z";

    // Act
    const formatted = formatCalendarDate(iso, "en-GB");

    // Assert
    expect(formatted).toBe("12 Oct 2026");
  });

  it("formatCalendarDate_ShouldRenderMonthDayYear_WhenLocaleIsEnUs", () => {
    // Arrange — same instant as the en-GB case above, different locale.
    const iso = "2026-10-12T00:00:00Z";

    // Act
    const formatted = formatCalendarDate(iso, "en-US");

    // Assert
    expect(formatted).toBe("Oct 12, 2026");
  });

  it("formatCalendarDate_ShouldNotShiftToTheNextCalendarDay_WhenTheHostTimeZoneRunsAheadOfUtc", () => {
    // Arrange — vite.config.ts pins TZ=Asia/Kolkata (UTC+5:30) for every test in this repo
    // deliberately (see that file's comment). 20:00 UTC on the 11th is already 01:30 local on the
    // 12th, so a caller that formatted `new Date(iso)` in the host's local time zone — instead of
    // forcing UTC — would render "12 Oct 2026" here. This is the regression test for exactly that:
    // it fails if `timeZone: "UTC"` is ever removed from formatCalendarDate.
    const iso = "2026-10-11T20:00:00Z";

    // Act
    const formatted = formatCalendarDate(iso, "en-GB");

    // Assert
    expect(formatted).toBe("11 Oct 2026");
  });
});

describe("resolveDayjsLocale", () => {
  it("resolveDayjsLocale_ShouldReturnTheExactMatch_WhenTheBrowserLanguageIsARegisteredLocale", () => {
    // Arrange — no arrangement beyond the input itself.

    // Act
    const locale = resolveDayjsLocale("en-GB");

    // Assert
    expect(locale).toBe("en-gb");
  });

  it("resolveDayjsLocale_ShouldFallBackToTheBaseLanguage_WhenTheRegionIsNotRegisteredButTheLanguageIs", () => {
    // Arrange — "de-AT" (Austrian German) has no dedicated dayjs locale file registered here, but
    // "de" does.
    const browserLanguage = "de-AT";

    // Act
    const locale = resolveDayjsLocale(browserLanguage);

    // Assert
    expect(locale).toBe("de");
  });

  it("resolveDayjsLocale_ShouldFallBackToEn_WhenTheBrowserLanguageIsUndefined", () => {
    // Arrange
    const browserLanguage = undefined;

    // Act
    const locale = resolveDayjsLocale(browserLanguage);

    // Assert
    expect(locale).toBe("en");
  });

  it("resolveDayjsLocale_ShouldFallBackToEn_WhenNeitherTheLanguageNorTheRegionIsRegistered", () => {
    // Arrange
    const browserLanguage = "ja-JP";

    // Act
    const locale = resolveDayjsLocale(browserLanguage);

    // Assert
    expect(locale).toBe("en");
  });
});
