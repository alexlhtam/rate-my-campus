# Rate Our Campus — connect the live services

The app has server adapters for Claude and Google Maps, and uses Supabase for data, photos and UCL email sign-in. A configured account is not automatically connected to this deployment. Configure the following names as **environment variables** in the Vercel project (Supabase's own variables are covered in the README's *Deploy on Vercel with Supabase*); never add keys to browser code, source files or a chat message.

For local use, copy `.env.example` to `.env.local` in the project root (or run `vercel env pull .env.local`) and fill in the blank values there. The file is ignored by Git and Next.js loads it automatically; restart the process after editing. The LAN preview remains an isolated demo even when local credentials are present. Local files are never deployed; configure hosted values in Vercel.

| Name | Value to configure |
|---|---|
| `ANTHROPIC_API_KEY` | Your existing Anthropic API key |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-sonnet-4-6` |
| `ANTHROPIC_WORKSPACE_ID` | Optional; required when your Anthropic key needs a workspace selection |
| `GOOGLE_MAPS_API_KEY` | A server key restricted to Map Tiles API and Places API (New) |
| `ADMIN_USER_IDS` | Comma-separated Supabase Auth user IDs authorised to moderate/import |
| `UNION_IMPORT_ENABLED` | Leave unset until source permission and current terms are confirmed; set to `true` to enable manual imports |

**Google setup**

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select the project's Google Cloud project and link a billing account.
2. In the API Library, enable **Map Tiles API** and **Places API (New)**. This implementation does not need a browser Maps JavaScript API key.
3. Under APIs & Services → Credentials, create an API key. Edit its API restrictions to allow only those two APIs. It is a server key: website/HTTP-referrer restrictions do not suit these server requests. If your hosting provides fixed outbound IP addresses, restrict it to those; do not guess an IP range. See [Google's key restrictions](https://developers.google.com/maps/api-security-best-practices).
4. Add that value to the runtime secret `GOOGLE_MAPS_API_KEY`.
5. Set conservative quotas for both APIs and billing alerts. **A billing budget sends alerts; it does not stop spending.** Quotas constrain usage and can make the map unavailable when exhausted. Choose limits using your project's current prices and expected traffic; do not assume a blanket free monthly credit. [Google cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs).
6. After deployment, sign in and load the map. Confirm Google Maps branding and the viewport's full attribution are visible. Try matching “Wilkins Building UCL”. The browser should call `/api/map/*` and `/api/assist`, with no Google API key in network URLs.

The server uses Google's [session-based map tiles](https://developers.google.com/maps/documentation/tile/session_tokens), with Google's supported `styles` option for a pale, minimal roadmap. It returns Google's client cache headers and does not persist tiles. The frontend must retain the [required attribution](https://developers.google.com/maps/documentation/tile/policies) and display Google tiles without colour filters. Any extruded campus-building overlay uses separately attributed open geometry, not extracted Google buildings. Google Places results are suggestions for user confirmation; do not reuse them as a permanently cached place directory. Absent a Google key, the map uses a clearly labelled OpenStreetMap fallback.

**Sign-in setup**

Accounts are `@ucl.ac.uk` email + password. The server creates them already confirmed through the Supabase service-role key, so no email is sent and no SMTP or templates are needed. Addresses are not verified by email; this is a hackathon MVP trade-off. To add proper verification later, configure custom SMTP in Supabase and switch back to email codes.

**Claude setup**

Configure the existing key as `ANTHROPIC_API_KEY`; add `ANTHROPIC_WORKSPACE_ID` only if needed. The default model is a documented, versioned [Claude Sonnet 4.6 model](https://platform.claude.com/docs/en/models/sonnet-4-6/overview); `ANTHROPIC_MODEL` can select another model your account supports. Set an Anthropic workspace spend limit in your account. [API authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

Try a plain-English search, then a text/photo extraction while UCL-verified. Extractions produce editable drafts and require confirmation. Dietary suitability is never inferred from a photo. Missing or failing Claude configuration returns a clear unavailable response; it never pretends a local fallback is AI.

Routine posts and reviews publish automatically when Claude approves them. Manual moderator review is needed only for flagged content or an unavailable moderation service. Uploaded photos are prepared in the browser as oriented JPEGs up to 1600 pixels and 1.8 MB; re-encoding removes original camera/GPS metadata before AI extraction or upload. Claude checks the prepared photo as well as the text. Food suitability and factual accuracy are never presented as verified.

**Source imports and limits**

As checked on 12 October 2026, the Union's [robots file](https://studentsunionucl.org/robots.txt) did not prohibit public event paths, but that is not a reuse licence. The linked [terms page](https://studentsunionucl.org/terms-and-conditions) led to shop terms rather than clear event-reuse permission. Automated imports therefore remain off. The implemented operator import accepts one explicit public `https://studentsunionucl.org/whats-on/...` listing, rechecks robots, refuses redirects/private paths, credits the source, and returns a draft; it is limited to one import per hour across the site. No recurring crawler is scheduled. Confirm permission/current terms before enabling it.

Connected requests require a signed-in UCL account. Postgres stores atomic per-user limits across function instances: 30 assistant requests/hour, 20 map sessions/hour, 900 map tiles/hour and 120 viewport lookups/hour. Provider quotas and account spend limits remain necessary because per-user limits are not a project-wide budget cap.

**Acceptance checks after secrets are configured**

No API secret values were supplied during this build, so live Google, Anthropic and email delivery have not been tested. Offline contract tests cover service requests, failure handling, source restrictions and draft confirmation; they do not establish that your accounts, billing or sending domain are ready.

- `/api/assist` shows configured service booleans only, never key values.
- Anonymous requests to charged endpoints receive `401`; unverified accounts cannot post or extract drafts.
- A UCL code arrives, expires as described in the interface, cannot be reused, and the account becomes verified after success.
- Google map tiles, matching, attribution and Claude search/extraction work; the deployment currently needs real credentials to verify these external calls.
- A deliberately abusive review is withheld, a first-person critical review follows moderation, expired/gone pins disappear, and reports reach the moderator queue.
