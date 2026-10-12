import assert from "node:assert/strict";
import test from "node:test";
import {
  askClaude,
  askJev,
  parseJevResponse,
  ProviderError,
  verifyExtraction,
} from "../../lib/freebies/providers";
import type { ProviderConfig } from "../../lib/freebies/providers";
import type { EventPage, Extraction } from "../../lib/freebies/types";

// Deliberately synthetic credentials. These tests never read process.env and
// every test that calls a provider replaces fetch for the duration of the test.
const config: ProviderConfig = {
  jevKey: "unit-test-jev-credential",
  claudeKey: "unit-test-claude-credential",
  jevModel: "jev-latest",
  claudeModel: "test-claude-model",
  threshold: 0.5,
};

const bookingUrl = "https://studentsunionucl.org/events/game-night/book";
const locationEvidence = "Venue: Room 101, Bloomsbury Theatre Building.\nAddress: 15 Gordon Street, London WC1H 0AH.";
const sourceText = [
  "Game Night & Pizza",
  "Monday 12 October 2026, 18:00–20:00.",
  locationEvidence,
  "Complimentary pizza and soft drinks are provided.",
  "Tickets cost £5 for UCL students. Advance booking required.",
  "One drink per attendee, while stocks last.",
].join("\n");

function eventPage(overrides: Partial<EventPage> = {}): EventPage {
  return {
    title: "Game Night & Pizza",
    url: "https://studentsunionucl.org/whats-on/clubs-societies/game-night",
    text: sourceText,
    location: "Room 101, Bloomsbury Theatre Building",
    description: "Complimentary pizza and soft drinks are provided.",
    links: [bookingUrl],
    start: "2026-10-12T18:00:00+01:00",
    end: "2026-10-12T20:00:00+01:00",
    ...overrides,
  };
}

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    hasFreebies: true,
    summary: "Pizza and soft drinks are included with a £5 student ticket.",
    freebies: [{
      item: "Pizza",
      category: "food",
      evidence: "Complimentary pizza and soft drinks are provided.",
      certainty: "confirmed",
    }],
    venue: "Room 101, Bloomsbury Theatre Building",
    address: "15 Gordon Street, London WC1H 0AH",
    locationEvidence,
    admission: "paid",
    priceDetails: "Tickets cost £5 for UCL students.",
    bookingRequired: true,
    bookingUrl,
    eligibility: "UCL students",
    conditions: ["One drink per attendee, while stocks last."],
    ...overrides,
  };
}

function jevResponse(score: unknown = 0.94) {
  return {
    model: "jev-1.13.0",
    answers: { has_free_stuff: { type: "noul", noul: score } },
    usage: { input_tokens: 800, output_tokens: 20 },
  };
}

function claudeResponse(value: unknown = extraction(), stopReason = "end_turn") {
  return {
    model: config.claudeModel,
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(value) }],
    usage: { input_tokens: 900, output_tokens: 300 },
  };
}

test("Jev accepts probabilities at both boundaries and preserves its returned model", () => {
  for (const score of [0, 0.5, 1]) {
    const result = parseJevResponse(jevResponse(score));
    assert.equal(result.score, score);
    assert.equal(result.model, "jev-1.13.0");
  }
});

test("Jev rejects nonnumeric, nonfinite, and out-of-range values instead of coercing a decision", () => {
  for (const score of [-0.001, 1.001, NaN, Infinity, -Infinity, "0.94", true, false, null, undefined]) {
    const response = jevResponse();
    response.answers.has_free_stuff.noul = score;
    assert.throws(() => parseJevResponse(response), `Must reject ${String(score)}`);
  }
});

test("Jev requires the expected question and noul response type", () => {
  for (const value of [
    null,
    {},
    { model: "jev-1.13.0", answers: {} },
    { model: "jev-1.13.0", answers: { has_free_stuff: { type: "choice", noul: 0.94 } } },
    { model: "jev-1.13.0", answers: { different_question: { type: "noul", noul: 0.94 } } },
  ]) assert.throws(() => parseJevResponse(value));
});

test("grounded freebies included with paid admission retain the price and conditions", () => {
  const result = verifyExtraction(extraction(), eventPage());
  assert.equal(result.hasFreebies, true);
  assert.equal(result.admission, "paid");
  assert.equal(result.priceDetails, "Tickets cost £5 for UCL students.");
  assert.equal(result.eligibility, "UCL students");
  assert.deepEqual(result.conditions, ["One drink per attendee, while stocks last."]);
  assert.equal(result.venue, "Room 101, Bloomsbury Theatre Building");
  assert.equal(result.bookingUrl, bookingUrl);
});

