import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, discoverPage, fetchEventPage, htmlToText, londonDate, londonMidnight,
  MAX_EVENT_TEXT_LENGTH, MAX_SOURCE_BYTES, parseCalendarPage, parseEventPage,
} from "../../lib/freebies/ucl";
import type { SourceEvent } from "../../lib/freebies/types";

const startSeconds = 1791759600;
const endSeconds = 1792972800;
const source: SourceEvent = {
  id: "203724:1791828000:1791835200",
  title: "Caledonian Society Pizza Night & Scottish Dancing TASTER #4",
  url: "https://studentsunionucl.org/whats-on/give-it-go/caledonian-society-pizza-night-scottish-dancing-taster-4?v=96575",
  start: "2026-10-12T18:00:00.000Z", end: "2026-10-12T20:00:00.000Z",
  imageUrl: null, sourceLocation: "IOE Bedford Way 642",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "203724", variation_id: "96575", title: source.title,
    variation_url: source.url,
    field_date_range_value: "1791828000", field_date_range_end_value: "1791835200",
    field_event_venue__label: "IOE Bedford Way 642", ...overrides,
  };
}

// Compact fixture mirrors the live page's nested Drupal fields and separate booking block.
const html = `<!doctype html><html><head><script>const fake = '<article>Free gold</article>';</script></head><body>
<nav>Free cocktails at an unrelated event</nav><h1>Pizza &amp; Scottish Dancing</h1>
<div class="block block-system-main-block"><div class="content"><article>
<div class="field field--name-field-date-range"><time datetime="2026-10-12T19:00:00+01:00">Monday 12 October</time><time>19:00 to 21:00</time></div>
<div class="field field--name-field-event-venue"><ul><li><a href="/whats-on/venue/ioe-bedford-way-642">IOE Bedford Way 642</a></li></ul></div>
<div class="clearfix field field--name-body"><p>Join our final <strong>free taster session</strong>.</p><div data-note="a > b"><p>A <strong>free pizza night!</strong></p><p>Snacks and drinks will be provided :)</p></div><p>UCL students only. <a href="https://tickets.example.org/book?event=1&amp;date=2">Book your place</a>.</p></div>
<div class="field--name-field-event-tags">Beginner Friendly</div></article></div></div>
<aside><div id="block-eventaddtocartblock"><h2>Tickets</h2><div class="content"><div class="field--name-price">£3.50</div><p>To purchase tickets, you&#039;ll need to log in.</p><a href="/user/login?destination=/product/203724">Log in</a></div></div></aside>
<footer><div class="field--name-body">Free gym towels. 25 Gordon Street is the Union office, not this event venue.</div></footer></body></html>`;

test("London date and 14-day calendar window handle the October clock change", () => {
  assert.equal(londonDate(new Date("2026-10-11T23:30:00Z")), "2026-10-12");
  assert.equal(addDays("2026-10-12", 14), "2026-10-26");
  assert.equal(londonMidnight("2026-10-12").toISOString(), "2026-10-11T23:00:00.000Z");
  assert.equal(londonMidnight("2026-10-26").toISOString(), "2026-10-26T00:00:00.000Z");
  assert.equal((londonMidnight("2026-10-26").getTime() - londonMidnight("2026-10-12").getTime()) / 3600000, 337);
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.throws(() => addDays("2026-02-30", 1), /Invalid calendar date/);
});

test("deduplicates ticket variations while retaining distinct recurring occurrences", () => {
  const parsed = parseCalendarPage([
    row(), row({ variation_id: "96576" }),
    row({ variation_id: "96600", field_date_range_value: "1792432800", field_date_range_end_value: "1792440000" }),
  ], "2026-10-12", "2026-10-26");
  assert.equal(parsed.rawCount, 3);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].id, source.id);
  assert.match(parsed.events[1].url, /v=96600$/);
  assert.equal(parsed.done, false);
  assert.deepEqual(parsed.warnings, []);
});

test("filters extra upstream dates, includes ongoing events, and uses an exclusive end", () => {
  const parsed = parseCalendarPage([
    row({ field_date_range_value: String(startSeconds - 86400), field_date_range_end_value: String(startSeconds + 3600) }),
    row({ product_id: "2", field_date_range_value: String(endSeconds), field_date_range_end_value: String(endSeconds + 3600) }),
    row({ product_id: "3", field_date_range_value: String(startSeconds - 3600), field_date_range_end_value: String(startSeconds) }),
    row({ product_id: "4", field_date_range_value: String(startSeconds), field_date_range_end_value: String(startSeconds) }),
  ], "2026-10-12", "2026-10-26");
  assert.equal(parsed.rawCount, 4);
  assert.deepEqual(parsed.events.map((event) => event.id.split(":")[0]), ["203724", "4"]);
});

test("only an actually empty source page ends pagination", () => {
  assert.equal(parseCalendarPage([row()], "2026-10-12", "2026-10-26").done, false);
  assert.equal(parseCalendarPage([row({ field_date_range_value: String(endSeconds), field_date_range_end_value: String(endSeconds + 100) })], "2026-10-12", "2026-10-26").done, false);
  assert.equal(parseCalendarPage([], "2026-10-12", "2026-10-26").done, true);
  assert.equal(parseCalendarPage({ "#cache": { tags: [] } }, "2026-10-12", "2026-10-26").done, true);
  assert.equal(parseCalendarPage({ "96575": row(), "#cache": {} }, "2026-10-12", "2026-10-26").events.length, 1);
});

