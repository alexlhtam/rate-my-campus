# Community tools and operations

The hosted `rate-my-campus` Supabase project (`kcdyluxuibvugqararbg`) already had `20261012000000_community.sql` and `20261012010000_community_tools.sql` applied. The tools migration adds private preferences, correction/takedown requests, photo hashes, collection details and the durable moderation retry queue. Server routes continue to use the existing authenticated database connection.

This change does not configure email, Supabase credentials, hosting, Claude credentials or Google services. Those remain deployment responsibilities.

The dedicated leftover-food migration was applied to that hosted project on 12 October 2026 as version `20261012171306`. The local file `supabase/migrations/20261012171306_leftover_food.sql` now matches the recorded history. The four post columns, closure-reason constraint and two valid feed/feedback indexes were verified. Do not reapply it or use the obsolete `20261013000000` version. New environments should apply the three recorded migrations in order. Food metadata, owner revision controls, fresh community availability rules and the private demo are documented in the [leftover-food handoff](LEFTOVER-FOOD.md).

All 12 public-schema application tables have RLS enabled without client policies intentionally: application authorization is handled by server routes, not direct client table access. The `photos` bucket was confirmed private, with a 5 MiB limit and JPEG/PNG/WebP types. Advisors reported informational RLS-without-policy and unused-index findings. The existing disabled leaked-password-protection warning remains; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The available tool cannot change Auth configuration, and this work leaves those settings unchanged.

The [rollback-only hosted SQL check](../scripts/verify-food-backend.sql) passed for feed/metadata, ownership/revision checks, fresh distinct-account feedback, quorum, idempotent closure and client-role isolation; zero synthetic fixtures remained. Execute the whole script in one transaction when reproducing it. The final repository suite passes 194/194 tests and the production build passes after Toolkit removal. These checks do not verify app sign-in, actual photo upload, Claude/Google calls or deployment. No live app keys were available locally; Alex's runtime credentials remain the application's prerequisites.

## Automatic moderation recovery

- New submissions retry transient Claude errors (429, 502, 504) once immediately. They remain private if both checks fail.
- Provider failures, including interrupted photo checks, create a durable retry record. A negative or ambiguous moderation verdict does not create a retry.
- Requests to the community state endpoint process at most one due record per minute. Durable attempts are scheduled after two minutes, then five and twenty minutes. After three failed durable attempts, the contribution stays pending for a moderator.
- Every retry checks both the text and any attached photo. No provider failure publishes content.
- Revisions and status checks prevent an earlier retry from overwriting an edit, closure or moderator decision. A three-minute lease bounds duplicate processing during concurrent requests.
- Processing depends on traffic; there is no claim that work runs while the site is idle. `POST /api/community/maintenance` is available to an existing signed-in moderator, with same-origin protection and rate limits. Any unattended scheduler should be connected by the deployment owner using their chosen protected job mechanism; this branch does not introduce an unauthenticated cron endpoint or new service credentials.

## Retention

A bounded sweep runs at most hourly on community contribution or private-request traffic:

| Data | Policy |
| --- | --- |
| Approved expired pins | Remove after 30 days, up to 50 per sweep. Preserve content with an outstanding report or pending request. Pending/hidden moderation content is preserved. |
| Unattached uploaded photos | Remove after seven days, up to 20 per sweep. Database metadata is removed only after storage deletion succeeds. New posts can attach only photos uploaded within six days, leaving a cleanup grace period. |
| Resolved correction/privacy requests | Remove 90 days after resolution. Unresolved requests stay available for action. |
| Temporary request identifiers | Stored as hashes in expiring rate-limit rows; raw network addresses are not retained by these features. |

These are application retention defaults, not a statement about separate hosting logs, database backups or provider policies. The deployment owner should publish their operator contact and confirm those separate policies before launch.

## Requests and contribution management

Public privacy/takedown requests do not require a UCL account. An optional contact email is stored only in the moderator queue, along with the submitted reference, explanation and optional HTTPS evidence link. The application never fetches those links automatically. Signed-in UCL-address accounts can submit map corrections. The current password signup does not verify ownership of that address. Neither Claude nor resolving a request changes map facts automatically: a verified catalogue edit is required.

Owners can view all their contributions with pagination, edit their review, close an alert, update collection instructions and food portions, or delete their contribution. Deleting a discussion also removes its replies, votes and reports. Review edits retain the existing review reference and votes and undergo moderation again. Collection updates cannot reopen an expired alert.

Place totals and top tags are calculated from all approved reviews in Postgres; place-specific reviews/discussions are paginated independently of the bounded activity feed. The in-app inbox includes new activity at followed places and replies to discussions the student owns or has joined; there is no email or push-notification delivery in this feature. Campus Toolkit's comparison, collections, timetable and study-resource modal is removed; basic saved bookmarks and place/food sharing links with QR codes remain. Removing that interface does not claim to delete previously stored account preferences.