test("a model summary cannot add snacks or coffee beyond the validated pizza item", () => {
  const result = verifyExtraction(extraction({
    summary: "Attendees receive free pizza, snacks and coffee throughout the evening.",
  }), eventPage());
  assert.match(result.summary, /pizza/i);
  assert.doesNotMatch(result.summary, /snacks|coffee/i);
  assert.deepEqual(result.freebies.map((item) => item.item), ["Pizza"]);
  assert.equal(result.admission, "paid");
  assert.equal(result.priceDetails, "Tickets cost £5 for UCL students.");
});

test("Claude may reject a Jev false positive such as free admission without a giveaway", () => {
  const result = verifyExtraction(extraction({
    hasFreebies: false,
    freebies: [],
    summary: "Free entry only; no giveaways are described.",
    admission: "free",
    venue: null,
    address: null,
    locationEvidence: null,
    priceDetails: null,
    bookingRequired: null,
    bookingUrl: null,
    eligibility: null,
    conditions: [],
  }), eventPage({ text: "Free entry to a talk. Refreshments are available to purchase." }));
  assert.equal(result.hasFreebies, false);
  assert.deepEqual(result.freebies, []);
});

test("explicit refreshments with unclear pricing stay possible instead of being promoted to confirmed", () => {
  const result = verifyExtraction(extraction({
    freebies: [{ item: "Refreshments", category: "other", evidence: "Refreshments are provided.", certainty: "possible" }],
    venue: null,
    address: null,
    locationEvidence: null,
    admission: "unknown",
    conditions: ["The page does not say whether refreshments cost extra."],
  }), eventPage({ text: "Refreshments are provided." }));
  assert.equal(result.freebies[0].certainty, "possible");
  assert.equal(result.admission, "unknown");
});

test("hasFreebies must agree with the presence of extracted items", () => {
  assert.throws(() => verifyExtraction(extraction({ hasFreebies: false }), eventPage()), /inconsistent/i);
  assert.throws(() => verifyExtraction(extraction({ hasFreebies: true, freebies: [] }), eventPage()), /inconsistent/i);
});

test("invented evidence makes the event fail verification", () => {
  const value = extraction();
  value.freebies[0].evidence = "Every attendee receives a free laptop.";
  assert.throws(() => verifyExtraction(value, eventPage()), /source quote/i);
});

test("a real reading-session quote cannot substantiate invented snacks at either certainty", () => {
  const readingText = "Join us for an hour of quiet reading together.";
  const page = eventPage({ title: "Quiet reading", text: readingText, description: readingText });
  for (const certainty of ["confirmed", "possible"] as const) {
    const value = extraction({
      freebies: [{
        item: "Snacks provided during reading",
        category: "food",
        evidence: readingText,
        certainty,
      }],
    });
    assert.throws(() => verifyExtraction(value, page), `Invented ${certainty} snacks must fail`);
  }
});

test("an item mentioned elsewhere on the page must still appear in its own evidence", () => {
  const readingText = "Join us for an hour of quiet reading together.";
  const value = extraction();
  value.freebies[0].evidence = readingText;
  const page = eventPage({ text: `${sourceText}\n${readingText}` });
  assert.throws(() => verifyExtraction(value, page), "A pizza mention elsewhere cannot support a reading quotation");
});

test("item matching uses phrase boundaries rather than substrings inside other words", () => {
  for (const { item, evidence } of [
    { item: "Tea", evidence: "Team members are welcome." },
    { item: "Ham", evidence: "Complimentary champagne is provided." },
  ]) {
    const value = extraction({
      freebies: [{ item, evidence, category: "food", certainty: "confirmed" }],
    });
    assert.throws(() => verifyExtraction(value, eventPage({ text: evidence })), `${item} must be a whole phrase`);
  }
});

test("expanded item labels cannot add qualifications or quantities absent from the quote", () => {
  for (const item of ["Vegetarian pizza", "Unlimited soft drinks", "Pizza provided during reading"]) {
    const value = extraction();
    value.freebies[0].item = item;
    assert.throws(() => verifyExtraction(value, eventPage()), `Unsupported label must fail: ${item}`);
  }
});