test("calendar organiser and explicit online state are preserved without interpreting free admission as a freebie", () => {
  const [event] = parseCalendarPage([row({ field_event_owner_group: "Example &amp; Friends Society", field_event_online: "On", ticketingType: "free", price: "0" })], "2026-10-12", "2026-10-26").events;
  assert.equal(event.sourceOrganizer, "Example & Friends Society");
  assert.equal(event.sourceOnline, true);
  assert.equal("hasFreebies" in event, false);
  const page = parseEventPage(html, event);
  assert.match(page.text, /Calendar organiser: Example & Friends Society/);
  assert.match(page.text, /calendar lists this as an online event/);
  assert.equal(parseCalendarPage([row({ field_event_online: "unexpected" })], "2026-10-12", "2026-10-26").events[0].sourceOnline, null);
});

test("malformed records preserve an explicit coverage warning, never false emptiness", () => {
  const result = parseCalendarPage([row({ field_date_range_value: "invalid" }), null, row({ title: "" }), row({ variation_url: "https://attacker.example/whats-on/event" })], "2026-10-12", "2026-10-26");
  assert.equal(result.done, false);
  assert.equal(result.rawCount, 4);
  assert.equal(result.events.length, 0);
  assert.equal(result.warnings.length, 4);
  assert.throws(() => parseCalendarPage({ error: "Unavailable" }, "2026-10-12", "2026-10-26"), /unexpected JSON/);
  assert.throws(() => parseCalendarPage(null, "2026-10-12", "2026-10-26"), /invalid response/);
});

test("full nested description and separate ticket price are retained without footer contamination", () => {
  const event = parseEventPage(html, source);
  assert.equal(event.title, "Pizza & Scottish Dancing");
  assert.equal(event.location, "IOE Bedford Way 642");
  assert.equal(event.start, source.start);
  assert.equal(event.end, source.end);
  assert.match(event.description, /free pizza night!/);
  assert.match(event.description, /Snacks and drinks will be provided/);
  assert.match(event.description, /UCL students only/);
  assert.match(event.text, /£3\.50/);
  assert.match(event.text, /you'll need to log in/);
  assert.doesNotMatch(event.text, /gold|cocktails|gym towels|Union office/);
  assert.ok(event.links.includes("https://tickets.example.org/book?event=1&date=2"));
  assert.ok(event.links.some((link) => link.endsWith("#block-eventaddtocartblock")));
});

test("JSON-LD event metadata supports pages without Drupal article markup", () => {
  const json = { "@context": "https://schema.org", "@graph": [{ "@type": "Event", name: "Tea afternoon", description: "<p>Free tea and biscuits.</p>", startDate: "2026-10-12T19:00:00+01:00", endDate: "2026-10-12T20:00:00+01:00", location: { "@type": "Place", name: "Yellow Room", address: { streetAddress: "Gower Street", postalCode: "WC1E 6BT" } }, offers: { price: "0", url: "https://tickets.example.org/tea" } }] };
  const parsed = parseEventPage(`<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`, source);
  assert.equal(parsed.description, "Free tea and biscuits.");
  assert.equal(parsed.location, "Yellow Room, Gower Street, WC1E 6BT");
  assert.equal(parsed.end, "2026-10-12T19:00:00.000Z");
  assert.ok(parsed.links.includes("https://tickets.example.org/tea"));
});

test("HTML text preserves word boundaries and decodes numeric and common named entities", () => {
  assert.equal(htmlToText('<p>i<span>mmerse</span> &pound;3 &#x1F355; &amp; tea</p><p>Next line</p>'), "immerse £3 🍕 & tea\n\nNext line");
  assert.equal(htmlToText('<img alt="Free &amp; tasty"><script>Free gold</script>'), "[Image: Free & tasty]");
});

test("missing, structurally incomplete, and oversized event content fails explicitly", () => {
  assert.throws(() => parseEventPage("<html><h1>Log in</h1><form>Password</form></html>", source), /no readable event description/);
  assert.throws(() => parseEventPage('<article><div class="field--name-body"><p>Free food</p>', source), /unclosed article/);
  const tooLong = html.replace("Join our final", "x".repeat(MAX_EVENT_TEXT_LENGTH));
  assert.throws(() => parseEventPage(tooLong, source), /not truncated or partially analysed/);
});

test("discovery calls every requested page using London Unix seconds and validates JSON", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    return new Response(JSON.stringify([row()]), { headers: { "Content-Type": "application/json" } });
  });
  const result = await discoverPage("2026-10-12", "2026-10-26", 5);
  assert.deepEqual(calls, ["https://studentsunionucl.org/json/anon/whats-on/1791759600/1792972800/list/5"]);
  assert.equal(result.events.length, 1);
});

test("detail fetch refuses a cross-host redirect before following it", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { Location: "https://example.org/private" } });
  });
  await assert.rejects(fetchEventPage(source), /must use https:\/\/studentsunionucl/);
  assert.equal(requests, 1);
});

test("bounded fetch rejects oversized content and non-JSON challenge pages", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("x", {
    headers: { "Content-Type": "text/html", "Content-Length": String(MAX_SOURCE_BYTES + 1) },
  }));
  await assert.rejects(fetchEventPage(source), /3 MiB limit/);
  mock.mock.mockImplementation(async () => new Response("<h1>Verify you are human</h1>", { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(discoverPage("2026-10-12", "2026-10-26", 0), /expected json/);
});

test("streaming limit also applies when content-length is absent", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_SOURCE_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(fetchEventPage(source), /3 MiB limit/);
});
