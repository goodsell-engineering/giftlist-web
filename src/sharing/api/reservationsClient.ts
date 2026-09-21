/**
 * The generated grpc-web client for `ReservationsService.ReserveGift` (GL-37), as exposed by the
 * Gateway over grpc-web — same transport/precedent as identity/api/authClient.ts.
 *
 * A module-level singleton, not a factory like giftlists/api/giftListsClient.ts: `ReserveGift`
 * maps anonymously (reservations.proto's own remarks, `ReservationsGrpcService`'s doc comment) —
 * the share token carried on every request is the whole credential, exactly like AuthService's
 * SignUp/Login. There is no per-session access token this client would ever need to attach, so
 * unlike `createGiftListsClient` there is nothing that could go stale between a login and a
 * re-login for this one to need re-creating for.
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

import { ReservationsService } from "@giftlist/gateway-client";

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";

const transport = createGrpcWebTransport({ baseUrl: gatewayUrl });

export const reservationsClient = createClient(ReservationsService, transport);
