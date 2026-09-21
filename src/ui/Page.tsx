/**
 * The 1040px max-width, centred content column every signed-in screen sits in —
 * `mockups/style.css`'s `.page` (`max-width: 1040px; margin: 0 auto; padding: 32px 24px 64px;`).
 * Renders a `<main>` (there is exactly one per route) so pages that use `Page` don't each declare
 * their own landmark.
 */
import type { ReactNode } from "react";
import { Box } from "@mantine/core";

export interface PageProps {
  children: ReactNode;
}

export function Page({ children }: PageProps) {
  return (
    <Box
      component="main"
      maw={1040}
      mx="auto"
      px={{ base: 16, sm: 24 }}
      pt={32}
      pb={64}
    >
      {children}
    </Box>
  );
}
