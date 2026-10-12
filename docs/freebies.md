# Society freebies

The moderator’s **Import next 14 days** button reads the live public Students’ Union UCL calendar and opens every event listing. By default Claude checks every event. Free admission alone, things for sale, discounts, borrowed equipment and raffle prizes do not qualify. Explicit items included with a paid ticket can qualify, with the price shown.

Clear, source-backed findings pass Claude moderation and publish automatically. Unclear item prices or flagged content stay in the existing moderation queue for **Approve** or **Reject**. Provider failures remain failed, never implicit approval or a negative finding. Reports and moderator hiding continue to use the existing community system.

## Alex’s deployment checklist

1. Apply **supabase/migrations/20261014000000_freebie_radar.sql** after the existing community migrations. It adds private scan/checkpoint/venue tables, source occurrence metadata, and nullable coordinates for unlocated imports. Ordinary student posts still require a confirmed location.
2. Set **ANTHROPIC_API_KEY** and a supported **ANTHROPIC_MODEL** (default claude-sonnet-4-6). **FREEBIE_CLAUDE_MODEL** optionally overrides it. Keys remain on the server.
3. Set a random **CRON_SECRET** of at least 32 characters and **FREEBIE_WORKER_URL=https://YOUR-DEPLOYMENT/api/freebies/worker**. The URL must refer to this environment, be reachable by the server, and must not redirect. Preview protection must permit the callback; leave imports disabled in previews that share production credentials.
4. Add the moderator’s Supabase Auth user ID to **ADMIN_USER_IDS**. Existing UCL sign-in is unchanged.
5. Check the Union’s [terms](https://studentsunionucl.org/terms-and-conditions) and permission for this use, then set **UNION_IMPORT_ENABLED=true**.
6. Google Places is optional: set **GOOGLE_MAPS_API_KEY** with Places API (New) and Map Tiles enabled. Without it, campus matches still work and other venues remain **Location TBC**.
7. Deploy after review. In the live activity view, a moderator opens **Import society freebies**, presses **Import next 14 days**, and watches the published/held/skipped/failed counts. Check a source link, a pending decision, a known campus venue, and an unlocated event.

The frontend demo remains explicitly synthetic and separate. Imported events appear in **live activity**, not in the demo. No real import is performed by builds or tests.

## Background operation

The import starts a Next.js after() worker; the HTTP response returns immediately. Each stage (page fetch, optional Jev screen, Claude extraction, publication) is persisted before advancing. A bounded worker processes batches of three, then sends an authenticated continuation to **/api/freebies/worker**. Closing the browser does not pause it.

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
- Only a unique name-matched London Google result is accepted. Ambiguous, online, TBC and unmatched venues remain in the list without a map pin. Moderators can confirm an existing campus building; that correction survives later imports.
- Google coordinates are cached for at most 30 days; IDs can be retained. Unknown results are cached for one day. Simultaneous identical lookups share a request. Names, addresses, photos and reviews from Google are not persisted. Results requiring additional third-party attribution stay unlocated.
- Google positions render only while the map uses Google tiles. The OpenStreetMap fallback hides those pins. Public serializers suppress expired Google positions; worker housekeeping removes stored coordinates. If Google fallback is enabled, register the recovery worker at least daily so removal runs even between imports. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [cache terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
- Identity is the Union product plus occurrence start time, so ticket variants and end-time edits update one pin. Different recurrence dates retain distinct pins. A changed start time is a new occurrence; the older pin expires at its original end. Source withdrawal hides its prior pin. Moderator decisions are preserved during rescans and concurrent AI calls.
- The scan covers London today through the next 13 days, including events already running. Pin expiry is the event end, capped at 14 days from publication. Student posts retain seven days and leftover food alerts six hours. The separate single-listing moderator form also accepts fourteen days.
- Today is the default time filter. Now includes running events; This week ends at Monday midnight London time; 2 weeks includes fourteen calendar days. London’s daylight-saving transition is tested. Upcoming pins are faded and labelled with their start time; ended pins disappear without a refresh.
- Society and dietary details require source quotes. Missing details are labelled. A dietary tag is not an allergen or food-safety guarantee.
- Raw source page checkpoints on completed/rejected events are cleared in bounded housekeeping after 30 days. Unresolved audit evidence stays private behind moderator authentication and RLS. CSV exports neutralise spreadsheet formulas.

Optional **FREEBIE_JEV_SCREENING=true** uses the old radar’s Jev candidate screen (JEV_API_KEY, JEV_MODEL, JEV_THRESHOLD). It can reduce Claude calls but might exclude a real offer. It is off by default so Claude checks every event. [Jev API](https://docs.typesafe.ai/api), [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create).

## Validation

**npm test** includes the old radar’s calendar/parser and provider fixtures plus PostgreSQL migration/publication tests, lease/retry tests, time-window tests and authenticated route tests. They mock all external source/provider calls and use an in-process database. Also run **npx tsc --noEmit --incremental false** and **npm run build**. Tests neither scrape live events nor spend API credit.