test("literal source names preserve biscuits and separate tea and coffee offers", () => {
  const evidence = "Complimentary biscuits, tea and coffee are provided.";
  const value = extraction({
    freebies: [
      { item: "Biscuits", category: "food", evidence, certainty: "confirmed" },
      { item: "Tea", category: "drinks", evidence, certainty: "confirmed" },
      { item: "Coffee", category: "drinks", evidence, certainty: "confirmed" },
    ],
  });
  const result = verifyExtraction(value, eventPage({ text: `${sourceText}\n${evidence}` }));
  assert.deepEqual(result.freebies.map((item) => item.item), ["Biscuits", "Tea", "Coffee"]);
  assert.equal(result.hasFreebies, true);
});

test("literal item phrases allow case and whitespace normalization", () => {
  const value = extraction({
    freebies: [{
      item: "SOFT\t  drinks",
      category: "drinks",
      evidence: "Complimentary PIZZA and soft\n drinks are provided.",
      certainty: "confirmed",
    }],
  });
  const result = verifyExtraction(value, eventPage());
  assert.equal(result.hasFreebies, true);
  assert.equal(result.freebies.length, 1);
});

test("empty or whitespace-only evidence and item names cannot masquerade as grounded extraction", () => {
  for (const evidence of ["", " ", "\n\t  "]) {
    const value = extraction();
    value.freebies[0].evidence = evidence;
    assert.throws(() => verifyExtraction(value, eventPage()), "Blank evidence must fail");
  }
  const value = extraction();
  value.freebies[0].item = "   ";
  assert.throws(() => verifyExtraction(value, eventPage()), "Blank item names must fail");
});

test("evidence tolerates page whitespace but cannot exceed 25 words", () => {
  const value = extraction();
  value.freebies[0].evidence = "Complimentary pizza and\nsoft drinks are provided.";
  assert.equal(verifyExtraction(value, eventPage()).hasFreebies, true);
  const longEvidence = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
  value.freebies[0].evidence = longEvidence;
  assert.throws(() => verifyExtraction(value, eventPage({ text: longEvidence })), /overlong/i,
    "An overlong quote must report its length before the missing item span");
});

test("invalid categories and model-invented output fields fail schema validation", () => {
  const value = extraction();
  assert.throws(() => verifyExtraction({ ...value, freebies: [{ ...value.freebies[0], category: "prize" }] }, eventPage()));
  assert.throws(() => verifyExtraction({ ...value, mapsUrl: "https://maps.google.com/fictional" }, eventPage()));
});

test("locations without matching source evidence are removed", () => {
  for (const evidence of [null, "Meet at the imaginary venue.", "   "]) {
    const result = verifyExtraction(extraction({ locationEvidence: evidence }), eventPage());
    assert.equal(result.venue, null);
    assert.equal(result.address, null);
    assert.equal(result.locationEvidence, null);
  }
});

test("geographical knowledge cannot fill in an address absent from the supplied page", () => {
  const result = verifyExtraction(extraction({ address: "999 Invented Street, London" }), eventPage());
  assert.equal(result.venue, "Room 101, Bloomsbury Theatre Building");
  assert.equal(result.address, null);
});

test("venue and address must be supported by their location quote, not unrelated page text", () => {
  const result = verifyExtraction(extraction({
    venue: "UCL East",
    address: "7 Sidings Street, London E20 2AE",
    locationEvidence,
  }), eventPage({
    text: `${sourceText}\nOur last event was at UCL East, 7 Sidings Street, London E20 2AE.`,
  }));
  assert.equal(result.venue, null);
  assert.equal(result.address, null);
});

test("only an HTTPS booking URL present in supplied links can leave the provider layer", () => {
  for (const candidate of [
    "https://studentsunionucl.org/invented-booking-page",
    "https://evil.example/collect-money",
    "http://studentsunionucl.org/events/game-night/book",
    "javascript:alert(1)",
    "data:text/html,wrong",
    "/events/game-night/book",
    "not a URL",
  ]) {
    const result = verifyExtraction(extraction({ bookingUrl: candidate }), eventPage());
    assert.equal(result.bookingUrl, null, `Must remove ${candidate}`);
  }
  assert.equal(verifyExtraction(extraction(), eventPage()).bookingUrl, bookingUrl);
});

