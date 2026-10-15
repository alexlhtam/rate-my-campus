# Campus assistant deployment and checks

The campus assistant can use the place catalogue, research current information with Claude's web search, and suggest locations on the map. Alex can enable it on the GitHub-backed Vercel deployment using the existing service accounts. Search results are temporary personal map results; they do not publish a community pin or review.

## Vercel setup

1. Open the Vercel project connected to `alexlhtam/rate-my-campus` and go to **Settings → Environment Variables**. Select **Production**, and **Preview** too if the pull-request deployment should support live research. Keep credentials in Vercel rather than Git or pull-request comments.
2. Confirm these server variables:

   | Variable | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | A working Anthropic API key with available credit and access to the selected model. |
   | `ANTHROPIC_MODEL` | `claude-sonnet-4-6` is the app default. Keep this value unless a replacement has been checked with the assistant's tools. |
   | `ANTHROPIC_WORKSPACE_ID` | Leave blank unless the existing Anthropic integration requires it. |
   | `GOOGLE_MAPS_API_KEY` | Optional for matching places outside the catalogue. Its Google Cloud project needs billing, **Places API (New)** and **Map Tiles API** enabled. |

3. Confirm that the Anthropic organization permits web search and that its domain restrictions allow the sources you want to search. The native search tool uses the Anthropic key; a separate Google Search key is unnecessary. An administrator can disable or restrict web search in the Claude Console. [Anthropic web search documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
4. Deploy the reviewed branch after saving variables. The `/api/assist` route declares a **60-second maximum duration**; retain that setting if overriding function duration in Vercel. [Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).
5. Sign in on that deployment with a normal campus account. Connected research uses the existing authentication and shared assistance rate limit. If sign-in or the database is unavailable, fix the existing deployment connection first; adding an Anthropic key alone cannot resolve it.

Web research adds provider charges alongside model tokens. Review usage in the Anthropic and Google accounts during testing. The application bounds research time and tool calls, but those limits do not replace account billing controls.

## What the map results mean

Catalogue results use existing verified map points. A room or library can share its parent building's point; this does not identify its entrance or its floor within the map. The assistant can explain those details using linked sources.

New Google matches stay temporary and carry Google Maps attribution. They are shown on the map only while the Google basemap is available; an external Google Maps link remains useful if it is unavailable. The application does not save these results as new public places. These display and storage rules follow the [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

Claude selects from locations returned by the tools. It cannot invent coordinates. If a location cannot be established, the response should explain the uncertainty or ask for more detail. Suggestions should distinguish known facilities from unconfirmed details such as current seat availability, plug sockets or opening hours. Source links let students check the evidence.

## Checks after deployment

- Ask **“Where is the archeology library?”** Expect the Institute of Archaeology Library in its parent building at 31–34 Gordon Square, with fifth-floor guidance and an [official UCL source](https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/institute-archaeology-library). Repeat with the spelling **“archaeology”**.
- Ask **“Research two quiet study spaces with plug sockets near Bloomsbury and explain the trade-offs.”** Expect actual suggestions and evidence links. An unconfirmed facility should remain unconfirmed rather than being presented as fact.
- With Google configured, ask **“Where is Wellcome Collection? Show it on the map.”** Check that the answer's name and address match the resulting location and that its source link opens the intended place.
- Ask **“Where is the fictional Moonbeam Library on campus?”** Expect uncertainty or a clarification, with no fabricated pin.
- Submit a question, then cancel it. The input should clear when sent, the submitted question should remain visible, and a cancelled response should not replace a newer search. Check Retry after a failed request.

If web research fails while catalogue matching works, check the Anthropic key's model access, credit, and organization web-search settings. If only unfamiliar locations fail, check Places API access and Google map loading. A source link or a researched address is not sufficient by itself to create a map coordinate.
