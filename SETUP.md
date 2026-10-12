# Rate My Campus — connect the live services

The app has server adapters for Claude, Google Maps and Resend. A configured account is not automatically connected to this deployment. Configure the following names as **server runtime secrets** through the Site's supported secrets controls; never add keys to browser code, source files, the hosting manifest or a chat message.

For local use, copy `.env.example` to `.env` in the project root and fill in the blank values there; preserve any existing `.env`. The file is ignored by Git. Development/build use Cloudflare's native loader, and the built local server/LAN launcher explicitly read the root `.env` plus optional `.env.local` overrides. Restart the process after editing. Remove or migrate a legacy `.dev.vars` before relying on `.env`, because Cloudflare prioritises it during development. The LAN preview remains an isolated demo even when local credentials are present. No local credentials or environment snapshots are included in deployment output; configure hosted runtime secrets separately.

| Name | Value to configure |
|---|---|
| `ANTHROPIC_API_KEY` | Your existing Anthropic API key |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-sonnet-4-6` |
| `ANTHROPIC_WORKSPACE_ID` | Optional; required when your Anthropic key needs a workspace selection |
| `GOOGLE_MAPS_API_KEY` | A server key restricted to Map Tiles API and Places API (New) |
| `RESEND_API_KEY` | A Resend sending key, ideally restricted to your sending domain |
| `EMAIL_FROM` | A sender on your verified domain, such as `Rate My Campus <verify@your-domain.example>` |
| `ADMIN_USER_IDS` | Comma-separated Sites user IDs authorised to moderate/import |
| `UNION_IMPORT_ENABLED` | Leave unset until source permission and current terms are confirmed; set to `true` to enable manual imports |

**Google setup**

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select the project's Google Cloud project and link a billing account.
2. In the API Library, enable **Map Tiles API** and **Places API (New)**. This implementation does not need a browser Maps JavaScript API key.
3. Under APIs & Services → Credentials, create an API key. Edit its API restrictions to allow only those two APIs. It is a server key: website/HTTP-referrer restrictions do not suit these server requests. If your hosting provides fixed outbound IP addresses, restrict it to those; do not guess an IP range. See [Google's key restrictions](https://developers.google.com/maps/api-security-best-practices).
4. Add that value to the runtime secret `GOOGLE_MAPS_API_KEY`.
5. Set conservative quotas for both APIs and billing alerts. **A billing budget sends alerts; it does not stop spending.** Quotas constrain usage and can make the map unavailable when exhausted. Choose limits using your project's current prices and expected traffic; do not assume a blanket free monthly credit. [Google cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs).
6. After deployment, sign in and load the map. Confirm Google Maps branding and the viewport's full attribution are visible. Try matching “Wilkins Building UCL”. The browser should call `/api/map/*` and `/api/assist`, with no Google API key in network URLs.

The server uses Google's [session-based map tiles](https://developers.google.com/maps/documentation/tile/session_tokens), with Google's supported `styles` option for a pale, minimal roadmap. It returns Google's client cache headers and does not persist tiles. The frontend must retain the [required attribution](https://developers.google.com/maps/documentation/tile/policies) and display Google tiles without colour filters. Any extruded campus-building overlay uses separately attributed open geometry, not extracted Google buildings. Google Places results are suggestions for user confirmation; do not reuse them as a permanently cached place directory. Absent a Google key, the map uses a clearly labelled OpenStreetMap fallback.

**Email verification setup**

1. Create a [Resend account](https://resend.com/) and add a domain you control. A dedicated sending subdomain is suitable; you do not need to control `ucl.ac.uk` to send verification emails **to** UCL students.
2. Add the DNS records Resend provides at your domain's DNS host, then wait for Resend to mark the domain verified. Follow the exact records shown, preserving existing mail records. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).
3. Create a sending API key restricted to that domain where supported. Configure `RESEND_API_KEY` and an `EMAIL_FROM` address on the verified domain. Resend's test sender is not a production way to email arbitrary students. [API key settings](https://resend.com/docs/dashboard/api-keys/introduction).
4. In the app, sign in with ChatGPT, enter your real `@ucl.ac.uk` address, request the code and check the inbox. Enter the code and confirm that posting is enabled. ChatGPT sign-in identifies the account; the separate email code verifies UCL membership.

**Claude setup**

Configure the existing key as `ANTHROPIC_API_KEY`; add `ANTHROPIC_WORKSPACE_ID` only if needed. The default model is a documented, versioned [Claude Sonnet 4.6 model](https://platform.claude.com/docs/en/models/sonnet-4-6/overview); `ANTHROPIC_MODEL` can select another model your account supports. Set an Anthropic workspace spend limit in your account. [API authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

Try a plain-English search, then a text/photo extraction while UCL-verified. Extractions produce editable drafts and require confirmation. Dietary suitability is never inferred from a photo. Missing or failing Claude configuration returns a clear unavailable response; it never pretends a local fallback is AI.

Routine posts and reviews publish automatically when Claude approves them. Manual moderator review is needed only for flagged content or an unavailable moderation service. Uploaded photos are prepared in the browser as oriented JPEGs up to 1600 pixels and 1.8 MB; re-encoding removes original camera/GPS metadata before AI extraction or upload. Claude checks the prepared photo as well as the text. Food suitability and factual accuracy are never presented as verified.

**Source imports and limits**

As checked on 12 October 2026, the Union's [robots file](https://studentsunionucl.org/robots.txt) did not prohibit public event paths, but that is not a reuse licence. The linked [terms page](https://studentsunionucl.org/terms-and-conditions) led to shop terms rather than clear event-reuse permission. Automated imports therefore remain off. The implemented operator import accepts one explicit public `https://studentsunionucl.org/whats-on/...` listing, rechecks robots, refuses redirects/private paths, credits the source, and returns a draft; it is limited to one import per hour across the site. No recurring crawler is scheduled. Confirm permission/current terms before enabling it.

Connected requests require Sites identity. Draft extraction additionally requires UCL verification. D1 stores atomic per-user limits across workers: 30 assistant requests/hour, 20 map sessions/hour, 900 map tiles/hour and 120 viewport lookups/hour. Provider quotas and account spend limits remain necessary because per-user limits are not a project-wide budget cap.

**Acceptance checks after secrets are configured**

No API secret values were supplied during this build, so live Google, Anthropic and email delivery have not been tested. Offline contract tests cover service requests, failure handling, source restrictions and draft confirmation; they do not establish that your accounts, billing or sending domain are ready.

- `/api/assist` shows configured service booleans only, never key values.
- Anonymous requests to charged endpoints receive `401`; unverified accounts cannot post or extract drafts.
- A UCL code arrives, expires as described in the interface, cannot be reused, and the account becomes verified after success.
- Google map tiles, matching, attribution and Claude search/extraction work; the deployment currently needs real credentials to verify these external calls.
- A deliberately abusive review is withheld, a first-person critical review follows moderation, expired/gone pins disappear, and reports reach the moderator queue.
