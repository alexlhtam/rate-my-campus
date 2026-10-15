# Campus feature implementation

The campus features build on the map overhaul merged in PR #2 and the password sign-in and dialog behaviour from `main`. The hosted food migration was completed on 12 October 2026 for Supabase project `rate-my-campus` (`kcdyluxuibvugqararbg`), recorded as `20261012171306`; the matching repository file is `20261012171306_leftover_food.sql`. The base and community-tools migrations were already applied. Application credentials and deployment remain with Alex; see [community operations](COMMUNITY-OPERATIONS.md) and the [food handoff](LEFTOVER-FOOD.md).

## Implemented

- The entire 181-entry official building directory has stable review/discussion pages, with nine separate room/library pages: 190 real places. Existing review IDs are preserved. Unknown map positions remain unknown. Building and room scores do not get mixed.
- Unified name/alias search, conservative offline plain-English filters, Claude origin/radius filters, selectable distance origins and optional session-only device location. Distances are straight lines, never invented walking times. The default includes all directory entries.
- Open-now and open-late checks use attributed London-time schedules. Two directly verified schedules are available; other hours are unknown. Snapshots expire after 30 days. Four library pages have sourced arrival/access notes; see [place guides](PLACE-GUIDES.md).
- Complete database rating totals, recommendation percentages, criterion averages and review-derived top tags. Paginated place reviews/discussions, review-year filtering, recent/helpful sorting and clear no-review states.
- Shareable place and alert links with explicit demo/live mode, on-device QR codes and unavailable/expired states. Shared alert lookup is independent of the limited activity feed.
- Basic browser-local saved bookmarks. Campus Toolkit's comparison, named collections, timetable import and study-resource modal have been removed; place/alert sharing and QR codes remain available independently.
- Followed places and an in-app inbox for reviews/discussions and conversation replies. No email/push delivery is enabled by this feature.
- Own contribution status/reasons, review updates, deletion, alert closure, collection instructions and food quantities. The local demo has separate contribution controls that never write to the live service.
- A dedicated leftover-food feed and three-step composer, conservative Claude drafts, explicit ingredient/allergen/handling claims, confirmed pickup locations, collection countdowns and owner controls. Live availability polls every 15 seconds while visible; current feedback can close a pickup, and revision checks protect quantity edits. Zero/explicit closure ends collection without reservations. The private demo keeps its food posts/photos on the device. See the [food API and lifecycle handoff](LEFTOVER-FOOD.md).
- Campus incidents: a red and black alert layer for fights, spills, alarms, medical emergencies, security incidents, protests and disruption. Students corroborate or clear reports, a three-clear quorum ends them, three flags hide them, reports expire within 24 hours and moderators see them in the existing queue. Emergency numbers lead every surface. Live polling every 15 seconds; a browser-only demo with fictional samples. See the [incidents handoff](INCIDENTS.md). The hosted migration `20261015000000_campus_incidents.sql` still needs applying by the deployment owner.
- Extraction confidence/warnings/discount display and explicit selection among location suggestions before confirming a pin.
- Cross-user active pin/photo duplicate checks, bounded immediate retries and a durable provider-failure moderation queue. Negative verdicts are not retried; failures never approve content. Revision checks protect later edits and moderator decisions.
- Public private-takedown requests, signed-in account map corrections and a protected moderator resolution queue. Corrections do not automatically alter factual map data.
- Bounded retention of expired alerts, orphan photos and resolved private requests, with report holds. Retention/retry processing depends on traffic unless the deployment owner connects a protected scheduler.
- Darker pastel-purple campus buildings in both 3D and flat views, retaining the white basemap. Map bubbles and labels follow the camera in the same rendered frame, with stable group anchors during panning. At campus scale only reviewed places show score bubbles; close zoom reveals unrated places. Wider review clusters and clear space around food/other alerts reduce clutter, with selected places always available.

## Deliberately deferred

| Item | Why it remains deferred |
| --- | --- |
| Live busyness or available-seat figures | No supported feed or genuine check-in population is connected. No live availability integration is claimed. |
| Complete facilities/entrance/room map | No complete, verified dataset. Only specific official arrival notes were added; no facilities or doors were guessed. |
| Remaining building footprints | Exact allocation/source evidence is still missing. The directory supports reviews without placing invented pins. |
| Real rental directory and landlord claims | No validated property dataset or onboarding/operator process was supplied. The fictional rental remains explicitly demo-only. |
| Society verification/team roles | A claimed UCL address does not prove email ownership or committee authority; no authoritative roster or verification process is available. |
| Automated Union event discovery/publication | Source permission and a dependable scheduled ingestion/update process still need operator work. The existing attributed, confirm-before-publish single-event importer remains. |
| Real seed reviews/events | Genuine firsthand contributions and source-cleared listings must come from people/source owners; no activity was fabricated. |
| Review improvement trends | Too few genuine dated reviews. Counts, year filtering and recent reviews are available without implying a trend. |
| Push/email alerts and service activation | Alex is handling live service setup. The in-app inbox and backend hooks are implemented. |
| Public operator contact/provider retention details | Must come from the deployment owner. Application retention defaults are documented; no contact or external provider policy was invented. |

## Validation

The final suite passes **194/194 tests after Campus Toolkit removal**, and the production build passes. Earlier local demo browser checks covered posting, quantity/detail edits, persistence, closure, feedback, keyboard controls and mobile filtering. The refreshed production preview confirms Toolkit navigation is absent and place sharing and QR generation still work.

Hosted checks on 12 October 2026 verified the food migration's four columns, closure constraint, two indexes, private 5 MiB JPEG/PNG/WebP photo bucket, and RLS on all 12 public-schema tables with no client policies. The [rollback-only SQL check](../scripts/verify-food-backend.sql) passed feed/metadata, ownership/revisions, fresh distinct-account feedback, quorum, idempotent closure and client-role isolation, leaving zero synthetic fixtures. See [food validation status](LEFTOVER-FOOD.md#validation-and-release-status). App authentication, actual uploads, Claude/Google calls and deployment remain unverified without live app credentials.
