#!/bin/sh
# GL-58: devenv/docker-compose.yml keeps /app/node_modules in a named volume
# (web-node-modules) rather than the ../web bind mount, because bind-mounted node_modules is
# slow on Docker Desktop hosts (see web/Dockerfile). Docker only ever seeds a *new* named volume
# from the image; an existing one is never refreshed on a plain `docker compose up`. So once
# that volume exists, adding a devDependency to package.json rebuilds the image with the new
# package installed, but the *running* container still sees whatever was in the volume the
# first time it was created — the image's node_modules never becomes visible again. The failure
# this produces names something inside node_modules ("buf: not found", "Cannot find package
# 'x'"), not the volume, so it is very easy to misdiagnose.
#
# This entrypoint makes the container self-healing instead: on every start, hash
# package-lock.json and compare it to the hash recorded the last time `npm ci` actually ran
# *inside this volume*. A mismatch (including "no recorded hash at all", e.g. a volume seeded
# before this entrypoint existed) triggers `npm ci`; a match skips it, so the install cost is
# only ever paid when the lockfile changed.
#
# The marker lives inside the volume itself (node_modules/.giftlist-lock-hash), NOT under
# /app directly — /app is the bind-mounted host source tree, so a marker there would be shared
# with the host and would defeat the whole check (the host's own node_modules/install history is
# irrelevant to what this container's volume has installed).
set -eu

LOCKFILE=/app/package-lock.json
NODE_MODULES=/app/node_modules
MARKER="$NODE_MODULES/.giftlist-lock-hash"

if [ ! -f "$LOCKFILE" ]; then
  echo "FATAL (web docker-entrypoint.sh): $LOCKFILE not found." >&2
  echo "Expected ../web to be bind-mounted to /app — check devenv/docker-compose.yml's" >&2
  echo "'web' service volumes." >&2
  exit 1
fi

mkdir -p "$NODE_MODULES"

new_hash="$(sha256sum "$LOCKFILE" | awk '{ print $1 }')"

# Batch 9 review: this check is load-bearing, not defensive. `sha256sum ... | awk` is a PIPELINE,
# so the command substitution reports awk's exit status, not sha256sum's — `set -e` cannot see a
# failed hash, and new_hash silently becomes "". That mattered because "" was also the sentinel
# for "never reconciled" below, so a broken hasher made the two compare EQUAL and took the
# "already matches" branch, exec'ing Vite on a completely uninstalled volume — precisely the
# silent, misattributed failure this script exists to abolish. Not reachable on node:22-alpine
# (busybox ships sha256sum), but the branch that decides the volume is FINE was the one branch
# `set -e` did not protect.
if [ -z "$new_hash" ]; then
  echo "FATAL (web docker-entrypoint.sh): could not hash $LOCKFILE." >&2
  echo "Refusing to start rather than guess whether 'giftlist_web-node-modules' is current." >&2
  exit 1
fi

# A sentinel that cannot collide with a real sha256 hash, so "never reconciled" stays distinct
# from any value the hasher can produce.
old_hash="<never-reconciled>"
if [ -f "$MARKER" ]; then
  old_hash="$(cat "$MARKER")"
fi

if [ "$new_hash" != "$old_hash" ]; then
  echo "web entrypoint: package-lock.json hash changed since 'giftlist_web-node-modules' was" >&2
  echo "last reconciled (or it never has been) — running npm ci..." >&2
  # Drop the marker BEFORE installing, so "marker present" means "a full npm ci completed for
  # that hash" by construction. Batch 9 review: this invariant already held, but only because
  # npm ci happens to delete node_modules' dotfiles (this marker included) before reifying —
  # third-party behaviour that nothing here states or tests. Removing it ourselves means a
  # container killed mid-install can never leave a stale marker that makes the next start
  # report the volume as healthy.
  rm -f "$MARKER"
  if ! npm ci; then
    echo "============================================================================" >&2
    echo "FATAL (web docker-entrypoint.sh): npm ci failed." >&2
    echo "" >&2
    echo "The 'giftlist_web-node-modules' Docker volume could not be reconciled against" >&2
    echo "web/package-lock.json, so this container is refusing to start on a stale or" >&2
    echo "incomplete node_modules rather than failing later with a confusing" >&2
    echo "'command not found' or 'cannot find module' error." >&2
    echo "" >&2
    echo "Check network/registry access above, then retry with:" >&2
    echo "  cd devenv && make up" >&2
    echo "If that keeps failing, drop the volume for a genuinely clean install:" >&2
    echo "  cd devenv && make reset && make up" >&2
    echo "============================================================================" >&2
    exit 1
  fi
  echo "$new_hash" > "$MARKER"
else
  echo "web entrypoint: node_modules already matches package-lock.json — skipping npm ci" >&2
fi

exec "$@"
