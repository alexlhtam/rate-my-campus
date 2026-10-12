# Leftover food: product and operations handoff

This feature adds a dedicated food feed, a three-step composer, pickup detail pages, owner controls and community availability feedback. It uses the existing Supabase accounts/database/storage and Claude integration. The hosted food database migration was completed on 12 October 2026 for `rate-my-campus` (`kcdyluxuibvugqararbg`). Alex's application credentials and deployment ownership remain unchanged; the migration does not establish that the deployed application or external providers work end to end.

## Student flow

Open **Food** or **Leftover food** to browse currently available pickups. Search by food or location, filter by the sharer's dietary claim, distance or a collection deadline within ten minutes, and sort by nearest or ending soonest. Distances are straight lines from the selected origin. Filters and sorting operate on loaded alerts; **Load more** retrieves additional pages. **Show food on map** opens the food layer. Each detail page includes pickup instructions, access, reported quantity, ingredient/allergen information, last owner update, recent availability feedback, directions, a share link/QR code and reporting.

Collection is first come, first served. There are no reservations, claims, allocations, payment, delivery, waiting lists or guaranteed portions. Tapping **Still here** is feedback, not a booking. An organisation name is supplied by the poster; the app does not verify a society role.

The composer has three steps:

1. Describe the food and optionally add a JPEG/PNG/WebP photo of up to 5 MB. The client resizes photos and removes camera metadata. A live signed-in account can request a Claude draft; manual entry is always available.
2. Confirm title, description, pickup instructions, an optional estimated quantity, optional society/event name, access/container requirements and only food information the sharer can support. Unknown allergens remain explicit.
3. Choose a known campus location or find a public place, inspect/adjust the map point and confirm both location and the sharing notice. The map point does not verify an entrance. Choose a collection window of at most six hours, or confirm a valid extracted deadline. Food must be available now; future events belong in the separate event flow.

A live submission uploads any prepared photo and submits the confirmed fields for automatic content moderation. Approved submissions become public; flagged or unavailable checks leave them private and show the owner the moderation state. Publication approval is not a food-safety assessment. **Manage my food** opens the owner's food contributions, including pending and closed pickups.

## Feed and refresh contract

`GET /api/community/food?offset=0` is a public read returning `{posts,total,nextOffset}` with private/no-store caching. Pages contain up to 40 records, ordered by creation time and ID descending. Only food that is approved, started, unexpired, not closed and has a positive or unknown quantity is returned. `total` counts matching live records before client-side food filters. Public records include `own` for the current account, `revision`, `foodDetails`, `collectionInstructions`, `portionsRemaining`, `availabilityUpdatedAt`, `freshStillCount`, `freshGoneCount`, `lastAvailabilityFeedbackAt`, `closedAt` and `closureReason`; they omit the owner's account ID and email.

The live client polls every 15 seconds while the page is visible, refreshes when visibility returns and offers a manual refresh. Countdown display advances locally every second and hides expired pickups even between polls. This is polling, not a push or WebSocket feed. Network failure retains the last received alerts and shows a warning in the food hub; displayed quantity can change before someone arrives. The map's main community state also refreshes independently. Do not promise immediate updates on another person's device.

`GET /api/community/pin?id=...` opens a shared approved alert independently of the feed page limit. A closed/expired approved alert can still explain that collection ended; expired photo references are omitted. Pending/hidden content is available to its owner through account state/contributions, not this public lookup. Sharing preserves explicit `demo` or `live` mode.

## Posting and lifecycle API

Mutations use same-origin JSON requests to `POST /api/community/action` and the existing signed-in UCL account. Creation uses `action:"post", type:"food"`, the confirmed location and coordinates, title/description, dietary claims, `expiresAt`, optional `photoKey`, `collectionInstructions`, `portionsRemaining`, `foodDetails`, `locationConfirmed:true` and `foodSafetyAcknowledged:true`. The collection deadline must be in the future and at most six hours away; a future `startsAt` is rejected. Collection instructions need 5–500 characters. Initial portions are an integer 1–10,000 or `null`. A photo is optional and, when present, must be the account's own recent upload. Active item/location and photo duplicate checks apply.

