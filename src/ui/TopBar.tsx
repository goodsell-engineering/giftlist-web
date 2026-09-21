/**
 * The signed-in chrome at the top of every screen except the auth pages —
 * `mockups/style.css`'s `.topbar`/`.brand`/`.user-menu`. `TopBar` itself only lays out the brand
 * mark on the left and a single slot on the right; what goes in that slot is the caller's choice
 * (`TopBarUserMenu` below for the dashboard/list-detail screens' "name + avatar", or a row of
 * `NavLink`s for a page that isn't signed in yet) — see `.nav-links` in the mockups for the other
 * shape that slot takes, which this story doesn't need to render itself.
 *
 * Not wired into any page yet: GL-122/123/124 mount this against the real session data when they
 * restyle the pages that use it.
 */
import type { ReactNode } from "react";
import { Avatar, Box, Group, Text } from "@mantine/core";

import { Brand } from "./Brand";

export interface TopBarProps {
  /** Rendered on the right — `TopBarUserMenu` for a signed-in owner, or nav links otherwise. */
  right?: ReactNode;
}

export function TopBar({ right }: TopBarProps) {
  return (
    <Box
      component="header"
      style={{
        backgroundColor: "var(--gl-surface)",
        borderBottom: "1px solid var(--gl-border)",
      }}
    >
      <Group justify="space-between" px={32} py={16}>
        <Brand />
        {right}
      </Group>
    </Box>
  );
}

export interface TopBarUserMenuProps {
  /** The signed-in user's display name — GL-19's `AuthSession` doesn't carry one today, so
   * callers pass whatever they have (e.g. the value entered at sign-up) rather than this
   * component reaching into auth state itself. */
  displayName: string;
}

function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0)?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** `.user-menu`/`.avatar` — name plus an initials avatar, no photo. */
export function TopBarUserMenu({ displayName }: TopBarUserMenuProps) {
  return (
    <Group gap={10}>
      <Text size="sm" c="var(--gl-text-muted)">
        {displayName}
      </Text>
      <Avatar color="primary" radius="xl" size={32}>
        {initialsFor(displayName)}
      </Avatar>
    </Group>
  );
}
