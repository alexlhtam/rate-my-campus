import type { EventPage, SourceEvent } from "./types";

const ORIGIN = "https://studentsunionucl.org";
const ZONE = "Europe/London";
export const MAX_SOURCE_BYTES = 3 * 1024 * 1024;
export const MAX_EVENT_TEXT_LENGTH = 150_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;

export interface DiscoveryPage {
  events: SourceEvent[];
  /** All source rows, before window filtering and ticket-variation deduplication. */
  rawCount: number;
  /** True only when the upstream page itself contains zero rows. */
  done: boolean;
  warnings: string[];
}

function validDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Use dates in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return parsed;
}

/** Calendar date in London, regardless of the worker's local timezone. */
export function londonDate(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid date.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Add calendar days, not elapsed 24-hour periods. */
export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error("Days must be a whole number.");
  const parsed = validDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Date is outside the supported range.");
  return parsed.toISOString().slice(0, 10);
}

/** Convert London midnight to UTC, including BST/GMT changes. */
export function londonMidnight(date: string): Date {
  const desired = validDate(date).getTime();
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const part = (name: string) => parts.find((value) => value.type === name)?.value;
    const represented = Date.parse(
      `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`,
    );
    if (represented === desired) return new Date(candidate);
    candidate += desired - represented;
  }
  throw new Error(`Could not resolve London midnight for ${date}.`);
}

function windowSeconds(startDate: string, endDate: string): [number, number] {
  const start = londonMidnight(startDate).getTime() / 1000;
  const end = londonMidnight(endDate).getTime() / 1000;
  if (end <= start) throw new Error("The exclusive end date must be after the start date.");
  return [start, end];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  pound: "£", euro: "€", copy: "©", reg: "®", trade: "™",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", bull: "•", middot: "·", ensp: " ", emsp: " ", thinsp: " ",
};

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : "�";
    }
    return ENTITIES[entity] ?? whole;
  });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return decodeHtml(value).replace(/\s+/g, " ").trim() || null;
}

function sourceUrl(value: string, base = ORIGIN): URL {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || url.hostname !== "studentsunionucl.org"
      || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("UCL source requests must use https://studentsunionucl.org.");
  }
  url.hash = "";
  return url;
}

function unixSeconds(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 253_402_300_799
    ? number : null;
}

function idString(value: unknown): string | null {
  const string = typeof value === "number" ? String(value) : value;
  return typeof string === "string" && /^\d+$/.test(string) ? string : null;
}

/** Pure parser for the anonymous calendar endpoint. endDate is EXCLUSIVE. */
export function parseCalendarPage(data: unknown, startDate: string, endDate: string): DiscoveryPage {
  const [windowStart, windowEnd] = windowSeconds(startDate, endDate);
  let rows: unknown[];
  if (Array.isArray(data)) rows = data;
  else if (isObject(data)) {
    const keys = Object.keys(data).filter((key) => key !== "#cache");
    if (!keys.every((key) => /^\d+$/.test(key))) {
      throw new Error("UCL calendar returned an unexpected JSON object, not an event page.");
    }
    rows = keys.map((key) => data[key]);
  } else {
    throw new Error("UCL calendar returned an invalid response, not an event array.");
  }

  const warnings: string[] = [];
  const events = new Map<string, SourceEvent>();
  rows.forEach((value, index) => {
    const label = `Source row ${index + 1}`;
    if (!isObject(value)) {
      warnings.push(`${label}: invalid event record; coverage is incomplete.`);
      return;
    }
    const start = unixSeconds(value.field_date_range_value);
    const end = unixSeconds(value.field_date_range_end_value);
    if (start === null || end === null || end < start) {
      warnings.push(`${label}: missing or invalid event dates; coverage is incomplete.`);
      return;
    }
    // The endpoint can return events beyond the requested end date. Filter locally.
    // Keep ongoing events; a point event at the beginning also belongs in the window.
    if (start >= windowEnd || end < windowStart || (end === windowStart && start < end)) return;
    const productId = idString(value.product_id);
    const variationId = idString(value.variation_id);
    const title = cleanString(value.title);
    if (!productId || !variationId || !title || typeof value.variation_url !== "string") {
      warnings.push(`${label}: missing event identity, title or URL; coverage is incomplete.`);
      return;
    }
    let url: URL;
    try {
      url = sourceUrl(value.variation_url);
      if (!url.pathname.startsWith("/whats-on/") && !/^\/product\/\d+\/?$/.test(url.pathname)) {
        throw new Error("Not an event page.");
      }
      // This selects the date/occurrence on products with recurring variations.
      url.search = "";
      url.searchParams.set("v", variationId);
    } catch {
      warnings.push(`${label}: invalid UCL event URL; coverage is incomplete.`);
      return;
    }
    const id = `${productId}:${start}:${end}`;
    if (events.has(id)) return;
    let imageUrl: string | null = null;
    const image = cleanString(value.field_event_image_card) || cleanString(value.field_event_image_banner);
    if (image) {
      try { imageUrl = sourceUrl(image).toString(); } catch { /* Optional external image omitted. */ }
    }
    events.set(id, {
      id, url: url.toString(), title,
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      imageUrl, sourceLocation: cleanString(value.field_event_venue__label),
    });
  });
  return { events: [...events.values()], rawCount: rows.length, done: rows.length === 0, warnings };
}