| Action and body | Result |
| --- | --- |
| `food-availability`, `targetId`, `revision`, `portionsRemaining` | Owner confirms a new estimate now; `null` means unknown, integer 0–10,000 is allowed. Only an approved, active pickup can change. A successful update increments the revision and advances the availability timestamp. |
| `update-post`, `targetId`, `revision`, `collectionInstructions`, optional `portionsRemaining`, `foodDetails` | Owner edits pickup/food details. Text and an attached photo are checked again before the replacement becomes public. A changed revision, closed pickup or hidden content prevents the write. This does not extend the deadline or change the map location/title/dietary tags. |
| `close-post`, `targetId`, `reason` | Owner closes a pickup, including a pending one. Reasons are `collected`, `ended`, or `withdrawn`; omission defaults to `ended`. Closing is idempotent and does not require a revision. |
| `vote`, `targetId`, `kind:"still"` or `"gone"` | Another signed-in account reports what they found at a currently available pickup. The owner uses availability controls instead. |
| `report`, `targetId`, `reason` | Sends a private content/safety report through the existing moderation flow; separate from availability feedback. |
| `delete-own`, `targetId`, `kind:"post"` | Owner permanently removes the contribution through the existing deletion flow. |

Owner management uses the existing 30-actions-per-hour quota. An owner must send the latest `revision` from the returned post for quantity/details updates. The database checks it again atomically; a stale update returns 409 and cannot overwrite a newer count, closure or moderation decision. Reopen the detail/editor with fresh data before retrying. Quantity-only confirmation does not run Claude because it adds no free text. Text/food-information edits do. Neither operation reopens an ended pickup or extends its original collection deadline.

Zero portions automatically closes the pickup as `collected`. Explicit `collected` closure also sets zero; `ended` and `withdrawn` retain the last estimate but mark collection closed. Every closure records `closedAt`, moves the deadline to no later than now and removes the pickup from the active feed/map. A new batch requires a new alert. An expiry reached naturally is unavailable without needing a background close job.

Availability feedback is limited to one current vote per account/pickup; voting again replaces that account's previous vote and timestamp. Counts use only non-owner reports from the last 30 minutes **and after the most recent owner availability update**. At least three distinct eligible `gone` reports, exceeding eligible `still` reports, close the pickup immediately with `closureReason:"community-gone"`. Thirty minutes is the freshness window, not a delay before closing. Owner confirmation clears older votes from the displayed fresh counts without pretending to delete historical records. Ageing votes or later feedback cannot reopen a closed pickup. The vote/closure transaction locks the pickup against concurrent owner updates. Existing content-report rules can also hide a pickup pending review.

## Private demo

Demo samples are visibly fictional. New demo food alerts, photos, owner edits and feedback are saved only in this browser; they do not call live upload/post/moderation/feedback endpoints. Claude extraction is disabled in the food demo. Browser storage being blocked or full limits persistence to the current session and produces a notice. Demo and live links carry different modes, and local food records are excluded from the live feed.

The demo uses the same field/expiry/revision validation helpers for the manual lifecycle. It records one local viewer's availability feedback rather than simulating multiple independent students. **Restart sample food alerts** resets sample countdowns; it does not revive a real pickup or another person's post. The demo is a product walkthrough, not evidence of a tested live deployment.

## What the draft means

Claude helps transcribe a message or a legible label into an editable food draft. It does not certify food safety, verify the sharer, count food in a photo, or publish anything. People must confirm the pickup point, collection deadline, instructions and all reported food information before submitting a post. An account uses the application's existing UCL email-domain account rules; this is not a check of a society committee role or mailbox ownership.

`expiresAt` is the collection deadline. It is not a use-by date and the app must not describe an active countdown as evidence that food is safe. Allergen, ingredient, dietary and handling details are claims supplied by the sharer or read from their label, not independently checked facts. Unknown allergen information means unknown, never allergen-free. A vegan claim does not establish absence of milk or other allergens.

Suggested concise UI copy:

- “Allergen information is reported by the sharer. Unknown does not mean allergen-free. Ask the organiser and check the label before collecting.”
- “This countdown is a collection deadline. Check use-by dates, storage and handling with the sharer.”
- “Keep ingredient labels available, handle and store food safely, and only share information you can confirm.”
- On extraction: “Check the draft against your message or label. Photos cannot establish food safety.”

## Official guidance checked 12 October 2026

The Food Standards Agency guidance is now published on GOV.UK; the old `food.gov.uk` advice pages redirect there.

