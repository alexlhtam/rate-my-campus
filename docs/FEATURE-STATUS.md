# Campus feature implementation

The campus features build on the map overhaul merged in PR #2 and the password sign-in and dialog behaviour from `main`. Credentials and live-service deployment remain with Alex. The leftover-food follow-up additionally needs `20261013000000_leftover_food.sql` after the community-tools migration; see [community operations](COMMUNITY-OPERATIONS.md) and the [food handoff](LEFTOVER-FOOD.md).

## Implemented

- The entire 181-entry official building directory has stable review/discussion pages, with nine separate room/library pages: 190 real places. Existing review IDs are preserved. Unknown map positions remain unknown. Building and room scores do not get mixed.
- Unified name/alias search, conservative offline plain-English filters, Claude origin/radius filters, selectable distance origins and optional session-only device location. Distances are straight lines, never invented walking times. The default includes all directory entries.
- Open-now and open-late checks use attributed London-time schedules. Two directly verified schedules are available; other hours are unknown. Snapshots expire after 30 days. Four library pages have sourced arrival/access notes; see [place guides](PLACE-GUIDES.md).
- Complete database rating totals, recommendation percentages, criterion averages and review-derived top tags. Paginated place reviews/discussions, review-year filtering, recent/helpful sorting and clear no-review states.
- Shareable place and alert links with explicit demo/live mode, on-device QR codes and unavailable/expired states. Shared alert lookup is independent of the limited activity feed.
- Two/three-place comparisons with review counts and honest missing-data states.
- Named browser-local collections, validated import/export, share links and explicit account load/save. Account updates preserve followed places. Collection links contain only the collection name, mode and place references.
- Local calendar-file import, upcoming lectures, exact building matches and explicit manual matching. Supports bounded daily/weekly recurrences, common timezones and date exclusions. Unsupported recurrence/timezone formats are visibly skipped. Calendar data stays in page memory and is never uploaded.
- Official study-space availability and booking links, without claiming an unverified live-data integration.
- Followed places and an in-app inbox for reviews/discussions and conversation replies. No email/push delivery is enabled by this feature.
- Own contribution status/reasons, review updates, deletion, alert closure, collection instructions and food quantities. The local demo has separate contribution controls that never write to the live service.
- A dedicated leftover-food feed and three-step composer, conservative Claude drafts, explicit ingredient/allergen/handling claims, confirmed pickup locations, collection countdowns and owner controls. Live availability polls every 15 seconds while visible; current feedback can close a pickup, and revision checks protect quantity edits. Zero/explicit closure ends collection without reservations. The private demo keeps its food posts/photos on the device. See the [food API and lifecycle handoff](LEFTOVER-FOOD.md).
- Extraction confidence/warnings/discount display and explicit selection among location suggestions before confirming a pin.
- Cross-user active pin/photo duplicate checks, bounded immediate retries and a durable provider-failure moderation queue. Negative verdicts are not retried; failures never approve content. Revision checks protect later edits and moderator decisions.
- Public private-takedown requests, signed-in account map corrections and a protected moderator resolution queue. Corrections do not automatically alter factual map data.
- Bounded retention of expired alerts, orphan photos and resolved private requests, with report holds. Retention/retry processing depends on traffic unless the deployment owner connects a protected scheduler.
- Darker pastel-purple campus buildings in both 3D and flat views, retaining the white basemap. Map bubbles and labels follow the camera in the same rendered frame, with stable group anchors during panning. At campus scale only reviewed places show score bubbles; close zoom reveals unrated places. Wider review clusters and clear space around food/other alerts reduce clutter, with selected places always available.

## Deliberately deferred

| Item | Why it remains deferred |
| --- | --- |
| Live busyness or available-seat figures | No supported feed or genuine check-in population is connected. The existing official resources are linked instead. |
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

The preceding campus-features release passed 151 automated tests and its optimized production build. Those checks covered source-backed place joins, unknown coordinates, London opening times/overnight exceptions, search filters, privacy-preserving share/calendar formats, ownership checks, complete aggregates, pagination, moderation races, photos and retention. Its browser checks covered desktop/mobile layout, map movement and focus after resizing, Garden Halls, searches, comparisons, collections, contribution controls and QR sharing.

For the leftover-food follow-up, the full suite passes 206 tests and the production build passes. The browser walkthrough covers posting, quantity and detail edits, persistence, closure, feedback, keyboard controls and mobile filtering. See [food validation status](LEFTOVER-FOOD.md#validation-and-release-status). Live email/Claude/Google calls and deployment are not represented as production-verified.