interface SourceResponse { text: string; url: string }

/** Restricted, streaming, bounded fetch, with redirects checked before every hop. */
async function fetchSource(urlValue: string, kind: "json" | "html"): Promise<SourceResponse> {
  let url = sourceUrl(urlValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(url.toString(), {
        method: "GET", credentials: "omit", redirect: "manual", signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UCLFreebieRadar/1.0; public event research)",
          Accept: kind === "json" ? "application/json" : "text/html,application/xhtml+xml",
        },
      });
      if (response.url) sourceUrl(response.url);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop === MAX_REDIRECTS) throw new Error("UCL source redirect could not be resolved.");
        url = sourceUrl(location, url.toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`UCL source returned HTTP ${response.status}.`);
      }
      const type = response.headers.get("content-type")?.toLowerCase() || "";
      const expected = kind === "json" ? /\bapplication\/(?:[\w.-]+\+)?json\b/ : /\b(?:text\/html|application\/xhtml\+xml)\b/;
      if (!expected.test(type)) {
        await response.body?.cancel();
        throw new Error(`UCL source returned ${type || "no content type"}; expected ${kind}.`);
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize > MAX_SOURCE_BYTES) {
        await response.body?.cancel();
        throw new Error("UCL source exceeds the 3 MiB limit; it was not partially analysed.");
      }
      if (!response.body) throw new Error("UCL source returned an empty response body.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_SOURCE_BYTES) {
            await reader.cancel();
            throw new Error("UCL source exceeds the 3 MiB limit; it was not partially analysed.");
          }
          parts.push(decoder.decode(value, { stream: true }));
        }
        parts.push(decoder.decode());
      } finally {
        reader.releaseLock();
      }
      return { text: parts.join(""), url: url.toString() };
    }
    throw new Error("UCL source exceeded the redirect limit.");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("UCL source request timed out after 20 seconds.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverPage(startDate: string, endDate: string, page: number): Promise<DiscoveryPage> {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error("Source page must be a non-negative integer.");
  const [start, end] = windowSeconds(startDate, endDate);
  const response = await fetchSource(`${ORIGIN}/json/anon/whats-on/${start}/${end}/list/${page}`, "json");
  let data: unknown;
  try { data = JSON.parse(response.text); }
  catch { throw new Error("UCL calendar returned invalid JSON; discovery is incomplete."); }
  return parseCalendarPage(data, startDate, endDate);
}

