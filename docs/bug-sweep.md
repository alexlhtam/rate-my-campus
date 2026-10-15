# Bug sweep — 15 October 2026

This change is stacked on PR #14 (`feat/map-performance-events`). It fixes reproduced failures found while reviewing the map/explore UI, discussions, food pickups, event imports, account handling and moderation.

## Fixed behavior

- Keyboard activation of a bookmark no longer also opens its parent place card. Place cards support Enter and Space.
- Live/demo mode survives refresh and browser history even when no place is selected. Failed state refreshes show a retry action; older requests cannot overwrite a newer response.
- The event “Now” filter no longer changes the separate place/food “happening now” filter. Nearest sorting interleaves places and alerts by distance; the default keeps place ratings and orders events by time. The empty Saved view can return to Explore.
- Community teasers open the requested discussion, including a supplied approved thread beyond the first loaded page. Failed replies/follow preferences can retry. Stale summaries cannot replace a newly selected place's summary.
- Food updates preserve omitted collection details and quantities, permit valid pending demo edits, and reject missing availability quantities. An old pickup's response cannot close another pickup's editor. Live feedback uses accurate confirmation text.
- The Union importer resumes today's incomplete import and its saved checkpoints. Starting an import invalidates older panel requests. Online events cannot be assigned a physical venue; society search includes source organizer metadata.
- Imported London times preserve the original occurrence during the autumn clock change. New ambiguous times require a choice; invalid dates are rejected. Oversized single-event previews fail explicitly before paid extraction instead of silently truncating source text.
- Malformed Google Places coordinates produce a recoverable provider error before reaching the map.
- Auth identities are resolved against the current user record, so deleted accounts and changed non-UCL addresses cannot authorize new community requests. Logout/Auth deletion failures are reported instead of being presented as success; partial account deletion retains the session for retry.
- Contributions waiting for AI checks revalidate identity and the existing profile before writing. Replies also atomically verify and lock their approved parent discussion, preventing inserts into a deleted/hidden thread.
- Manual approval checks review terms, rental privacy context and imported event metadata. Pending/reported items take precedence over old hidden items in the moderation queue.

## Verification

The full Node suite passes **335 tests** (303 before this change). TypeScript and the production build pass. Regression tests use isolated database/provider mocks, including deletion during an AI wait, failed/retried requests, stale component responses, import recovery and London clock changes.

Browser checks on the production preview cover keyboard bookmarks, event filters, live-mode refresh, community teaser navigation, posting a private demo reply, and the 390 × 844 mobile layout.

## Limits of this verification

- The local environment lacks connected live Anthropic, Google and Supabase Auth/database credentials. Real email delivery, paid model/location calls and a production Union import have not been exercised. No production user data was changed, and this patch needs no database migration.
- Account deletion spans Storage, Postgres and Auth and is not an atomic transaction. The new guard covers deletion completed during the provider wait; full serialization of every possible concurrent write/deletion requires a durable account-lifecycle design. Remote sign-out alone does not promise immediate revocation of an already-issued token.
- The existing ESLint baseline is not clean (legacy `any`, hook and imperative-map diagnostics). This sweep does not disable rules or claim that lint passes. Runtime/build failures and reproduced user-facing behavior were the priority.
- Passing these checks is evidence for the covered flows, not a guarantee that every production configuration or device is bug-free.
