export type Category = "food" | "drinks" | "merch" | "vouchers" | "materials" | "other";
export type EventStatus = "queued" | "no_freebies" | "found" | "needs_review" | "failed" | "out_of_window";
export type RunStatus = "discovering" | "running" | "paused" | "complete" | "partial" | "failed";

export interface Freebie {
  item: string;
  category: Category;
  evidence: string;
  certainty: "confirmed" | "possible";
}

export interface Extraction {
  society?: { name: string; evidence: string } | null;
  dietary?: { tag: "Vegan" | "Vegetarian" | "Halal" | "Gluten-free"; evidence: string }[];
  attendance?: "in_person" | "online" | "hybrid" | "unknown";
  attendanceEvidence?: string | null;
  hasFreebies: boolean;
  summary: string;
  freebies: Freebie[];
  venue: string | null;
  address: string | null;
  locationEvidence: string | null;
  admission: "free" | "paid" | "mixed" | "unknown";
  priceDetails: string | null;
  bookingRequired: boolean | null;
  bookingUrl: string | null;
  eligibility: string | null;
  conditions: string[];
}

export interface EventRecord {
  id: string;
  url: string;
  title: string;
  start: string;
  end: string | null;
  status: EventStatus;
  jevScore: number | null;
  jevModel: string | null;
  claudeModel: string | null;
  extraction: Extraction | null;
  error: string | null;
  failedStage: "fetch" | "jev" | "claude" | "publish" | null;
  attempts: number;
  checkedAt: string | null;
  publishedPostId?: string | null;
  publicationState?: string | null;
  imageUrl: string | null;
  sourceLocation: string | null;
}

export interface ScanRun {
  id: string;
  startDate: string;
  endDate: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  discovered: number;
  processed: number;
  found: number;
  failed: number;
  queued: number;
  rejected: number;
  needsReview: number;
  sourcePages: number;
  coverageComplete: boolean;
  sourceCount: number;
  error: string | null;
  warnings: string[];
}

export interface Dashboard {
  configured: { jev: boolean; claude: boolean };
  models: { jev: string; claude: string };
  defaultStart: string;
  threshold: number;
  run: ScanRun | null;
  events: EventRecord[];
}

export interface SourceEvent {
  id: string;
  url: string;
  title: string;
  start: string;
  end: string | null;
  imageUrl: string | null;
  sourceLocation: string | null;
  /** Explicit public calendar metadata; absent in older checkpoints. */
  sourceOrganizer?: string | null;
  sourceOnline?: boolean | null;
}

export interface EventPage {
  title: string;
  url: string;
  text: string;
  location: string | null;
  description: string;
  links: string[];
  start: string | null;
  end: string | null;
}
