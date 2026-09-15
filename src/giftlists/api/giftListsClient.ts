/**
 * The generated grpc-web client for the GiftLists command surface (GL-71's five RPCs), as
 * exposed by the Gateway over grpc-web — same transport/precedent as
 * identity/api/authClient.ts, which this file otherwise mirrors closely.
 *
 * Unlike AuthService (SignUp/Login, which must stay anonymous — see authClient.ts), every RPC on
 * GiftListsService is mapped with `RequireAuthorization()` (giftlists.proto's own remarks,
 * GatewayGrpcEndpointRouteBuilderExtensions), so every call here needs the caller's access token
 * on the wire. That's why this file exports a *factory*, not a module-level singleton client the
 * way authClient.ts does: the token lives in AuthProvider's in-memory session, not at module
 * scope, and can change (login/logout) during the life of the page — a singleton created once at
 * import time could never see a token at all, let alone a fresh one after re-login.
 */
import { createClient, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

import { GiftListsService } from "@giftlist/gateway-client";

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";

/**
 * Attaches the caller's access token as a standard `Authorization: Bearer` header — the same
 * header shape Gateway.Infrastructure's `AddJwtBearer` expects (it reads the default ASP.NET
 * Core JWT bearer location), so nothing Gateway-specific is needed on this side.
 */
function withAccessToken(accessToken: string): Interceptor {
  return (next) => (request) => {
    request.header.set("Authorization", `Bearer ${accessToken}`);
    return next(request);
  };
}

export function createGiftListsClient(accessToken: string) {
  const transport = createGrpcWebTransport({
    baseUrl: gatewayUrl,
    interceptors: [withAccessToken(accessToken)],
  });

  return createClient(GiftListsService, transport);
}

export type GiftListsClient = ReturnType<typeof createGiftListsClient>;
