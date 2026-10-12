# Rate My Campus

A mobile-first UCL campus map with category-specific place reviews, society freebies, time-limited food alerts, student deals, anonymous community discussion and UCL email verification.

## Run locally

Requires Node.js 22.13 or newer. Install with `npm ci`, then use `npm run dev`. The Sites starter supplies local preview identity; this is not a real UCL verification. Live contributions still require a real email code.

The app uses Cloudflare D1 (`DB`) and R2 (`BUCKET`). Sites provisions these for the hosted build through `.openai/hosting.json`. Generate local Worker configuration with `npm run build`, then apply the two migration SQL files in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_melodic_human_robot.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_tan_matthew_murdock.sql
```

Do not replay already-applied migrations. Hosted publication applies production migrations separately.

## Live service configuration

Set production server environment secrets through Sites. Local development can use an ignored `.dev.vars` file with the names in `.env.example`. Never commit credentials.

- `ANTHROPIC_API_KEY`: Claude search, text/photo extraction, summaries and automatic moderation.
- `ANTHROPIC_MODEL`: optional, defaults to `claude-sonnet-4-6`.
- `GOOGLE_MAPS_API_KEY`: server key restricted to Google Map Tiles API and Places API (New). No browser key is used. Enable billing, quotas and alerts in Google Cloud.
- `RESEND_API_KEY` and `EMAIL_FROM`: email sending key and sender on a verified domain for UCL verification codes.
- `ADMIN_USER_IDS`: Sites account references for the exception/reports queue and event importer.
- `UNION_IMPORT_ENABLED=true`: enable only after confirming source permission and current terms.

Routine suitable submissions are published automatically after Claude checks them. Flagged content, uncertain results or an unavailable model stay private pending exception review. Photos are re-encoded in the browser and metadata is stripped on the server. Reports can trigger hiding pending review.

## Demo and real data

The demo includes 14 directory entries (13 real places and one explicitly fictional rental), 26 synthetic reviews, 6 illustrative alerts/deals and 8 sample threads. Demo contributions stay in browser storage and are separated from real ratings and public records. Switch to real activity to view only actual community content. No real reviews or Union events have been fabricated or seeded into D1.

When Google is disconnected, a clearly attributed OpenStreetMap map remains available. Campus building footprints are real OpenStreetMap polygons. Most heights are estimates from mapped floors or labelled illustrative defaults. The fixed-perspective extrusion is a visual aid, not an architectural survey or extracted Google 3D mesh.

The Union importer accepts a single public event URL, extracts explicit food/merch evidence with Claude, asks the operator to confirm time/location, credits the source and deduplicates it. Imports are limited to one per hour. No recurring crawler is running.

## Useful routes

- `GET /api/community/state`: public approved records plus own private pending records and own profile.
- `POST /api/community/auth/request`, `POST /api/community/auth/verify`: UCL email verification.
- `POST /api/community/action`: review, post, thread, reply, vote or report.
- `POST /api/community/upload`: protected image upload.
- `GET /api/community/account/export`, `DELETE /api/community/account`: account portability/deletion.
- `GET/POST /api/community/moderation`: protected exception and report queue.
- `POST /api/assist`: search, extract, locate, summary, or controlled event import.
- `/api/map/*`: server-only Google map session, tile and attribution proxy.

Every live mutation verifies identity and UCL membership server-side, checks origin, validates input and applies persistent rate limits. Reviews are unique per account/place. Public records never expose contributor emails or owner IDs.

## Checks

```sh
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
npm run build
```

Tests cover validation, verification constraints, database uniqueness/privacy, image metadata handling, external adapters, fail-closed moderation, source restrictions, map attribution and demo data integrity. Paid-provider end-to-end checks need real runtime secrets. No API credentials are included.

## Before inviting students

Configure and verify the live services, set operator contact and retention policies, confirm event-source permission, and review the privacy/food-safety/community notices for the actual launch. The first hosted build is private. Changing its audience is a separate deliberate action.

## Credits

Image licences are listed in `lib/data.ts` and in the app's How it works dialog. Building data is © OpenStreetMap contributors under ODbL 1.0; details and source references are included in `public/data/campus-buildings.geojson`.
