/**
 * The centred 420px card used by sign-up, log-in and the spoiler interstitial —
 * `mockups/style.css`'s `.auth-page`/`.auth-card`. `AuthCard` supplies both: the full-viewport,
 * radially-gradiented page background (`.auth-page`) and the white card itself (`.card.auth-card`)
 * — a caller only needs to provide the brand mark, heading and body.
 *
 * mockups/style.css's `.auth-card` is 380px wide; this story's spec calls it 420px, so 420px wins
 * (the spec is the more recent of the two, and login.html/signup.html render fine wider).
 */
import type { ReactNode } from "react";
import { Box, Paper } from "@mantine/core";

export interface AuthCardProps {
  children: ReactNode;
}

export function AuthCard({ children }: AuthCardProps) {
  return (
    <Box
      component="main"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 20%, var(--mantine-color-primary-0) 0%, var(--gl-bg) 45%)",
      }}
    >
      <Paper
        radius="lg"
        shadow="md"
        withBorder
        style={{ borderColor: "var(--gl-border)" }}
        w={420}
        p={32}
      >
        {children}
      </Paper>
    </Box>
  );
}