- [FSA: food safety for community cooking and food banks](https://www.gov.uk/government/publications/food-safety-for-community-cooking-and-food-banks/food-safety-for-community-cooking-and-food-banks). Explains safe storage, transport, ingredient communication and checking donated food with its provider. Registration requirements depend on the activity; occasional provision may not require registration. Organisers should check with their local authority food safety team. The app must not claim that every occasional sharer has the same legal labelling duties as a registered food business.
- [FSA: providing food at community and charity events](https://www.gov.uk/government/publications/providing-food-at-community-and-charity-events/providing-food-at-community-and-charity-events). Covers hygiene for community events, including cleaning, chilling, cooking and avoiding cross-contamination. Links to this practical guidance belong beside the posting form; automated approval is content moderation, not a food hygiene inspection.
- [FSA: student guide to food safety and hygiene](https://www.gov.uk/government/publications/student-guide-to-food-safety-and-hygiene/student-guide-to-food-safety-and-hygiene). Explains the distinction between use-by dates, which concern safety, and best-before dates, which concern quality. Food appearance or smell cannot establish safety after a use-by date.
- [FSA: food allergen labelling and information requirements](https://www.gov.uk/government/publications/food-allergen-labelling-and-information-requirements-technical-guidance/food-allergen-labelling-and-information-requirements-technical-guidance). Describes the 14 regulated allergens and the distinction between a vegan label and a free-from claim. The app's selected allergen list is not an exhaustive list of everything that could cause an individual reaction.

These sources support the guidance above; the countdown and conservative AI defaults are application design decisions, not an FSA approval of the service.

## Draft API

`POST /api/assist` with a same-origin JSON request and the current signed-in UCL account session:

```json
{
  "action": "extract-food",
  "text": "Your original message, including any stated collection details",
  "image": { "mediaType": "image/jpeg", "data": "BASE64_IMAGE_BYTES" }
}
```

At least a nonblank `text` or an image is required. The example image value is a placeholder; send actual base64 bytes without a data URL prefix. Text is limited to 8,000 characters. Optional images accept JPEG, PNG, WebP or GIF with at most 2,800,000 base64 characters (approximately 2.1 MB decoded); the full request is limited to 3,000,000 bytes. Image compression belongs on the client. The existing shared assist quota is 30 requests per account per hour, stored in Postgres. Extraction uses the same origin, account and quota checks as the existing extraction service.

Successful response: `{ "provider": "anthropic", "pin": { ... } }`, with `Cache-Control: no-store`. The pin contains:

| Field | Contract |
| --- | --- |
| `layer` | Always `food` |
| `title`, `description` | At most 100 / 1,500 characters; no facts inferred from appearance |
| `location` | Stated location or `null`; no generated coordinates |
| `startsAt`, `expiresAt` | Explicit ISO 8601 collection times or `null`; relative times interpreted in Europe/London |
| `dietary` | Explicit claims only: vegetarian, vegan, halal, gluten-free, dairy-free |
| `portionsRemaining` | Explicit integer 1–10,000 or `null`; pictured items are never counted |
| `collectionInstructions` | Stated instructions, at most 500 characters, or `null` |
| `foodDetails` | Shape below |
| `confidence` | `high`, `medium` or `low`, describing extraction confidence only |
| `warnings` | Up to ten short confirmation messages, including missing pickup location, deadline and instructions |
| `requiresConfirmation` | Always `true` |

Default `foodDetails`:

```json
{
  "allergenStatus": "unknown",
  "allergens": [],
  "ingredients": "",
  "handling": "",
  "sourceLabel": "",
  "pickupAccess": "ask",
  "bringContainer": false
}
```

For Claude extraction, `allergenStatus: "provided"` requires one or more explicitly reported allergens; otherwise it remains unknown even when ingredient text is transcribed. In the manual composer, a sharer can instead provide an ingredient list without selecting any of the 14 allergens. Neither case establishes absence of other allergens. IDs come from `lib/food.ts`: `celery`, `cereals-gluten`, `crustaceans`, `eggs`, `fish`, `lupin`, `milk`, `molluscs`, `mustard`, `peanuts`, `sesame`, `soybeans`, `sulphites`, `tree-nuts`. Missing allergens are not evidence of their absence. Ingredient text is limited to 500 characters, handling to 300, and the public organisation/event label to 100. Access is `ucl`, `public` or `ask`; lack of an explicit access statement defaults to `ask`. An absent container request defaults to `false`, not a promise that containers are supplied.

Internally the model must provide source quotes for factual fields. Text quotes are checked against the supplied message; unsupported values are discarded. A photo's quoted label cannot be verified by this program and must be checked by the user. The schema rejects unsupported allergen IDs, invalid quantities, unexpected coordinates and extra fields. Conflicting collection times leave the deadline blank. These checks reduce unsupported completion; they do not make model transcription infallible.

The generic `action: "extract"` contract remains available for deals/freebies. Food posting should use this dedicated action. The draft endpoint does not upload a photo to storage, create a community post, moderate a published submission, reserve food, or send notifications. The confirmation form handles the separate upload and community submission flows.

## Server configuration and failure behavior

The hosted `rate-my-campus` Supabase project (`kcdyluxuibvugqararbg`) recorded the food migration as version `20261012171306` on 12 October 2026. The repository file is `supabase/migrations/20261012171306_leftover_food.sql`, renamed to match that actual hosted history; its SQL is the existing food migration. Prerequisites `20261012000000_community.sql` and `20261012010000_community_tools.sql` were already applied. No further application of the food migration is required on this project. Do not run the obsolete `20261013000000` version or reapply the same SQL.

Hosted checks confirmed the four post columns (`food_details`, `closure_reason`, `closed_at`, `availability_updated_at`), the closure-reason check constraint, and both valid indexes (`posts_live_food`, `votes_recent_availability`). The `photos` bucket is private and permits JPEG, PNG and WebP with a 5 MiB limit. All 12 public-schema application tables have RLS enabled and no client Data API policies, matching the existing server-only data access model. Server routes still enforce account/ownership checks over their database connection. A fresh environment should apply the three recorded migrations in order; this completed project should not repeat them.

The [hosted SQL check](../scripts/verify-food-backend.sql) passed against this project: feed/metadata, ownership and revision checks, fresh distinct-account feedback, closure quorum, idempotent closure and client-role isolation. All synthetic fixtures were rolled back; zero remained. For reproduction, execute the whole script in one transaction, not selected fragments.

Advisors reported informational RLS-without-policy and unused-index findings; those do not call for adding public policies or removing the new feed indexes. The existing Auth warning for disabled leaked-password protection remains. The available Supabase tool cannot change Auth configuration, and this work made no unrelated Auth change. See [Supabase password protection settings](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) for the deployment owner's configuration options.

Keep Alex's existing Supabase Auth, Postgres connection and photo storage configuration. Use the existing private server variables `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`) and optional `ANTHROPIC_WORKSPACE_ID`. They must never be browser variables or committed to Git. Food extraction needs no extra provider key, and it does not call location services. Optional Google matching/maps use the existing server configuration; known campus/manual placement remains available. No live application keys were available locally for this handoff, and this work does not change or activate Alex's runtime settings.

Text and optional image are sent to the configured Claude API when extraction is requested. Live post text and photos are also sent for automated moderation on creation and relevant edits; quantity-only updates do not send a new Claude request. Do not describe live extraction/moderation as on-device or offline processing. The extraction module does not log or persist its input. The separate posting flow stores confirmed fields and uploaded photos using the existing community retention rules. See [community operations](COMMUNITY-OPERATIONS.md) for moderation retries, report holds, expired alert/photo cleanup and operator responsibilities. No provider retention or training policy is asserted here.

The route returns 400 for invalid input, 401/403 for account or origin failures, 413 for excessive request size, 415 for an unsupported content type, and 429 for quota or provider throttling. Missing Claude configuration returns 503. Invalid/truncated provider output or upstream failure returns 502; a request failure/timeout returns 504. Upstream response bodies and keys are not returned to the client. Failure leaves manual entry available; no invented draft or post is substituted.

## Validation and release status

The final repository suite passes **194/194 tests after Campus Toolkit removal**, and the production build passes. Checks include extraction defaults, invalid inputs/provider failures, account/quota routing, PGlite-backed lifecycle/concurrency and feed pagination. External providers are mocked in automated tests.

The hosted migration, structural/storage-setting checks and rollback-only [lifecycle SQL check](../scripts/verify-food-backend.sql) are complete. These do not verify app authentication, Claude extraction/moderation, Google services, actual photo upload, real food publication or deployment; no live app credentials were available locally. Those flows still need a controlled check using the existing live configuration.

Earlier local demo browser checks covered manual posting, keyboard map adjustment, quantity/detail edits surviving reload, closure, feedback and mobile filtering. The refreshed production preview confirms Toolkit navigation is absent and place sharing and QR generation still work. Food/place sharing links and QR codes remain; Campus Toolkit's comparison, collections, timetable and study-resource modal has been removed.
