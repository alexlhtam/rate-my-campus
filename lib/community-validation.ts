import { FOOD_ALLERGENS, type FoodDetails } from "./food";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = "HttpError"; this.status = status; }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected an object.");
  return value as Record<string, unknown>;
}

export function textField(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const cleaned = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (cleaned.length < min || cleaned.length > max) throw new HttpError(400, `${label} must be ${min}–${max} characters.`);
  return cleaned;
}

export function safeId(value: unknown, label = "ID"): string {
  const id = textField(value, label, 1, 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpError(400, `${label} is invalid.`);
  return id;
}

export function uclEmail(value: unknown): string {
  const email = textField(value, "Email", 8, 254).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ucl\.ac\.uk$/.test(email)) throw new HttpError(400, "Use your @ucl.ac.uk email address.");
  return email;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "Open Rate Our Campus directly to make this request.");
  }
}

export function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  return value;
}

export function stringList(value: unknown, label: string, allowed?: readonly string[], max = 8): string[] {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `${label} must be a list with at most ${max} entries.`);
  const list = [...new Set(value.map((item) => textField(item, label, 1, 45)))];
  if (allowed && list.some((item) => !allowed.includes(item))) throw new HttpError(400, `${label} contains an unknown option.`);
  return list;
}

export const criterionGroups = {
  building: ["comfort", "wifi", "accessibility"],
  lecture: ["comfort", "plugs", "wifi", "noise", "accessibility"],
  study: ["comfort", "plugs", "wifi", "noise", "accessibility"],
  accommodation: ["value", "cleanliness", "social", "staff", "location"],
  rental: ["landlord", "deposit", "damp", "value", "noise"],
} as const;

