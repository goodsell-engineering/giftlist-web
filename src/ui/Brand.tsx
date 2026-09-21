/**
 * The "🎁 GiftList" brand mark — `mockups/style.css`'s `.brand`/`.mark`. Shared by `TopBar` (every
 * signed-in screen) and the auth pages (`SignUpPage`/`LogInPage` render it as `AuthCard`'s first
 * child, matching `.auth-card`'s own `.brand` row in signup.html/login.html) so the gradient tile
 * is defined once rather than twice.
 */
import { Box, Group, Text } from "@mantine/core";

export function Brand() {
  return (
    <Group gap={8}>
      <Box
        w={30}
        h={30}
        style={{
          borderRadius: 8,
          background:
            "linear-gradient(135deg, var(--mantine-color-primary-6), var(--mantine-color-accent-6))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          color: "white",
        }}
        aria-hidden
      >
        🎁
      </Box>
      <Text fw={700} size="lg" c="var(--gl-text)">
        GiftList
      </Text>
    </Group>
  );
}
