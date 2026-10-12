# Rate My Campus

A mobile-first UCL campus map with category-specific place reviews, society freebies, time-limited food alerts, student deals, anonymous community discussion and UCL email verification.

The canonical project repository is [alexlhtam/rate-my-campus](https://github.com/alexlhtam/rate-my-campus).

## Run locally

Requires Node.js 22.13 or newer. Install with `npm ci`, link the Vercel project (`vercel link`), pull its environment with `vercel env pull .env.local`, then run `npm run dev`. Without Supabase variables the app still runs in demo mode and live routes answer "not connected yet".

## Deploy on Vercel with Supabase

The app is a standard Next.js app. Vercel runs the `/api/*` route handlers as Node.js functions in Dublin (`dub1`, see `vercel.json`), next to the Supabase project in `eu-west-1`.

1. **Create the Supabase project.** Easiest is the Supabase integration on the Vercel Marketplace (Project → Storage → Supabase), which creates the project and sets `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `POSTGRES_URL` for you. If you connect an existing project instead, add those four by hand; `POSTGRES_URL` is the **transaction pooler** string (port 6543).
2. **Apply the schema.** `supabase link --project-ref <ref>` then `supabase db push`, or paste `supabase/migrations/*.sql` into the SQL editor. It creates the tables with row-level security on (the server connects as the owner; the public Data API sees nothing) and a private `photos` storage bucket.
3. **Turn on email codes.** In Supabase → Authentication → Emails, edit the *Magic Link* template so it shows `{{ .Token }}` (the six-digit code the app asks for) and keep the email OTP length at 6. Supabase's built-in mailer only reaches your own team's addresses, so add custom SMTP (Resend works: host `smtp.resend.com`, user `resend`, password = a Resend API key, sender on your verified domain). Add your production URL under Authentication → URL Configuration.
4. **Add the other variables** from `.env.example` in Vercel (Anthropic, Google Maps, `ADMIN_USER_IDS`). Moderator IDs are Supabase Auth user IDs; signed-in users can copy theirs from the moderation panel.
5. **Deploy.** Push the branch for a preview deployment, or run `vercel deploy`.

Sign-in is a Supabase Auth email code restricted to `@ucl.ac.uk`, so signing in is the UCL verification. Sessions are cookies set by `/api/community/auth/*`.

### Share the demo on local Wi-Fi

After `npm ci` and `npm run build`, run `npm run lan`. Open the printed IP address from another device on the same network. The launcher chooses a non-loopback IPv4 interface, preferring Wi-Fi; override it with `npm run lan -- --host YOUR_LAN_IP`. Optional `--port 3000` and `--worker-port 8787` change the listener ports. If a port is occupied, choose another or stop your own earlier launcher; existing processes are never stopped automatically. Allow the selected demo port through your private-network firewall if necessary. Network client isolation can prevent devices from reaching each other.

This is a **demo on each device**, not a shared live database. Reviews, posts and votes created in demo mode stay in that browser. The LAN proxy accepts only clients on the selected interface's subnet, serves public pages/assets and fixed demo state, and blocks sign-in, live mutations, administrative routes and paid API calls. Its `next start` server stays bound to `127.0.0.1`; incoming identity headers and cookies are not forwarded. No migrations or service secrets are needed for this demo. Press Ctrl+C to stop the launcher and the server it created. Do not expose that server or a development server to the network.

## Live service configuration

Set production server environment variables in Vercel. Local development uses an ignored `.env.local` with the names in `.env.example`. Never commit credentials.

- `ANTHROPIC_API_KEY`: Claude search, text/photo extraction, summaries and automatic moderation.
- `ANTHROPIC_MODEL`: optional, defaults to `claude-sonnet-4-6`.
- `GOOGLE_MAPS_API_KEY`: server key restricted to Google Map Tiles API and Places API (New). No browser key is used. Enable billing, quotas and alerts in Google Cloud.
- Supabase variables: see *Deploy on Vercel with Supabase* above. Email codes are sent by Supabase Auth through its SMTP settings.
- `ADMIN_USER_IDS`: Supabase Auth user IDs for the exception/reports queue and event importer.
- `UNION_IMPORT_ENABLED=true`: enable only after confirming source permission and current terms.

Routine suitable submissions are published automatically after Claude checks them. Flagged content, uncertain results or an unavailable model stay private pending exception review. Photos are re-encoded in the browser and metadata is stripped on the server. Reports can trigger hiding pending review.

## Demo and real data

The demo includes 14 directory entries (13 real places and one explicitly fictional rental), 26 synthetic reviews, 6 illustrative alerts/deals and 8 sample threads. Demo contributions stay in browser storage and are separated from real ratings and public records. Switch to real activity to view only actual community content. No real reviews or Union events have been fabricated or seeded into the database.

When Google is disconnected, a clearly attributed OpenStreetMap map remains available. Campus building footprints are real OpenStreetMap polygons. Most heights are estimates from mapped floors or labelled illustrative defaults. The fixed-perspective extrusion is a visual aid, not an architectural survey or extracted Google 3D mesh.

The Union importer accepts a single public event URL, extracts explicit food/merch evidence with Claude, asks the operator to confirm time/location, credits the source and deduplicates it. Imports are limited to one per hour. No recurring crawler is running.

## Useful routes

- `GET /api/community/state`: public approved records plus own private pending records and own profile.
- `POST /api/community/auth/request`, `POST /api/community/auth/verify`, `POST /api/community/auth/signout`: UCL email-code sign-in.
- `POST /api/community/action`: review, post, thread, reply, vote or report.
- `POST /api/community/upload`: protected image upload.
- `GET /api/community/account/export`, `DELETE /api/community/account`: account portability/deletion.
- `GET/POST /api/community/moderation`: protected exception and report queue.
- `POST /api/assist`: search, extract, locate, summary, or controlled event import.
- `/api/map/*`: server-only Google map session, tile and attribution proxy.

Every live mutation verifies identity and UCL membership server-side, checks origin, validates input and applies persistent rate limits. Reviews are unique per account/place. Public records never expose contributor emails or owner IDs.

## Checks

```sh
npx tsc --noEmit
npm test
npm run build
```

Tests cover validation, verification constraints, database uniqueness/privacy, image metadata handling, external adapters, fail-closed moderation, source restrictions, map attribution and demo data integrity. Paid-provider end-to-end checks need real runtime secrets. No API credentials are included.

## Before inviting students

Configure and verify the live services, set operator contact and retention policies, confirm event-source permission, and review the privacy/food-safety/community notices for the actual launch. The first hosted build is private. Changing its audience is a separate deliberate action.

## Credits

Image licences are listed in `lib/data.ts` and in the app's How it works dialog. Building data is © OpenStreetMap contributors under ODbL 1.0; details and source references are included in `public/data/campus-buildings.geojson`.
