# Campus incidents: product and operations handoff

Campus incidents are short-lived, student-reported safety heads-ups: a fight, a chemical spill, a fire alarm, a medical emergency, a security incident, a protest or a disruption. Students nearby corroborate a report (“I can see this too”) or clear it (“It’s over”). Reports expire on their own, the reporter can end them, a clear quorum ends them, abuse flags hide them and moderators can hide them. The feature reuses the existing Supabase accounts, Postgres database, private photo storage, Claude moderation and the moderator queue.

The design register is deliberately different from the rest of the app: black ground, signal red, hazard tape, pulsing pins for urgent reports. Everything is scoped to incident surfaces in `components/incidents.css`.

## What this is not

This is not a way to call for help, and the UI says so on every incident surface. Every hub, composer and urgent detail view shows the emergency strip: **999**, **UCL Security Bloomsbury 020 7679 2222 (ext. 222)** and **UCL East 0208 016 0555**, with a link to [UCL’s emergency contacts page](https://www.ucl.ac.uk/students/support-and-wellbeing-services/emergency-contacts), checked on 15 October 2026. The composer cannot proceed until the reporter confirms they understand the report alerts nobody and that they have already called for help if someone is in danger. Reports are student accounts in the moment; the app never describes them as verified, and corroboration counts other students, not officials.

## Student flow

**Alerts** in the main navigation (with a live count) and **Incidents** in the explore toolbar open the incident hub. A red banner above the results list appears whenever at least one live incident exists. The map has an **Incidents** layer: red pins, pulsing for urgent reports, dark for heads-ups. Incident cards appear in the main results list alongside places and alerts.

The hub shows live reports sorted urgent first, then most corroborated, then newest, with search, type chips and a severity filter. Below are the viewer’s own reports awaiting moderation and a **Recently cleared** list from the last three hours. The hub polls every 15 seconds while visible; a failed refresh keeps the last good list and shows a warning.

Reporting is two steps. Step one: the emergency strip, the acknowledgement checkbox and the incident type. Step two: severity (Heads-up, Caution, Urgent; defaulted from the type), a headline (4–90 characters), optional details (up to 1,200 characters), a location (campus place matching from the directory, then a draggable map confirm and a checkbox), how long to keep it live (30 minutes to 24 hours, default 2 hours) and an optional scene photo. Photos go through the existing browser resize and server metadata stripping. The copy repeats on every step: describe what is happening, never who.

The detail dialog shows severity and type badges, the live countdown, the description, the photo, the location with directions, a corroboration bar and the two response buttons. Reporters see **Mark as over** and **Delete report**; everyone sees **Flag this report** and a share link. Urgent live incidents repeat the compact emergency strip.

## Lifecycle rules

| Rule | Behaviour |
| --- | --- |
| Publication | Text is checked by Claude with the new `incident` moderation kind, which allows factual descriptions of what is happening at a public location and rejects content that identifies a private individual. An attached photo is checked too. Approved reports are public immediately; anything else stays private to the reporter with the moderation note. Transient provider failures join the durable retry queue (`moderation_retries.kind = 'incident'`). |
| Expiry | `expires_at` is at most 24 hours after creation. Expired reports leave the feed and map without a background job. |
| Duplicates | One live report per type within about 130 m. A second attempt returns 409 with `existingId`, and the composer offers to open the existing alert instead. |
| Responses | One current response per account per incident (`confirm` or `clear`), stored in the shared `votes` table; responding again replaces it. Reporters cannot respond to their own report. Only non-owner responses count. |
| Community clear | At least 3 `clear` responses that outnumber `confirm` responses end the report with `resolution = 'community'`. The vote and the quorum check run in one transaction with the incident row locked. |
| Reporter | `resolve` ends the report (`resolution = 'reporter'`, idempotent); `delete` removes it with its votes, reports and retries. |
| Flags | Flags use the shared `reports` table, one per account per incident. Three independent flags hide an approved report pending moderator review; the reporter sees why. |
| Moderators | Incidents appear in the moderation queue with kind `incident`, type and severity. Hiding an incident also records `resolution = 'moderator'` so a mistaken later approval cannot bring back a cleared alert. Approval re-runs the private-detail check. |
| Retention | Approved reports are deleted 30 days after expiry unless a flag is outstanding, 50 per hourly sweep. Attached photos are not treated as orphans while an incident references them. Account export includes incidents; account deletion removes them with their votes, flags and retries. |

## API

All routes live under `/api/incidents/` and return `Cache-Control: private, no-store`. Writes require a same-origin JSON request and a signed-in UCL account.

| Method and path | Purpose |
| --- | --- |
| `GET feed?offset=0` | Public. `{incidents, own, resolved, myVotes, total, nextOffset}`. `incidents` are live approved reports (60 per page). `own` are the caller’s pending or hidden reports. `resolved` are reports cleared within the last three hours. `myVotes` are the caller’s current responses. |
| `GET item?id=` | Public approved report, or the caller’s own report in any state. Expired photo references are omitted. |
| `POST create` | Body: `category`, `severity`, `title`, `description`, `location`, `lat`, `lng`, `expiresAt`, optional `photoKey` (the caller’s own upload from `/api/community/upload` within six days), `locationConfirmed: true`, `safetyAcknowledged: true`. 5 per account per hour. |
| `POST vote` | `{id, kind: "confirm" | "clear"}`. 60 per hour. Returns the updated report and a message; the message says when the quorum cleared it. |
| `POST resolve` | `{id}`. Reporter only. |
| `POST flag` | `{id, reason}`. Reason 4–500 characters. 10 per hour (shared with other reports). |
| `POST delete` | `{id}`. Reporter only. |

Public records carry `type: "incident"`, `category`, `severity`, `title`, `description`, `location`, `lat`, `lng`, `photoUrl`, `status`, `createdAt`, `expiresAt`, `resolvedAt`, `resolution`, `confirmCount`, `clearCount`, `revision` and `own`. They never include the reporter’s account ID or email. Categories: `violence`, `hazard`, `fire`, `medical`, `security`, `protest`, `disruption`, `other`. Severities: `notice`, `warning`, `urgent`.

## Private demo

Demo mode shows four clearly fictional sample alerts at verified campus positions, including one already cleared. Demo reports, responses and deletions stay in this browser under `rmc-incidents`; nothing is uploaded or moderated. A single local viewer is simulated: responding “it’s over” to a sample alert that already has two clears shows the quorum clearing it. Shared links carry `demo` or `live` mode as elsewhere.

## Database

`supabase/migrations/20261015000000_campus_incidents.sql` creates `public.incidents` with check constraints on category, severity, status and resolution, three indexes and row-level security with no client policies, matching the server-only data model. It widens the `moderation_retries.kind` check to accept `incident`. Apply it to the hosted project with `supabase db push` or by pasting it into the SQL editor; the test suite applies it to an in-process Postgres on every run.

## Validation

`tests/incidents-routes.test.mjs` drives the real route handler against PGlite: anonymous reads, origin checks, validation, duplicates, response replacement, the clear quorum, pending privacy, flag hiding, reporter controls and photo ownership. `tests/incidents-model.test.mjs` covers the shared model, server validation, the feed client and the demo state. `tests/community-tools.test.mjs` covers the shared-server integration: retry drain with photo re-check, queue listing, hide ending an incident, photo access, export and account deletion. The production build passes. No live credentials were available, so sign-in, real uploads, Claude verdicts and deployment remain to be checked with the existing live configuration.
