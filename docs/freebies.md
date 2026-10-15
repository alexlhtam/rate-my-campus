# Union events and society freebies

The moderator’s **Import next 14 days** button reads the live public Students’ Union UCL calendar and opens every event listing. Claude extracts event details and checks every listing for freebies. A valid event with no identified freebie publishes as **event**; an explicit offer publishes as **freebie**. Both remain distinct layers and use the same importer, source identity, moderation and freshness rules. Free admission alone, things for sale, discounts, borrowed equipment and raffle prizes do not qualify as freebies. Explicit items included with a paid ticket can qualify, with the price shown.

Clear, source-backed events pass Claude moderation and publish automatically. Unclear offered-item prices or flagged content stay in the existing moderation queue for **Approve** or **Reject**. Provider failures remain failed, never implicit approval or a negative finding. Missing extraction or withdrawn source evidence does not create an event. Reports and moderator hiding continue to use the existing community system.

## Alex’s deployment checklist

1. On a new database, apply **supabase/migrations/20261014000000_freebie_radar.sql** after the existing community migrations. It adds private scan/checkpoint/venue tables, source occurrence metadata, and nullable coordinates for unlocated imports. Ordinary student posts still require a confirmed location. It is already applied to the hosted project identified below.
2. Set **ANTHROPIC_API_KEY** and a supported **ANTHROPIC_MODEL** (default claude-sonnet-4-6). **FREEBIE_CLAUDE_MODEL** optionally overrides it. Keys remain on the server.
3. Set a random **CRON_SECRET** of at least 32 characters and **FREEBIE_WORKER_URL=https://YOUR-DEPLOYMENT/api/freebies/worker**. The URL must refer to this environment, be reachable by the server, and must not redirect. Preview protection must permit the callback; leave imports disabled in previews that share production credentials.
4. Add the moderator’s Supabase Auth user ID to **ADMIN_USER_IDS**. Existing UCL sign-in is unchanged.
5. Confirm permission for this use under the Union’s [website terms](https://studentsunionucl.org/website-terms-and-conditions), then set **UNION_IMPORT_ENABLED=true**. Clause 7 reserves storage and reproduction beyond private browsing without express permission. The public feed is a technical source, not a reuse licence. The shorter `/terms-and-conditions` page does not contain the relevant website terms.
6. Google Places is optional: set **GOOGLE_MAPS_API_KEY** with Places API (New) and Map Tiles enabled. Without it, campus matches still work and other venues remain **Location TBC**.
7. Deploy after review. In the live activity view, a moderator opens the Union import tool, presses **Import next 14 days**, and watches the publication and failure counts. Check an ordinary event, a freebie, a source link, a pending decision, a known campus venue, and an unlocated event.

The frontend demo remains explicitly synthetic and separate. Imported events appear in **live activity**, not in the demo. No real import is performed by builds or tests. This extension adds no schema migration: the existing radar migration already stores event metadata, and `posts.type` is text. Apply that existing migration if it is missing from the deployment.

As of 15 October 2026, the existing radar schema has been applied to the configured hosted database. Verification found no scans, tasks or event posts yet. This confirms database readiness only; no source import or provider calls were performed, and live end-to-end publication has not been verified.

## Source and API contract

The importer uses the anonymous JSON source behind the [Union calendar](https://studentsunionucl.org/whats-on): `/json/anon/whats-on/{startUnixSeconds}/{endUnixSeconds}/list/{zeroBasedPage}`. It follows pagination until an actually empty page, filters the date interval locally and deduplicates ticket variants. A short page is not the last page. The Union [documents that ticket times can create separate calendar occurrences](https://studentsunionucl.org/how-to/website/manage-events-with-many-time-slots-entry-times).

The feed supplies title, occurrence dates, venue labels, organising groups and an online flag, but no coordinates and no complete description. The importer reads each event's public article and separate booking block for the remaining facts. It retains source organiser and explicit online metadata; unknown or ambiguous venues stay unlocated. The reviewed [robots file](https://studentsunionucl.org/robots.txt) does not disallow the calendar JSON or event paths, but does disallow `/sites/default/files/`; this importer does not fetch those image files. Requests stay on the Union host and do not sign in or crawl external ticket sites.

The existing `/api/freebies/*` paths and `freebie` metadata property are retained for compatibility. `GET /api/freebies/feed` returns approved `event` and `freebie` records ending after now and starting before London midnight fourteen dates after today. `?type=event` and `?type=freebie` select one category. Pagination remains 50 records per response with `nextOffset`. Source links, last-check times, unknown locations and the latest scan status remain visible; an incomplete scan is not complete event coverage.

The research check on 15 October 2026 verified one live feed page and one public event page. It did not run or publish a full two-week import. A source-backed snapshot requires a completed, authorised import; there is no bundled claim that these listings have already been loaded.

## Background operation

The import starts a Next.js after() worker; the HTTP response returns immediately. Each stage (page fetch, Claude extraction, publication) is persisted before advancing. A bounded worker processes batches of three, then sends an authenticated continuation to **/api/freebies/worker**. Closing the browser does not pause it.

Database leases prevent overlapping workers, expire after a crash, and are released with a token check. Transient provider requests have bounded retries. A failed import automatically retries its saved failed stages twice without redoing successful stages. Invalid credentials and repeated failures stop visibly; fix the configuration and use **Import next 14 days** to resume an active scan. New calendar reads are limited to one start per hour; active imports resume without another discovery.

This is a resumable worker, not a hosted durable queue. A hard process termination or failure to deliver all three continuation attempts can stop the chain. Saved work remains intact. The Import button recovers it; for unattended recovery register an authenticated **POST** to **/api/freebies/worker** every five minutes. Recovery never starts a new date window. Logs intentionally omit source bodies, keys and auth headers.

The route requests 300 seconds of function duration, using a 65-second launch budget so the last bounded provider stage can finish. Enable Vercel Fluid Compute, or use an equivalent runtime supporting that duration. See [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).

## Optional daily import — off until enabled

There is no active schedule in vercel.json. After Friday:

1. Set **FREEBIE_DAILY_IMPORT_ENABLED=true** alongside the normal import settings.
2. Register a daily authenticated GET or POST to **https://YOUR-DEPLOYMENT/api/freebies/daily**, with the header **Authorization: Bearer YOUR_CRON_SECRET**. Duplicate calls on the same London calendar date do not start another window.
3. For Vercel Cron, add this entry to your deployment configuration:

    {
      "crons": [
        { "path": "/api/freebies/daily", "schedule": "0 5 * * *" }
      ]
    }

Vercel supplies CRON_SECRET as the bearer header. Schedules use UTC. Hobby supports daily schedules; more frequent recovery needs an external scheduler or a plan supporting it. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Turning the daily flag off stops scheduled new imports; turning UNION_IMPORT_ENABLED off stops all subsequent batches. Scheduled imports require both the flag and registered schedule.

## Locations, freshness and cost

- Campus names and aliases are tried first. Room labels map to an existing building point, not an invented entrance. North Cloisters / Housman Room aliases use [UCL’s location page](https://www.ucl.ac.uk/staff-common-room/how-find-us).
- Only a unique name-matched London Google result is accepted. Ambiguous, online, TBC and unmatched venues remain in the list without a map pin. Moderators can confirm an existing campus building; that correction survives later imports until the source changes venue.
- Google coordinates are cached for at most 30 days; IDs can be retained. Unknown results are cached for one day. Simultaneous identical lookups share a request. Names, addresses, photos and reviews from Google are not persisted. Results requiring additional third-party attribution stay unlocated.
- Google positions render only while the map uses Google tiles. The OpenStreetMap fallback hides those pins. Public serializers suppress expired Google positions; worker housekeeping removes stored coordinates. If Google fallback is enabled, register the recovery worker at least daily so removal runs even between imports. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [cache terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
- Identity is the Union product plus occurrence start time, so ticket variants and end-time edits update one pin. Different recurrence dates retain distinct pins. A changed start time is a new occurrence; the older pin expires at its original end. A validated change between event and freebie updates that same record. An explicit source withdrawal hides its prior pin. Moderator decisions are preserved during rescans and concurrent AI calls. A removed listing is not inferred from an incomplete feed; existing records still expire at their saved end time.
- The scan covers London today through the next 13 days, including events already running. Pin expiry is the event end, capped at the end of that fourteen-date London window; source event end remains separate metadata for display. Missing or invalid end times remain a visible processing failure rather than receiving an invented duration. Student posts retain seven days and leftover food alerts six hours. The separate single-listing moderator form also accepts fourteen days.
- **2 weeks** is the default time filter. Now includes running events; This week ends at Monday midnight London time; 2 weeks includes fourteen calendar days. London’s daylight-saving transition is tested. Ordinary events use blue and freebies use purple, with upcoming start times labelled. Freebie item evidence appears only for source-backed offers. Ended pins disappear without a refresh.
- Society and dietary details require source quotes. Missing details are labelled. A dietary tag is not an allergen or food-safety guarantee.
- Raw source page checkpoints on completed/rejected events are cleared in bounded housekeeping after 30 days. Unresolved audit evidence stays private behind moderator authentication and RLS. CSV exports neutralise spreadsheet formulas.

The legacy Jev settings and provider code remain compatible with old checkpoints, but **FREEBIE_JEV_SCREENING** no longer skips listings in this importer. A low freebie score cannot exclude an ordinary event or replace complete event extraction. Claude checks every listing, including a resumed task with a saved low Jev score. The maintenance `recheck` action also requeues old `no_freebies` tasks. [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create).

## Validation

On **15 October 2026**, the existing radar SQL was applied to Supabase project **rate-my-campus** (`kcdyluxuibvugqararbg`). Supabase recorded the application as **20261015151507 / freebie_radar**; the repository retains the previously merged filename **20261014000000_freebie_radar.sql**. These identify the same SQL. Do not apply it twice; account for this version mapping before any CLI migration-history reconciliation.

Post-migration checks confirmed all four radar tables, all four source columns, nullable coordinates, and valid occurrence/manual-source/queue indexes. All **16 public tables** have RLS enabled with no client policies, intentionally keeping access behind the application server. The [rollback SQL smoke check](../scripts/verify-union-events.sql) passed against the hosted database: ordinary-event/freebie metadata, unknown locations, occurrence uniqueness, manual-source deduplication, fourteen-day feed boundaries, client-role isolation, and zero retained fixtures. Scans, tasks, posts and venue caches remained empty; only the worker control row exists. No real import or paid provider call was performed.

This verifies the database contract, not live authentication, application deployment, source-import permissions or Claude/Google configuration. The security advisor's existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains unchanged; enabling that Auth setting is separate from this migration.

**npm test** includes the old radar’s calendar/parser and provider fixtures plus PostgreSQL migration/publication tests, lease/retry tests, time-window tests and authenticated route tests. They mock all external source/provider calls and use an in-process database. Also run **npx tsc --noEmit --incremental false** and **npm run build**. Tests neither scrape live events nor spend API credit.
