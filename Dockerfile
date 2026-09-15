# Dev image for the SPA (GL-13). Build context is this repo's root (see
# giftlist-devenv/docker-compose.yml, which sets `context: ../giftlist-web`).
#
# giftlist-devenv/docker-compose.yml bind-mounts ../giftlist-web over /app at runtime and keeps
# node_modules in a named volume (bind-mounted node_modules is slow on Docker Desktop hosts).
#
# THERE IS NO `npm ci` IN THIS IMAGE ANY MORE, and its absence is forced, not a preference.
# Since the GL-25 split this repo depends on @giftlist/gateway-client as a `file:` tarball in
# ../local-feed — the Gateway owns the protos and publishes the generated client
# (ARCHITECTURE.md "Repository layout") — and ../local-feed sits outside this build context, so
# `npm ci` here cannot resolve it however it is written. That is the npm half of exactly the
# problem ARCHITECTURE.md "Making the local feed visible to containers" describes for NuGet, and
# it has the same answer: install at container runtime, where compose has mounted the feed.
#
# docker-entrypoint.sh already does that install and always did — it hashes package-lock.json
# against a marker recorded inside the volume on every container start (GL-58). It treats "no
# marker at all" as "never reconciled" and installs, which is precisely the state a brand-new
# volume is now in, so removing the warm-up below needs no change there. The cost is that the
# first start on a fresh volume installs from cold rather than from an image layer.
#
# WHAT STILL HAS TO LAND FOR THAT RUNTIME INSTALL TO WORK (GL-29): the feed must be mounted so
# that `file:../local-feed/...` resolves INSIDE the container exactly as it does on the host.
# /app is the repo, so `..` is `/`, which means the mount must be `../local-feed:/local-feed:ro`
# — NOT the `/feed` that section suggests for the .NET services. A `file:` specifier is baked
# into package.json and cannot differ between host and container the way a nuget.config source
# can, so the two mounts are not interchangeable.
FROM node:22-alpine

WORKDIR /app
COPY . .
RUN chmod +x docker-entrypoint.sh

# Polling file watching is set in vite.config.ts (server.watch.usePolling) because inotify across
# a bind mount is unreliable on macOS/Windows Docker Desktop. server.host: '0.0.0.0' there is what
# actually lets the published 5173 port reach Vite from outside the container.
EXPOSE 5173

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
