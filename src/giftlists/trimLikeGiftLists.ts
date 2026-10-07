// GiftLists normalises with .NET string.Trim() (char.IsWhiteSpace), which also strips U+0085;
// JS trim() does not. \s is exactly trim()'s set, so this only adds U+0085.
export const trimLikeGiftLists = (value: string): string =>
  value.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