test("askJev sends actual event text to the official endpoint and isolates credentials", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(jevResponse());
  });
  const result = await askJev(eventPage(), config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${config.jevKey}`);
  assert.equal(calls[0].init?.redirect, "manual");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.state.event_text, sourceText);
  assert.equal(body.questions.has_free_stuff.type, "noul");
  assert.equal(body.model, config.jevModel);
  assert.equal(String(calls[0].init?.body).includes(config.claudeKey), false);
  assert.equal(result.score, 0.94);
});

test("invalid Jev results fail explicitly and are not converted to a negative", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(jevResponse("false")));
  await assert.rejects(askJev(eventPage(), config), /invalid score.*not been classified/i);
});

test("askClaude sends a constrained extraction request to Anthropic, with source and links", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(claudeResponse());
  });
  const result = await askClaude(eventPage(), config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("x-api-key"), config.claudeKey);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  assert.equal(calls[0].init?.redirect, "manual");
  const body = JSON.parse(String(calls[0].init?.body));
  const suppliedPage = JSON.parse(body.messages[0].content);
  assert.equal(suppliedPage.event_text, sourceText);
  assert.deepEqual(suppliedPage.links, [bookingUrl]);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.effort, "medium");
  assert.equal(body.thinking.type, "adaptive");
  assert.equal(String(calls[0].init?.body).includes(config.jevKey), false);
  assert.equal(result.extraction.hasFreebies, true);
});

test("Claude gives invalid extraction exactly one repair generation before reporting failure", async (t) => {
  const invalidReplies = [
    claudeResponse(extraction(), "max_tokens"),
    { model: config.claudeModel, content: [] },
    { model: config.claudeModel, content: [{ type: "text", text: "not valid JSON" }] },
    claudeResponse(extraction({ hasFreebies: false })),
    claudeResponse({ hasFreebies: false }),
    claudeResponse(null),
  ];
  const replies = invalidReplies.flatMap((reply) => [reply, reply]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    assert.ok(replies.length > 0, "The repair budget must be bounded");
    return Response.json(replies.shift());
  });
  for (let i = 0; i < invalidReplies.length; i++) {
    await assert.rejects(askClaude(eventPage(), config));
    assert.equal(calls, (i + 1) * 2, "Each invalid output gets exactly one repair generation");
  }
  assert.equal(replies.length, 0);
});

test("overlong evidence can be repaired using the same complete source and explicit validation feedback", async (t) => {
  const longEvidence = "Complimentary pizza and soft drinks are provided for every student attending our evening game night, with vegetarian options also available at the event while supplies last.";
  assert.equal(longEvidence.split(/\s+/).length, 26);
  const page = eventPage({
    text: sourceText.replace("Complimentary pizza and soft drinks are provided.", longEvidence),
  });
  const overlong = extraction();
  overlong.freebies[0].evidence = longEvidence;
  assert.throws(() => verifyExtraction(overlong, page), /overlong/i);
  const corrected = extraction();
  corrected.freebies[0].evidence = "Complimentary pizza and soft drinks are provided";
  const replies = [claudeResponse(overlong), claudeResponse(corrected)];
  const requests: { messages: { content: string }[]; model: string }[] = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    assert.ok(replies.length > 0, "A valid repair must stop generation");
    return Response.json(replies.shift());
  });
  const result = await askClaude(page, config);
  assert.equal(requests.length, 2);
  assert.equal(result.extraction.hasFreebies, true);
  assert.equal(result.extraction.freebies[0].evidence, corrected.freebies[0].evidence);
  assert.equal(result.extraction.priceDetails, "Tickets cost £5 for UCL students.");
  const originalInput = JSON.parse(requests[0].messages[0].content);
  const repairInput = JSON.parse(requests[1].messages[0].content);
  for (const field of ["event_title", "event_url", "event_text", "links"]) {
    assert.deepEqual(repairInput[field], originalInput[field], `Repair must preserve ${field}`);
  }
  assert.equal(repairInput.event_text, page.text);
  assert.ok(repairInput.validation_feedback, "The repair request must say what failed");
  assert.match(JSON.stringify(repairInput.validation_feedback), /evidence|overlong|25/i);
  assert.ok(repairInput.previous_response, "The repair request must carry the invalid response as data");
  assert.equal(JSON.stringify(repairInput.previous_response).includes(longEvidence), true);
});

test("an invented quote after a repair attempt still fails and never becomes a negative result", async (t) => {
  const initial = extraction();
  initial.freebies[0].evidence = "A free laptop is provided to every attendee.";
  const repaired = extraction();
  repaired.freebies[0].evidence = "Every participant receives a complimentary tablet.";
  const replies = [claudeResponse(initial), claudeResponse(repaired)];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    assert.ok(replies.length > 0, "There must be no third generation");
    return Response.json(replies.shift());
  });
  await assert.rejects(askClaude(eventPage(), config), /source quote/i);
  assert.equal(calls, 2);
  assert.equal(replies.length, 0);
});

test("a speculative item can be repaired into a valid negative when the source offers no freebie", async (t) => {
  const readingText = "Join us for an hour of quiet reading together.";
  const page = eventPage({ title: "Quiet reading", text: readingText, description: readingText, links: [] });
  const speculative = extraction({
    freebies: [{ item: "Snacks", category: "food", evidence: readingText, certainty: "possible" }],
  });
  const corrected = extraction({
    hasFreebies: false,
    freebies: [],
    summary: "The page describes reading together and does not offer complimentary items.",
    venue: null,
    address: null,
    locationEvidence: null,
    admission: "unknown",
    priceDetails: null,
    bookingRequired: null,
    bookingUrl: null,
    eligibility: null,
    conditions: [],
  });
  const replies = [claudeResponse(speculative), claudeResponse(corrected)];
  const requests: { messages: { content: string }[] }[] = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    assert.ok(replies.length > 0, "The corrected negative must end the repair attempt");
    return Response.json(replies.shift());
  });
  const result = await askClaude(page, config);
  assert.equal(requests.length, 2);
  assert.equal(result.extraction.hasFreebies, false);
  assert.deepEqual(result.extraction.freebies, []);
  const repairInput = JSON.parse(requests[1].messages[0].content);
  assert.equal(repairInput.event_text, readingText);
  assert.match(repairInput.validation_feedback, /item|name|phrase|evidence/i);
});

test("Claude authentication errors do not trigger validation repair, even during a repair attempt", async (t) => {
  let calls = 0;
  let invalidFirst = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (invalidFirst) {
      invalidFirst = false;
      return Response.json(claudeResponse({ hasFreebies: false }));
    }
    return Response.json({}, { status: 401 });
  });
  const isAuthenticationError = (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.provider, "Claude");
    assert.equal(error.status, 401);
    assert.equal(error.fatal, true);
    return true;
  };
  await assert.rejects(askClaude(eventPage(), config), isAuthenticationError);
  assert.equal(calls, 1);
  invalidFirst = true;
  await assert.rejects(askClaude(eventPage(), config), isAuthenticationError);
  assert.equal(calls, 3, "Invalid extraction plus a failed repair request uses only two calls");
});

test("authentication rejection stops immediately without exposing credentials in errors", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: "Do not copy provider bodies to the dashboard." }, { status: 401 });
  });
  await assert.rejects(askJev(eventPage(), config), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.status, 401);
    assert.equal(error.fatal, true);
    assert.equal(error.message.includes(config.jevKey), false);
    assert.equal(error.message.includes(config.claudeKey), false);
    assert.equal(error.message.includes("Do not copy"), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("a transient rate limit retries the same event request and returns its real score", async (t) => {
  const bodies: string[] = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) return Response.json({}, { status: 429, headers: { "retry-after": "0.001" } });
    return Response.json(jevResponse(0.82));
  });
  const result = await askJev(eventPage(), config);
  assert.equal(result.score, 0.82);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("long Retry-After values stay retriable failures without retrying before the provider allows", async (t) => {
  const headers = ["30", new Date(Date.now() + 60_000).toUTCString()];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const retryAfter = headers[calls];
    calls++;
    return Response.json({}, { status: 429, headers: { "retry-after": retryAfter } });
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(askJev(eventPage(), config), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 429);
      assert.equal(error.fatal, false);
      return true;
    });
    assert.equal(calls, i + 1);
  }
});

test("exhausted transient retries remain failures rather than rejecting the event as no freebies", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({}, { status: 529, headers: { "retry-after": "0.001" } });
  });
  await assert.rejects(askClaude(eventPage(), config), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.status, 529);
    assert.equal(error.fatal, false);
    return true;
  });
  assert.equal(calls, 3);
});
