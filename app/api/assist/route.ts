import { z } from "zod";
import { currentUser } from "@/lib/supabase";
import { consumeRateLimit, requireVerified } from "@/lib/community-server";
import { assertSameOrigin } from "@/lib/community-validation";
import { extractFood, extractPin, importUnionEvent, integrationErrorResponse, IntegrationError, integrationStatus, locatePlace, readLimitedText, runtimeEnv, searchWithClaude, summarizeReviews } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["search", "extract", "extract-food", "locate", "summary", "import-event"]),
  text: z.string().max(8000).optional(),
  image: z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), data: z.string().max(2_800_000) }).optional(),
  reviews: z.array(z.string().max(2500)).max(30).optional(),
  sourceUrl: z.string().url().max(500).optional(),
});

function prerequisiteDeadline(signal: AbortSignal) {
  const end = Date.now() + 8000;
  const timeout = () => new IntegrationError(504, "Campus services took too long to respond. Please try again.");
  const cancelled = () => new IntegrationError(408, "The request was cancelled. Please try again.");
  const check = () => { if (signal.aborted) throw cancelled(); if (Date.now() >= end) throw timeout(); };
  return {
    check,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        let finished = false;
        const finish = (outcome: { value: T } | { error: unknown }) => {
          if (finished) return;
          finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
          if ("error" in outcome) reject(outcome.error); else resolve(outcome.value);
        };
        const abort = () => finish({ error: cancelled() });
        const timer = setTimeout(() => finish({ error: timeout() }), Math.max(0, end - Date.now()));
        signal.addEventListener("abort", abort, { once: true });
        // The awaited boundary rejects on expiry. A delayed Auth/DB result can
        // settle its own operation, but cannot continue the route to Claude.
        Promise.resolve().then(() => { check(); return operation(); }).then(
          value => { try { check(); finish({ value }); } catch (error) { finish({ error }); } },
          error => finish({ error }),
        );
      });
    },
  };
}

export async function GET() {
  const [status, identity, env] = await Promise.all([integrationStatus(), currentUser(), runtimeEnv()]);
  const admins = typeof env.ADMIN_USER_IDS === "string" ? env.ADMIN_USER_IDS.split(",").map(value => value.trim()) : [];
  let verified = false;
  if (identity) { try { await requireVerified(); verified = true; } catch { /* Status remains false while storage/verification is unavailable. */ } }
  return Response.json({ ...status, signedIn: Boolean(identity), verified, moderator: Boolean(identity && admins.includes(identity.userId)) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new IntegrationError(415, "This feature expects a JSON request.");
    const deadline = prerequisiteDeadline(request.signal);
    const identity = await deadline.run(currentUser);
    if (!identity) throw new IntegrationError(401, "Sign in to use connected services.");
    const body = bodySchema.parse(JSON.parse(await readLimitedText(request, 3_000_000)));
    // The limit is stored atomically in Postgres and applies across instances.
    // Search shares one eight-second prerequisite budget. Claude then has its
    // own 25-second transport deadline; the browser also bounds the full request.
    if (body.action === "search") await deadline.run(() => consumeRateLimit(identity.userId, "assist", 30, 3600));
    else await consumeRateLimit(identity.userId, "assist", 30, 3600);
    if (body.action === "search") {
      if (!body.text?.trim()) throw new IntegrationError(400, "Enter a search first.");
      deadline.check();
      return Response.json({ provider: "anthropic", filters: await searchWithClaude(body.text) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "locate") {
      if (!body.text?.trim()) throw new IntegrationError(400, "Enter a location first.");
      return Response.json({ provider: "google", attribution: "Google Maps", places: await locatePlace(body.text) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "summary") {
      if (!body.reviews?.length) throw new IntegrationError(400, "There are no reviews to summarise yet.");
      return Response.json({ provider: "anthropic", summary: await summarizeReviews(body.reviews) }, { headers: { "Cache-Control": "no-store" } });
    }
    await requireVerified();
    if (body.action === "extract-food") {
      if (!body.text?.trim() && !body.image) throw new IntegrationError(400, "Add a description or a label photo first.");
      return Response.json({ provider: "anthropic", pin: await extractFood(body.text || "", body.image) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "extract") {
      if (!body.text?.trim() && !body.image) throw new IntegrationError(400, "Add a description or a photo first.");
      return Response.json({ provider: "anthropic", pin: await extractPin(body.text || "", body.image) }, { headers: { "Cache-Control": "no-store" } });
    }
    const env = await runtimeEnv();
    const admins = typeof env.ADMIN_USER_IDS === "string" ? env.ADMIN_USER_IDS.split(",").map(value => value.trim()) : [];
    if (!admins.includes(identity.userId)) throw new IntegrationError(403, "Only a site moderator can import source listings.");
    if (!body.sourceUrl) throw new IntegrationError(400, "Provide an event URL.");
    if (env.UNION_IMPORT_ENABLED !== "true" || !env.ANTHROPIC_API_KEY) throw new IntegrationError(503, "Source imports need approved source permission and a connected Claude service.");
    // A conservative shared hourly limit, not a background crawler.
    await consumeRateLimit("union-source", "event-import", 1, 3600);
    return Response.json({ provider: "anthropic", ...await importUnionEvent(body.sourceUrl) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error); }
}