export function communityRequestInput(body: Record<string, unknown>) {
  const kind = textField(body.kind, "Request type", 1, 20);
  if (kind !== "correction" && kind !== "takedown") throw new HttpError(400, "Choose a correction or privacy request.");
  const contact = body.contact ? textField(body.contact, "Contact email", 5, 254).toLowerCase() : null;
  if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new HttpError(400, "Enter a valid contact email.");
  let evidenceUrl: string | null = null;
  if (body.evidenceUrl) {
    const value = textField(body.evidenceUrl, "Evidence link", 1, 1000);
    let url: URL;
    try { url = new URL(value); } catch { throw new HttpError(400, "Use a public HTTPS evidence link."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(400, "Use a public HTTPS evidence link.");
    evidenceUrl = url.toString();
  }
  return { kind, targetId: safeId(body.targetId || "general", "Place or contribution reference"), contact,
    reason: textField(body.reason, "Details", 10, 2000), evidenceUrl };
}

export function collectionUpdateInput(body: Record<string, unknown>) {
  const instructions = textField(body.collectionInstructions ?? "", "Collection instructions", 0, 500);
  const privacy = privateInformationReason(instructions);
  if (privacy) throw new HttpError(400, privacy);
  const portions = body.portionsRemaining == null || body.portionsRemaining === "" ? null : finiteNumber(body.portionsRemaining, "Portions remaining", 0, 10000);
  if (portions !== null && !Number.isInteger(portions)) throw new HttpError(400, "Enter a whole number of portions.");
  return { instructions, portions };
}

export function foodDetailsInput(value: unknown): FoodDetails {
  const details = value == null ? {} : record(value);
  const allergenStatus = details.allergenStatus ?? "unknown";
  if (allergenStatus !== "unknown" && allergenStatus !== "provided") throw new HttpError(400, "Choose whether allergen information is provided or unknown.");
  const allergens = stringList(details.allergens ?? [], "Allergens", FOOD_ALLERGENS.map((item) => item.id), 14) as FoodDetails["allergens"];
  if (allergenStatus === "unknown" && allergens.length) throw new HttpError(400, "Only list allergens when the sharer has provided this information.");
  const pickupAccess = details.pickupAccess ?? "ask";
  if (pickupAccess !== "ucl" && pickupAccess !== "public" && pickupAccess !== "ask") throw new HttpError(400, "Choose who can access the collection point.");
  if (details.bringContainer !== undefined && typeof details.bringContainer !== "boolean") throw new HttpError(400, "Choose whether to bring a container.");
  const ingredients = textField(details.ingredients ?? "", "Ingredients", 0, 500);
  if (allergenStatus === "provided" && !allergens.length && !ingredients) throw new HttpError(400, "List the declared allergens or provide ingredient information, or choose unknown.");
  const handling = textField(details.handling ?? "", "Storage and handling information", 0, 300);
  const sourceLabel = textField(details.sourceLabel ?? "", "Organisation or event name", 0, 100);
  const privacy = privateInformationReason([ingredients, handling, sourceLabel].join("\n"));
  if (privacy) throw new HttpError(400, privacy);
  return { allergenStatus, allergens, ingredients, handling, sourceLabel, pickupAccess, bringContainer: details.bringContainer === true };
}

export function foodPortions(value: unknown, allowZero = false): number | null {
  if (value == null) return null;
  const portions = finiteNumber(value, "Portions remaining", allowZero ? 0 : 1, 10000);
  if (!Number.isInteger(portions)) throw new HttpError(400, "Enter a whole number of portions.");
  return portions;
}

export function foodRevision(value: unknown): number {
  const revision = finiteNumber(value, "Alert version", 0, 2147483647);
  if (!Number.isInteger(revision)) throw new HttpError(400, "Refresh this alert before updating it.");
  return revision;
}

export function reviewInput(body: Record<string, unknown>, category?: keyof typeof criterionGroups) {
  const rating = finiteNumber(body.rating, "Rating", 1, 5);
  if (!Number.isInteger(rating)) throw new HttpError(400, "Choose a whole-star rating.");
  const criteria = record(body.criteria ?? {});
  const permitted: readonly string[] = category ? criterionGroups[category] : Object.values(criterionGroups).flat();
  if (Object.keys(criteria).length > 5) throw new HttpError(400, "Choose at most five criteria.");
  for (const [key, value] of Object.entries(criteria)) {
    if (!permitted.includes(key)) throw new HttpError(400, "Unknown review criterion.");
    finiteNumber(value, "Criterion score", 1, 5);
  }
  if (typeof body.recommend !== "boolean") throw new HttpError(400, "Choose whether you recommend this place.");
  return {
    placeId: safeId(body.placeId, "Place"), rating, criteria,
    tags: stringList(body.tags ?? [], "Tags"), text: textField(body.text ?? "", "Review", 0, 2500),
    term: textField(body.term, "Term and year", 4, 50), recommend: body.recommend,
  };
}

export function postInput(body: Record<string, unknown>, now = Date.now(), trusted: {unionImport?:boolean} = {}) {
  const type = textField(body.type, "Type", 1, 10);
  // General events come only from the source-grounded Union pipeline. Neither
  // client flags nor the legacy manual-freebie import can grant that provenance.
  if (!["food", "deal", "freebie"].includes(type)) throw new HttpError(400, "Choose a food alert, deal or freebie.");
  const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : Date.parse(String(body.expiresAt));
  const union = trusted.unionImport === true && type === "freebie" && !!body.sourceUrl;
  const max = type === "food" ? 6 * 3600000 : (union ? 14 : 7) * 86400000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + max) throw new HttpError(400, type === "food" ? "Food alerts must expire within six hours." : union ? "Union events must expire within fourteen days." : "Posts must expire within seven days.");
  const startsAt = body.startsAt == null || body.startsAt === "" ? null : typeof body.startsAt === "number" ? body.startsAt : Date.parse(String(body.startsAt));
  if (startsAt !== null && (!Number.isFinite(startsAt) || startsAt >= expiresAt)) throw new HttpError(400, "The start time must be before the expiry time.");
  if (type === "food" && startsAt !== null && startsAt > now) throw new HttpError(400, "Leftover food must be available now. Post the alert when collection starts.");
  if (type === "food" && body.locationConfirmed !== true) throw new HttpError(400, "Confirm the food collection point on the map.");
  if (type === "food" && body.foodSafetyAcknowledged !== true) throw new HttpError(400, "Confirm the food sharing safety notice before posting.");
  const collectionInstructions = type === "food" ? textField(body.collectionInstructions, "Collection instructions", 5, 500) : "";
  const portionsRemaining = type === "food" ? foodPortions(body.portionsRemaining) : null;
  const foodDetails = type === "food" ? foodDetailsInput(body.foodDetails) : null;
  let sourceUrl: string | null = null;
  if (body.sourceUrl != null && body.sourceUrl !== "") {
    const source = textField(body.sourceUrl, "Source URL", 1, 500);
    let parsed: URL;
    try { parsed = new URL(source); } catch { throw new HttpError(400, "Use a public Students’ Union UCL event URL."); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "studentsunionucl.org" || parsed.port || !/^\/whats-on\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?$/i.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password) throw new HttpError(400, "Use a public Students’ Union UCL event URL.");
    sourceUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  }
  const photoKey = body.photoKey == null || body.photoKey === "" ? null : textField(body.photoKey, "Photo", 1, 150);
  if (photoKey && !/^photos\/[a-f0-9-]+\.(jpg|png|webp)$/.test(photoKey)) throw new HttpError(400, "Upload the photo again.");
  if (type === "deal" && !photoKey) throw new HttpError(400, "A photo is required for a deal.");
  const price = body.price == null || body.price === "" ? null : finiteNumber(body.price, "Price", 0, 100000);
  const originalPrice = body.originalPrice == null || body.originalPrice === "" ? null : finiteNumber(body.originalPrice, "Original price", 0.01, 100000);
  if (price !== null && originalPrice !== null && price >= originalPrice) throw new HttpError(400, "The deal price must be lower than the original price.");
  return {
    type, title: textField(body.title, "Title", 3, 100), description: textField(body.description ?? "", "Description", 0, 1500),
    location: textField(body.location, "Location", 3, 150),
    lat: finiteNumber(body.lat, "Latitude", 51.35, 51.68), lng: finiteNumber(body.lng, "Longitude", -0.35, 0.1),
    startsAt, expiresAt, sourceUrl, sourceName: sourceUrl ? "Students’ Union UCL" : null,
    dietary: stringList(body.dietary ?? [], "Dietary tags", ["vegetarian", "vegan", "halal", "gluten-free", "dairy-free", "unknown"]),
    photoKey, price, originalPrice, collectionInstructions, portionsRemaining, foodDetails,
  };
}

export function privateInformationReason(text: string, privateHome = false): string | null {
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text) || /(?:\+44\s?7|\b07)\d[\d\s()-]{7,}\d/.test(text)) return "Please remove personal contact details.";
  if (/\b(?:flat|apartment|unit)\s*(?:no\.?\s*|#\s*)?\d+[a-z]?\b/i.test(text) || (privateHome && /\broom\s*(?:no\.?\s*|#\s*)?\d+[a-z]?\b/i.test(text))) return "Please remove exact flat or room numbers.";
  return null;
}

export async function readLimitedBody(request: Request, max: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max) throw new HttpError(413, "The upload is too large.");
  if (!request.body) throw new HttpError(400, "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, "The upload is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function imageType(bytes: Uint8Array): { mime: string; extension: string } {
  if (bytes.length < 12) throw new HttpError(400, "Choose a valid JPEG, PNG or WebP image.");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return { mime: "image/png", extension: "png" };
  if (new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  throw new HttpError(400, "Choose a valid JPEG, PNG or WebP image.");
}

// Strip metadata such as camera GPS before the photo enters durable storage.
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  if (mime === "image/jpeg") {
    chunks.push(bytes.slice(0, 2));
    let pos = 2;
    while (pos < bytes.length) {
      if (bytes[pos] !== 0xff || pos + 3 >= bytes.length) throw new HttpError(400, "Invalid JPEG image.");
      const marker = bytes[pos + 1];
      if (marker === 0xda || marker === 0xd9) { chunks.push(bytes.slice(pos)); break; }
      const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (length < 2 || pos + length + 2 > bytes.length) throw new HttpError(400, "Invalid JPEG image.");
      if (!(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe) chunks.push(bytes.slice(pos, pos + length + 2));
      pos += length + 2;
    }
  } else if (mime === "image/png") {
    chunks.push(bytes.slice(0, 8));
    let pos = 8;
    const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "acTL", "fcTL", "fdAT"]);
    while (pos + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + pos, 4).getUint32(0);
      if (pos + length + 12 > bytes.length) throw new HttpError(400, "Invalid PNG image.");
      const name = decoder.decode(bytes.slice(pos + 4, pos + 8));
      if (allowed.has(name)) chunks.push(bytes.slice(pos, pos + length + 12));
      pos += length + 12;
      if (name === "IEND") break;
    }
  } else {
    chunks.push(bytes.slice(0, 12));
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + pos + 4, 4).getUint32(0, true);
      const padded = length + (length % 2);
      if (pos + 8 + padded > bytes.length) throw new HttpError(400, "Invalid WebP image.");
      const name = decoder.decode(bytes.slice(pos, pos + 4));
      if (name !== "EXIF" && name !== "XMP ") {
        const chunk = bytes.slice(pos, pos + 8 + padded);
        if (name === "VP8X" && length > 0) chunk[8] &= ~0x0c;
        chunks.push(chunk);
      }
      pos += 8 + padded;
    }
  }
  const output = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (mime === "image/webp") new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return output;
}
