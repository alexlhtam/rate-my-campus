import { getChatGPTUser } from "@/app/chatgpt-auth";
import { consumeRateLimit } from "@/lib/community-server";
import { fetchGoogleMap, googleMapSession, integrationErrorResponse, IntegrationError, integrationStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
function numberParam(params: URLSearchParams, name: string, min: number, max: number) {
  const raw = params.get(name);
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new IntegrationError(400, "Invalid map coordinates.");
  return String(value);
}

export async function GET(request: Request, context: Context) {
  try {
    const { path } = await context.params;
    const status = await integrationStatus();
    if (path.length === 1 && path[0] === "provider") {
      return Response.json(status.google
        ? { provider: "google", attribution: "Google Maps", requiresSignIn: true, sessionUrl: "/api/map/session", tileUrl: "/api/map/tile/{z}/{x}/{y}?session={session}", viewportUrl: "/api/map/viewport" }
        : { provider: "openstreetmap", attribution: "© OpenStreetMap contributors", tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", notice: "Google Maps is not connected. Showing OpenStreetMap." }, { headers: { "Cache-Control": "no-store" } });
    }
    const identity = await getChatGPTUser();
    if (!identity) throw new IntegrationError(401, "Sign in to load Google Maps.");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new IntegrationError(403, "Open Rate My Campus directly to load its map.");
    if (!status.google) throw new IntegrationError(503, "Google Maps is not connected yet.");
    const params = new URL(request.url).searchParams;
    if (path.length === 1 && path[0] === "session") {
      await consumeRateLimit(identity.userId, "map-session", 20, 3600);
      return Response.json(await googleMapSession(), { headers: { "Cache-Control": "no-store" } });
    }
    const session = params.get("session");
    if (!session || session.length > 512 || !/^[A-Za-z0-9_=-]+$/.test(session)) throw new IntegrationError(400, "Invalid map session. Reload the map.");
    if (path.length === 4 && path[0] === "tile") {
      const [z, x, y] = path.slice(1).map(Number);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new IntegrationError(400, "Invalid map tile.");
      await consumeRateLimit(identity.userId, "map-tile", 900, 3600);
      const forwarded = new Headers();
      const etag = request.headers.get("if-none-match");
      if (etag) forwarded.set("If-None-Match", etag);
      const upstream = await fetchGoogleMap(`v1/2dtiles/${z}/${x}/${y}`, new URLSearchParams({ session }), forwarded);
      const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
      for (const name of ["content-type", "cache-control", "etag", "last-modified", "expires"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      // Never cache on the server; honour Google's client caching/revalidation headers.
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
      return new Response(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers });
    }
    if (path.length === 1 && path[0] === "viewport") {
      await consumeRateLimit(identity.userId, "map-viewport", 120, 3600);
      const forwarded = new URLSearchParams({ session });
      forwarded.set("zoom", numberParam(params, "zoom", 0, 22));
      for (const name of ["north", "south"]) forwarded.set(name, numberParam(params, name, -89.999, 89.999));
      for (const name of ["east", "west"]) forwarded.set(name, numberParam(params, name, -179.999, 179.999));
      const upstream = await fetchGoogleMap("tile/v1/viewport", forwarded);
      return Response.json(await upstream.json(), { headers: { "Cache-Control": "no-store" } });
    }
    throw new IntegrationError(404, "Map endpoint not found.");
  } catch (error) { return integrationErrorResponse(error); }
}
