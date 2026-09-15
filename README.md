# giftlist-web

React + TypeScript + Vite SPA for the GiftList demo (requires Node >= 22, per `engines`).

```
npm install
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run test         # vitest run
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint .
npm run format:check # prettier --check .
```

## The Gateway client is a package now, not a generator

This repo used to run `buf generate` against `../gateway/protos` on every `dev`/`build`/`test`,
writing into `src/gen`. GL-25 moved that to `giftlist-gateway`, which owns the `.proto` files and
publishes the generated client (ARCHITECTURE.md "Repository layout"). There is no `buf.gen.yaml`,
no `src/gen` and no `pre*` hook here any more:

```ts
import { AuthService, GiftListsService } from "@giftlist/gateway-client";
```

The dependency is a **tarball in the shared local folder feed**:

```json
"@giftlist/gateway-client": "file:../local-feed/giftlist-gateway-client-0.1.0.tgz"
```

so `npm install` needs the feed populated first — `make pack-all` in `giftlist-devenv` (GL-28)
does that, or by hand:

```
cd ../giftlist-gateway/clients/typescript && npm install && npm pack --pack-destination ../../../local-feed
```

**If you repack the same version, npm will not pick it up.** `package-lock.json` records the
tarball's integrity hash and npm serves the old content from its content-addressed cache; a plain
`npm install` reports "up to date" and a `--force` reinstall still gives you the stale copy. That
is the npm twin of the NuGet `(id, version)` cache hazard ARCHITECTURE.md "Packaging: local feed"
describes, and it has the same answer: bump the version. GL-28's overwrite guard is what turns a
forgotten bump into an error instead of an afternoon.

**Adding or upgrading a dependency?** Under compose, `node_modules` lives in a named volume
rather than the bind mount, so the container reconciles it against `package-lock.json` on
start. `make up` handles that for you; read `../giftlist-devenv/README.md`, "Adding a dependency
to `web`", for what happens when it doesn't.

Routes are stubbed one per mockup screen — the mockups are the design source of truth and live
in the workspace repository, not here. `src/` is organised domain-first (see `docs/CONVENTIONS.md` "Folder structure"):
`identity/`, `giftlists/`, `sharing/` each hold their own `pages/`; `app/` is
framework wiring (router, root component) that belongs to no domain.