interface HtmlElement { tag: string; attrs: Record<string, string>; outer: string; inner: string }
// Quote-aware tokens preserve nested divs and attributes containing > characters.
const TAG_SOURCE = String.raw`<\/?([A-Za-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>`;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const source = tag.replace(/^<\/?[\w:-]+/, "").replace(/\/?\s*>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function hasClass(attrs: Record<string, string>, name: string): boolean {
  return (attrs.class || "").split(/\s+/).includes(name);
}

function removeNonContent(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

function findElement(html: string, predicate: (tag: string, attrs: Record<string, string>) => boolean): HtmlElement | null {
  const pattern = new RegExp(TAG_SOURCE, "g");
  let opening: { tag: string; attrs: Record<string, string>; start: number; end: number } | null = null;
  let depth = 0;
  for (const match of html.matchAll(pattern)) {
    const token = match[0];
    const tag = match[1].toLowerCase();
    const closing = token.startsWith("</");
    const selfClosing = VOID_TAGS.has(tag) || /\/\s*>$/.test(token);
    if (!opening) {
      if (closing) continue;
      const attrs = attributes(token);
      if (!predicate(tag, attrs)) continue;
      opening = { tag, attrs, start: match.index!, end: match.index! + token.length };
      if (selfClosing) return { tag, attrs, outer: token, inner: "" };
      depth = 1;
    } else if (tag === opening.tag) {
      if (closing) depth -= 1;
      else if (!selfClosing) depth += 1;
      if (depth === 0) {
        return {
          tag: opening.tag, attrs: opening.attrs,
          outer: html.slice(opening.start, match.index! + token.length),
          inner: html.slice(opening.end, match.index!),
        };
      }
    }
  }
  if (opening) throw new Error(`UCL page has an unclosed ${opening.tag} element; content was not truncated.`);
  return null;
}

export function htmlToText(html: string): string {
  const clean = removeNonContent(html).replace(new RegExp(TAG_SOURCE, "g"), (token: string, tag: string) => {
    const lower = tag.toLowerCase();
    if (lower === "img") {
      const alt = attributes(token).alt?.trim();
      return alt ? ` [Image: ${alt}] ` : "";
    }
    if (/^(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)$/.test(lower)) {
      return "\n";
    }
    return "";
  });
  return decodeHtml(clean).replace(/[\t\r\f\v \u00a0]+/g, " ")
    .split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function publicLink(value: unknown, base: string): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function htmlLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(new RegExp(TAG_SOURCE, "g"))) {
    if (match[1].toLowerCase() !== "a" || match[0].startsWith("</")) continue;
    const link = publicLink(attributes(match[0]).href, base);
    if (link) links.add(link);
  }
  return [...links];
}

function jsonLdEvent(html: string, event: SourceEvent): Record<string, unknown> | null {
  const candidates: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 12) return;
    if (Array.isArray(value)) value.forEach((child) => visit(child, depth + 1));
    else if (isObject(value)) {
      const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      if (types.some((type) => typeof type === "string" && /(?:^|:)\w*Event$/.test(type))) candidates.push(value);
      if (value["@graph"]) visit(value["@graph"], depth + 1);
      if (value.mainEntity) visit(value.mainEntity, depth + 1);
    }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(`<script${match[1]}>`).type?.toLowerCase() !== "application/ld+json") continue;
    try { visit(JSON.parse(match[2])); } catch { /* Use the complete visible event article if JSON-LD is malformed. */ }
  }
  return candidates.find((candidate) => isoDate(candidate.startDate) === event.start) || candidates[0] || null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jsonLocation(value: unknown): string | null {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(jsonLocation).filter(Boolean).join("; ") || null;
  if (!isObject(value)) return null;
  const pieces = [cleanString(value.name)];
  if (typeof value.address === "string") pieces.push(cleanString(value.address));
  else if (isObject(value.address)) {
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
      pieces.push(cleanString(value.address[key]));
    }
  }
  return pieces.filter(Boolean).join(", ") || null;
}

