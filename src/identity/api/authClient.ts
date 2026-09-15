/**
 * The generated TS client for Identity's SignUp/Login, as exposed by the Gateway over grpc-web
 * (GL-18). Since the GL-25 split it arrives as the @giftlist/gateway-client npm package, built
 * from identity.proto in giftlist-gateway — the repo that owns the .proto files and publishes
 * the client (ARCHITECTURE.md "Repository layout"). Nothing is generated in this repo any more.
 *
 * Wired into the actual Log-in/Sign-up pages (submit handlers, error-message mapping, the
 * in-memory session) by GL-19 — see identity/auth/AuthProvider.tsx and identity/api/authErrors.ts.
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

import { AuthService } from "@giftlist/gateway-client";

// The Gateway's own origin — grpc-web, not the Connect protocol, because Gateway.Host's
// ASP.NET Core pipeline speaks grpc-web (Grpc.AspNetCore.Web's UseGrpcWeb), not Connect's own
// wire format. Falls back to the Gateway's devenv-published port so `npm run dev` outside the
// compose stack still points somewhere sensible.
const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";

const transport = createGrpcWebTransport({ baseUrl: gatewayUrl });

export const authClient = createClient(AuthService, transport);
