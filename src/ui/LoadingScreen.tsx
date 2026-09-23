/**
 * The one full-page loading treatment for a route that has nothing else to show yet — pulled out
 * so every caller renders the exact same markup (GL-42, folded from GL-39's own review): a signed-
 * in visitor opening `/share/:shareToken` used to see two *different*-looking loading screens in a
 * row — `ShareTokenPage`'s own bare `Center`/`Loader` while `useShareTokenOwnership` checked
 * `myGiftLists`, immediately followed by `SharedListPage`'s own `TopBar` + `Center`/`Loader` once
 * ownership resolved to "guest" and its own fetch started. Two network round trips are still
 * sequential — nothing here changes that — but two renders that look identical read as one
 * continuous wait instead of a page flashing and re-laying-out under the visitor.
 */
import { Center, Loader, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { TopBar } from "./TopBar";

export interface LoadingScreenProps {
  message?: string;
  /** `TopBar`'s own `right` slot — a caller that knows more about the visitor (e.g. `SharedListPage`'s
   * "Log in" link) can still show it, but the layout itself must not change between one loading
   * screen and the next just because a caller now knows something a moment earlier one didn't. */
  topBarRight?: ReactNode;
}

export function LoadingScreen({
  message = "Loading…",
  topBarRight,
}: LoadingScreenProps) {
  return (
    <>
      <TopBar right={topBarRight} />
      <Center component="main" mih="60vh">
        <Stack align="center" gap="sm">
          <Loader color="primary" />
          <Text c="dimmed" size="sm">
            {message}
          </Text>
        </Stack>
      </Center>
    </>
  );
}