/** Extract the full main event article and its separate booking/price block. */
export function parseEventPage(html: string, event: SourceEvent, finalUrl = event.url): EventPage {
  sourceUrl(finalUrl);
  if (new TextEncoder().encode(html).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("UCL page exceeds the 3 MiB limit; it was not partially analysed.");
  }
  const structured = jsonLdEvent(html, event);
  const clean = removeNonContent(html);
  const main = findElement(clean, (_, attrs) => hasClass(attrs, "block-system-main-block"))
    || findElement(clean, (tag, attrs) => tag === "main" || attrs.id === "main-content");
  const article = findElement(main?.inner || clean, (tag) => tag === "article");
  const body = article && findElement(article.inner, (_, attrs) => hasClass(attrs, "field--name-body"));
  const structuredDescription = typeof structured?.description === "string" ? htmlToText(structured.description) : "";
  const description = body ? htmlToText(body.inner) : structuredDescription;
  if (!description) {
    throw new Error("UCL page has no readable event description; manual or image review is required.");
  }
  if (!article && !structured) {
    throw new Error("UCL page is missing its event article; it may be an error or sign-in page.");
  }
  const titleElement = findElement(clean, (tag) => tag === "h1");
  const title = (titleElement && htmlToText(titleElement.inner)) || cleanString(structured?.name) || event.title;
  const venue = article && findElement(article.inner, (_, attrs) => hasClass(attrs, "field--name-field-event-venue"));
  const location = (venue && htmlToText(venue.inner)) || jsonLocation(structured?.location) || event.sourceLocation;
  const dateBlock = article && findElement(article.inner, (_, attrs) => hasClass(attrs, "field--name-field-date-range"));
  const times: string[] = [];
  for (const match of (dateBlock?.inner || "").matchAll(new RegExp(TAG_SOURCE, "g"))) {
    if (match[1].toLowerCase() !== "time" || match[0].startsWith("</")) continue;
    const date = isoDate(attributes(match[0]).datetime);
    if (date) times.push(date);
  }
  const start = times[0] || isoDate(structured?.startDate) || event.start;
  const end = times[1] || isoDate(structured?.endDate) || event.end;
  const booking = findElement(clean, (_, attrs) => attrs.id === "block-eventaddtocartblock"
    || hasClass(attrs, "block-event-add-to-cart-block"));
  const articleText = article ? htmlToText(article.inner) : description;
  const bookingText = booking ? htmlToText(booking.inner) : "";
  const links = new Set(htmlLinks(`${article?.inner || ""}\n${booking?.inner || ""}`, finalUrl));
  if (booking) links.add(`${finalUrl.split("#")[0]}#block-eventaddtocartblock`);
  const offers = structured?.offers;
  for (const offer of Array.isArray(offers) ? offers : [offers]) {
    if (isObject(offer)) {
      const url = publicLink(offer.url, finalUrl);
      if (url) links.add(url);
    }
  }
  const structuredFacts = structured ? Object.fromEntries(
    ["name", "startDate", "endDate", "location", "offers", "eventStatus", "eventAttendanceMode", "audience", "organizer"]
      .filter((key) => structured[key] !== undefined).map((key) => [key, structured[key]]),
  ) : null;
  const text = [
    `Title: ${title}`, `Source: ${finalUrl}`, `Starts: ${start}`, end ? `Ends: ${end}` : "",
    location ? `Location: ${location}` : "Location: not stated",
    "Event page:", articleText,
    bookingText ? `\nBooking and price information:\n${bookingText}` : "",
    structuredDescription && structuredDescription !== description ? `\nStructured description:\n${structuredDescription}` : "",
    structuredFacts ? `\nStructured event metadata:\n${JSON.stringify(structuredFacts)}` : "",
    links.size ? `\nLinks on the event page:\n${[...links].join("\n")}` : "",
  ].filter(Boolean).join("\n");
  if (text.length > MAX_EVENT_TEXT_LENGTH) {
    throw new Error(`UCL event text exceeds ${MAX_EVENT_TEXT_LENGTH.toLocaleString("en-GB")} characters; it was not truncated or partially analysed.`);
  }
  return { title, url: finalUrl, text, location, description, links: [...links], start, end };
}

export async function fetchEventPage(event: SourceEvent): Promise<EventPage> {
  const response = await fetchSource(event.url, "html");
  return parseEventPage(response.text, event, response.url);
}
