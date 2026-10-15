/**
 * Demo community content is deliberately synthetic. Never import these records
 * into a production ratings aggregate or present them as verified submissions.
 * Matched coordinates are representative footprint points, not room entrances.
 * Unmatched public places remain unlocated; only the fictional rental uses an area pin.
 */
import campusDirectory from '../public/data/campus-directory.json';
import footprintIndex from '../public/data/campus-footprint-index.json';
import type { CampusBuilding } from './campus-map-model';

export type PlaceCategory = "study" | "lecture" | "halls" | "rental" | "building";
export type PinType = "freebie" | "event" | "food" | "deal";

export interface Place {
  id: string;
  /** Stable official-directory join; multiple reviewed rooms may share a building. */
  campusBuildingId?: string;
  /** Rooms and libraries have a separate review target from their building. */
  parentPlaceId?: string;
  aliases?: string[];
  campus?: string;
  locationStatus?: 'footprint' | 'official' | 'unlocated' | 'demo-area';
  membershipNote?: string;
  currentAccommodation?: boolean;
  /** Verified arrival guidance, never a generated route or inferred entrance point. */
  visitGuide?: {text: string; sourceUrl: string; checkedAt: string}[];
  name: string;
  category: PlaceCategory;
  lat?: number;
  lng?: number;
  address: string;
  description: string;
  image: string;
  imageCredit?: string;
  tags: string[];
  openLabel: string;
  /** Illustrative walking time from UCL's main campus, not user's location. */
  distance: string;
  criteria: string[];
  sourceUrl?: string;
  demo?: boolean;
}

export interface Review {
  id: string;
  placeId: string;
  rating: number;
  recommend: boolean;
  text: string;
  tags: string[];
  term: string;
  year: number;
  criteria: Record<string, number>;
  demo: true;
  helpful: number;
}

export interface Pin {
  id: string;
  /** Present only when this demo alert names a verified campus building. */
  campusBuildingId?: string;
  type: PinType;
  title: string;
  description: string;
  location: string;
  lat: number;
  lng: number;
  dietary: string[];
  /** Demo countdown starts when a demo session begins; never a real event time. */
  durationMinutes: number;
  /** Optional fictional start offset from the same private demo session. */
  startsInMinutes?: number;
  image?: string;
  imageCredit?: string;
  price?: number;
  originalPrice?: number;
  demo: true;
  sourceUrl?: string;
  organizer?: string;
}

export interface Thread {
  id: string;
  placeId: string;
  title: string;
  text: string;
  replies: number;
  demo: true;
}

export const categoryLabels: Record<PlaceCategory, string> = {
  study: "Study spaces", lecture: "Lecture halls", halls: "Student halls", rental: "Rentals", building: "Campus buildings",
};

export const categoryCriteria: Record<PlaceCategory, string[]> = {
  building: ["Comfort", "Wi-Fi", "Accessibility"],
  study: ["Comfort", "Plug sockets", "Wi-Fi", "Noise", "Accessibility"],
  lecture: ["Comfort", "Plug sockets", "Wi-Fi", "Noise", "Accessibility"],
  halls: ["Value", "Cleanliness", "Social life", "Staff", "Location"],
  rental: ["Responsiveness", "Deposit returned", "Damp or mould", "Value", "Noise"],
};

/** Stable API/form keys; keep presentation labels in categoryCriteria. */
export const categoryCriterionKeys: Record<PlaceCategory, string[]> = {
  building: ["comfort", "wifi", "accessibility"],
  study: ["comfort", "plugs", "wifi", "noise", "accessibility"],
  lecture: ["comfort", "plugs", "wifi", "noise", "accessibility"],
  halls: ["value", "cleanliness", "social", "staff", "location"],
  rental: ["landlord", "deposit", "damp", "value", "noise"],
};

export const demoNotice = "Illustrative demo: ratings, reviews, alerts and deals are fictional. Places are real unless labelled otherwise.";
export const campusCenter = { lat: 51.5246, lng: -0.1331 };

const originalPlaces: Place[] = [
  {
    id: "student-centre", campusBuildingId: "ucl-student-centre", name: "UCL Student Centre", category: "study",
    lat: 51.5247529, lng: -0.1326144, address: "27–28 Gordon Square, Bloomsbury",
    description: "A light-filled home for individual study and group work, right in the heart of campus. Bring your UCL ID and check whether your preferred space needs booking.",
    image: "/images/student-centre.jpg", imageCredit: "student-centre",
    tags: ["Group study", "Individual study", "Quiet areas", "UCL ID required"], openLabel: "UCL ID required", distance: "2 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/student-centre",
  },
  {
    id: "main-library", campusBuildingId: "ucl-wilkins-building", name: "UCL Main Library", category: "study",
    lat: 51.5246607, lng: -0.1338349, address: "Wilkins Building, Gower Street",
    description: "The historic library in the Wilkins Building, with collections and study spaces at the centre of UCL's Bloomsbury campus.",
    image: "/images/main-quad.jpg", imageCredit: "main-quad",
    tags: ["Library", "Quiet study", "Main campus", "UCL ID required"], openLabel: "Check opening hours", distance: "1 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/main-library",
    visitGuide: [{text: "The library is on the first floor of the Wilkins Building. A lift is near the library entrance, but some collection areas have access restrictions; check the library's accessibility information before visiting.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/main-library", checkedAt: "2026-10-12"}],
  },
  {
    id: "archaeology-library", campusBuildingId: "ucl-institute-of-archaeology", name: "Institute of Archaeology Library", category: "study",
    aliases: ["Archaeology Library", "Archeology Library", "Institute of Archeology Library", "IoA Library"],
    address: "Fifth floor, Institute of Archaeology, 31–34 Gordon Square, WC1H 0PY",
    description: "UCL's archaeology and heritage library is on the fifth floor of the Institute of Archaeology. Bookable quiet study seats are in rooms 505 and 506 and at the rear of the library; other seats do not need advance booking.",
    image: "", tags: ["Library", "Quiet study", "Bookable seats", "UCL ID required"], openLabel: "Check opening hours", distance: "",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/institute-archaeology-library",
    visitGuide: [
      {text: "The building entrance faces Gordon Square. Use the card reader to the right of the main door with your UCL ID or library card, then go to the fifth floor. The map pin marks the building, not an entrance or room.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/institute-archaeology-library", checkedAt: "2026-10-15"},
      {text: "UCL currently states that the library has no wheelchair access. Check the official library page for current access arrangements before visiting.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/institute-archaeology-library", checkedAt: "2026-10-15"},
    ],
  },
  {
    id: "senate-house", campusBuildingId: "ucl-senate-house", name: "Senate House Library", category: "study",
    lat: 51.5211506, lng: -0.1288017, address: "Senate House, Malet Street",
    description: "University of London's library in a landmark Bloomsbury building. Check registration, access arrangements and opening hours before visiting.",
    image: "/images/senate-house.jpg", imageCredit: "senate-house",
    tags: ["Library", "Bloomsbury", "Registration required"], openLabel: "Check access requirements", distance: "7 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.london.ac.uk/senate-house-library",
  },
  {
    id: "science-library", campusBuildingId: "ucl-dms-watson-building", name: "UCL Science Library", category: "study",
    lat: 51.5234275, lng: -0.1328217, address: "DMS Watson Building, Malet Place",
    description: "A campus library and study destination on Malet Place. Check the library's current hours and space information before heading over.",
    image: "", tags: ["Library", "Main campus", "UCL ID required"], openLabel: "Check opening hours", distance: "3 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/science-library",
    visitGuide: [{text: "The library is in the DMS Watson Building. UCL recommends approaching Malet Place from Torrington Place: the building is on the left before the archway.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/science-library", checkedAt: "2026-10-12"}],
  },
  {
    id: "ssees-library", campusBuildingId: "ucl-school-of-slavonic-and-east-european-studies", name: "SSEES Library", category: "study",
    lat: 51.5252813, lng: -0.1317938, address: "16 Taviton Street",
    description: "UCL's School of Slavonic and East European Studies library, a short walk from the main quad on Taviton Street.",
    image: "", tags: ["Library", "Plug sockets", "Specialist collections", "UCL ID required"], openLabel: "Check opening hours", distance: "4 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ssees-library",
    visitGuide: [{text: "The library entrance and help desk are on the ground floor at 16 Taviton Street. The official guide describes an entrance ramp and a lift within the library.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ssees-library", checkedAt: "2026-10-12"}],
  },
  {
    id: "ioe-library", campusBuildingId: "ucl-20-bedford-way", name: "IOE Library", category: "study",
    lat: 51.5229307, lng: -0.1281569, address: "20 Bedford Way",
    description: "The Newsam Library and Archives at UCL's Institute of Education, on the eastern side of Bloomsbury campus.",
    image: "", tags: ["Library", "Education", "UCL ID required"], openLabel: "Check opening hours", distance: "6 min",
    criteria: categoryCriteria.study,
    sourceUrl: "https://www.ucl.ac.uk/ioe/student-helpdesk/student-support/ucl-and-ioe-library-services",
    visitGuide: [
      {text: "Enter the library on level 4 of the IOE building at 20 Bedford Way; this is described as the ground floor in the library guide.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ioe-library", checkedAt: "2026-10-12"},
      {text: "UCL currently limits access for people who cannot use stairs to library levels 4 and 5: level 3 has no safe evacuation route for them. Ask staff for help collecting books. The nearest accessible toilets are outside the library in Core B on level 4. Check the official guide for changes.", sourceUrl: "https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ioe-library", checkedAt: "2026-10-12"},
    ],
  },
  {
    id: "cruciform-lt1", campusBuildingId: "ucl-cruciform-building", name: "Cruciform Lecture Theatre 1", category: "lecture",
    lat: 51.5241002, lng: -0.1350661, address: "Cruciform Building, Gower Street",
    description: "A teaching space in the Cruciform Building, opposite the main campus. Building location shown; consult your timetable for the room entrance.",
    image: "", tags: ["Teaching space", "Gower Street"], openLabel: "Timetabled access", distance: "3 min",
    criteria: categoryCriteria.lecture,
    sourceUrl: "https://www.ucl.ac.uk/medical-sciences/divisions/wolfson-institute-biomedical-research/cruciform-building",
  },
  {
    id: "gustave-tuck", campusBuildingId: "ucl-wilkins-building", name: "Gustave Tuck Lecture Theatre", category: "lecture",
    lat: 51.5246607, lng: -0.1338349, address: "Wilkins Building, Gower Street",
    description: "A lecture theatre on the second floor of the Wilkins Building. Check the official campus map for the appropriate entrance.",
    image: "/images/main-quad.jpg", imageCredit: "main-quad",
    tags: ["Teaching space", "Wilkins Building"], openLabel: "Timetabled access", distance: "2 min",
    criteria: categoryCriteria.lecture,
    sourceUrl: "https://www.ucl.ac.uk/your-universe/contact",
  },
  {
    id: "logan-hall", campusBuildingId: "ucl-20-bedford-way", name: "Logan Hall", category: "lecture",
    lat: 51.5229307, lng: -0.1281569, address: "IOE, 20 Bedford Way",
    description: "The IOE's large hall for lectures and events at 20 Bedford Way. Attendance and entry depend on the scheduled event.",
    image: "", tags: ["Teaching space", "Events", "Bedford Way"], openLabel: "Event access", distance: "7 min",
    criteria: categoryCriteria.lecture,
    sourceUrl: "https://www.ucl.ac.uk/qualitative-health-research-network/2026-qhrn-conference-programme-and-logistics",
  },
  {
    id: "ingold-auditorium", campusBuildingId: "ucl-christopher-ingold-building", name: "Christopher Ingold Auditorium", category: "lecture",
    lat: 51.5253827, lng: -0.1322802, address: "Christopher Ingold Building, 20 Gordon Street",
    description: "The XLG2 auditorium in the Christopher Ingold Building. Follow your event or teaching instructions for access.",
    image: "", tags: ["Teaching space", "Gordon Street"], openLabel: "Timetabled access", distance: "3 min",
    criteria: categoryCriteria.lecture,
    sourceUrl: "https://www.ucl.ac.uk/engineering/computer-science/collaborate/alumni",
  },
  {
    id: "ramsay-hall", campusBuildingId: "ucl-ramsay-hall", name: "Ramsay Hall", category: "halls",
    lat: 51.5224791, lng: -0.1383567, address: "20 Maple Street",
    description: "UCL student accommodation on Maple Street. Share a firsthand account of your stay and the term you lived here.",
    image: "", tags: ["UCL accommodation", "Fitzrovia"], openLabel: "Residents only", distance: "7 min",
    criteria: categoryCriteria.halls,
    sourceUrl: "https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation",
  },
  {
    id: "astor-college", campusBuildingId: "ucl-astor-college", name: "Astor College", category: "halls",
    lat: 51.5208379, lng: -0.1375345, address: "99 Charlotte Street",
    description: "UCL student accommodation on Charlotte Street. Compare residents' experiences and share a firsthand review of your stay.",
    image: "", tags: ["UCL accommodation", "Fitzrovia"], openLabel: "Residents only", distance: "8 min",
    criteria: categoryCriteria.halls,
    sourceUrl: "https://www.ucl.ac.uk/study/astor-college",
  },
  {
    id: "john-adams-hall", campusBuildingId: "ucl-john-adams-hall", name: "John Adams Hall", category: "halls",
    lat: 51.52656, lng: -0.13135, address: "15–23 Endsleigh Street",
    description: "UCL student accommodation close to the Bloomsbury campus. Its exact footprint is still being verified; reviews remain available without a map pin.",
    image: "", tags: ["UCL accommodation", "Bloomsbury"], openLabel: "Residents only", distance: "5 min",
    criteria: categoryCriteria.halls,
    sourceUrl: "https://www.ucl.ac.uk/study/john-adams-hall",
  },
  {
    id: "example-rental", name: "Example Bloomsbury rental", category: "rental",
    lat: 51.5199, lng: -0.1253, address: "Bloomsbury area · approximate location only",
    description: "An entirely fictional rental used to demonstrate experience-based reviews. This pin does not identify a property, landlord or flat.",
    image: "", tags: ["Illustrative property", "Area location only"], openLabel: "Fictional example", distance: "12 min",
    criteria: categoryCriteria.rental, demo: true,
  },
];

const directoryBuildings = campusDirectory.buildings as CampusBuilding[];
const buildingsById = new Map(directoryBuildings.map(building => [building.id, building]));
const verifiedPoints = new Map(footprintIndex.buildings.map(building => [building.buildingId, building.coordinates]));
// These existing pages already describe a whole building. Preserve their IDs and reviews.
const wholeBuildingIds = new Map([
  ['ucl-student-centre', 'student-centre'], ['ucl-ramsay-hall', 'ramsay-hall'],
  ['ucl-astor-college', 'astor-college'], ['ucl-john-adams-hall', 'john-adams-hall'],
]);
export function buildingPlaceId(buildingId: string): string { return wholeBuildingIds.get(buildingId) || buildingId; }
function directoryDetails(building: CampusBuilding): Partial<Place> {
  const point = verifiedPoints.get(building.id) || building.coordinates;
  const scope = building.membership?.scope;
  const partner = building.membership?.status === 'ucl-partner';
  let membershipNote = partner
    ? `Partner residence${building.accommodation?.operator ? ` operated by ${building.accommodation.operator}` : ''}; a UCL listing does not imply UCL ownership.`
    : scope === 'part-of-building' ? 'UCL uses part of this building; access to other areas may be restricted.'
    : scope === 'shared-site' ? 'Shared site: UCL is one of the users.'
    : scope === 'unconfirmed-extent' ? 'UCL use is confirmed, but the extent of occupation is not.'
    : 'Listed by UCL. A directory listing does not imply public access or ownership.';
  if (building.type === 'residence' && building.accommodation?.current === false) membershipNote += ' This estate listing is not confirmed as a current 2026/27 accommodation option.';
  return {
    lat: point?.lat, lng: point?.lng,
    locationStatus: verifiedPoints.has(building.id) ? 'footprint' : point ? 'official' : 'unlocated',
    aliases: [...new Set([building.officialName || '', ...(building.aliases || [])].filter(Boolean))],
    campus: building.campus, membershipNote, currentAccommodation: building.accommodation?.current,
  };
}

/** One reviewable target per directory entry, plus distinct existing rooms/libraries. */
export const places: Place[] = [
  ...originalPlaces.map(place => {
    if (place.demo) return {...place, locationStatus: 'demo-area' as const};
    const building = buildingsById.get(place.campusBuildingId || '');
    if (!building) throw new Error(`Missing campus directory entry for ${place.id}`);
    const details = directoryDetails(building);
    return {...place, ...details, aliases: [...new Set([...(place.aliases || []), ...(details.aliases || [])])], parentPlaceId: wholeBuildingIds.has(building.id) ? undefined : buildingPlaceId(building.id)};
  }),
  ...directoryBuildings.filter(building => !wholeBuildingIds.has(building.id)).map((building): Place => {
    const category: PlaceCategory = building.type === 'residence' ? 'halls' : building.type === 'study' || building.type === 'library' ? 'study' : 'building';
    const partner = building.membership?.status === 'ucl-partner';
    return {
      id: building.id, campusBuildingId: building.id, name: building.name, category,
      address: building.address || 'See the official UCL listing',
      description: building.use || 'A place listed in the UCL public building and facilities directory. Share your firsthand experience of using this location.',
      image: '', tags: [partner ? 'Partner residence' : category === 'halls' ? 'UCL-listed accommodation' : 'UCL-listed location', building.campus === 'east' ? 'UCL East' : building.campus === 'bloomsbury' ? 'Bloomsbury' : 'Across London'],
      openLabel: category === 'halls' ? 'Residents and authorised visitors' : 'Check access with UCL', distance: '',
      criteria: categoryCriteria[category], sourceUrl: building.officialSourceUrls?.[0],
      ...directoryDetails(building),
    };
  }),
];

export function placesInBuilding(buildingId: string): Place[] {
  return places.filter(place => place.campusBuildingId === buildingId)
    .sort((a, b) => Number(Boolean(a.parentPlaceId)) - Number(Boolean(b.parentPlaceId)) || a.name.localeCompare(b.name));
}

type ReviewInput = [string, number, string, string[], number[], boolean?];
const reviewInputs: ReviewInput[] = [
  ["student-centre", 5, "The upper floors are my go-to for a focused morning. I could plug in easily and the daylight made a long reading session feel less gloomy.", ["Natural light", "Plenty of plugs", "Quiet corners"], [5, 5, 5, 4, 5]],
  ["student-centre", 4, "Useful for our group project, but I would pick a quieter floor for an essay. Booking a room ahead made things much easier.", ["Group friendly", "Book ahead"], [4, 5, 4, 3, 5]],
  ["student-centre", 5, "I liked having individual desks and places to take a break in the same building. Bring headphones if you sit near a group area.", ["Comfortable", "Great Wi-Fi"], [5, 5, 5, 4, 5]],
  ["student-centre", 4, "A good place to settle in with a laptop. The busiest part of the afternoon took a little patience to find a seat.", ["Busy afternoons", "Plenty of plugs"], [4, 5, 5, 4, 5]],
  ["main-library", 5, "I enjoyed the traditional reading-room feel. It helped me switch into essay mode and keep my phone out of sight.", ["Focused study", "Beautiful building"], [4, 4, 5, 5, 4]],
  ["main-library", 4, "Great for working through a reading list between seminars. I checked the opening information before making the trip.", ["Quiet", "Central location"], [4, 3, 4, 5, 4]],
  ["senate-house", 5, "This was my change-of-scene option when I wanted to work away from my usual desk. Sorting out access first was worth it.", ["Focused study", "Change of scene"], [5, 4, 4, 5, 4]],
  ["senate-house", 4, "A calm setting for a long reading session. I would bring a charger and check the entry requirements before a first visit.", ["Quiet", "Plan your visit"], [4, 4, 4, 5, 4]],
  ["science-library", 4, "Handy between classes on Malet Place. I found it easiest to stay focused when I picked a desk away from the entrance.", ["Central location", "Focused study"], [4, 5, 5, 4, 4]],
  ["science-library", 4, "A practical place for an afternoon with problem sheets. The desk setup worked well for my laptop and notebook.", ["Plenty of plugs", "Laptop friendly"], [4, 5, 4, 4, 4]],
  ["ssees-library", 5, "I tried this for a quiet reading day and liked the smaller feel. A useful addition to my study-space rotation.", ["Quiet", "Hidden gem"], [4, 4, 5, 5, 4]],
  ["ssees-library", 4, "A comfortable place for independent work in my example visit. I would check the hours if coming later in the day.", ["Individual study", "Comfortable"], [4, 4, 4, 5, 4]],
  ["ioe-library", 4, "A useful stop after teaching at Bedford Way. I liked staying nearby to finish my notes before heading home.", ["Convenient", "Focused study"], [4, 4, 4, 4, 4]],
  ["ioe-library", 5, "The space worked well for an education reading list and a long afternoon of writing. I would happily use it again.", ["Quiet", "Reading spot"], [5, 4, 4, 5, 4]],
  ["cruciform-lt1", 4, "I could follow the slides comfortably from the middle rows. Having my notes downloaded before class was useful.", ["Clear view", "Central location"], [4, 3, 4, 4, 4]],
  ["cruciform-lt1", 3, "The teaching layout worked for the session, though I preferred an aisle seat for a longer lecture.", ["Aisle seat preferred"], [3, 3, 4, 4, 4]],
  ["gustave-tuck", 4, "A memorable room for a guest lecture. I gave myself a few extra minutes to find it on my first visit.", ["Historic setting", "Arrive early"], [4, 3, 4, 4, 3]],
  ["logan-hall", 4, "Useful for a large event. Arriving a little early helped me find a seat with the view I wanted.", ["Large events", "Clear view"], [4, 3, 4, 4, 4]],
  ["ingold-auditorium", 4, "I could see the presentation well and found the room straightforward once I followed the building signs.", ["Clear view", "Good acoustics"], [4, 4, 4, 4, 4]],
  ["ramsay-hall", 4, "In this fictional stay, meeting people in shared spaces made the first term easier. Being able to walk to lectures was a big plus.", ["Social spaces", "Walk to campus"], [4, 4, 5, 4, 5]],
  ["ramsay-hall", 3, "For this sample experience, the location suited me well. I would ask about the room layout and shared facilities before deciding.", ["Central location", "Check room layout"], [3, 4, 4, 4, 5]],
  ["astor-college", 4, "My fictional review: the walk to campus was convenient and having a routine in a shared kitchen helped me settle in.", ["Walk to campus", "Shared kitchen"], [4, 4, 4, 4, 5]],
  ["astor-college", 4, "This illustrative stay worked well for getting to early teaching. I would compare room types carefully when applying.", ["Convenient", "Compare room types"], [3, 4, 4, 4, 5]],
  ["john-adams-hall", 4, "In this example, I appreciated being close to both campus and friends. The shared spaces were a useful place to meet people.", ["Walk to campus", "Friendly spaces"], [4, 4, 4, 4, 5]],
  ["example-rental", 3, "Fictional example: a maintenance request took two weeks to resolve. My deposit was returned after six weeks, and I kept a dated checkout record.", ["Keep written records", "Deposit returned"], [3, 4, 4, 3, 3], false],
  ["example-rental", 4, "Fictional example: I liked the short commute. I documented a window condensation issue, and a repair visit was arranged during my tenancy.", ["Short commute", "Document repairs"], [4, 4, 3, 4, 4]],
];

export const seedReviews: Review[] = reviewInputs.map(([placeId, rating, text, tags, values, recommend], index) => {
  const place = places.find((item) => item.id === placeId)!;
  return {
    id: `demo-review-${index + 1}`, placeId, rating, recommend: recommend ?? rating >= 4,
    text, tags, term: index % 3 === 0 ? "Autumn" : index % 3 === 1 ? "Spring" : "Summer",
    year: 2025, criteria: Object.fromEntries(categoryCriterionKeys[place.category].map((criterion, i) => [criterion, values[i]])),
    demo: true, helpful: [12, 8, 6, 4, 3, 9, 5][index % 7],
  };
});

function demoEventPosition(buildingId: string): {lat:number;lng:number} {
  const point = verifiedPoints.get(buildingId);
  if (!point) throw new Error(`Missing known campus position for example event: ${buildingId}`);
  return {lat:point.lat,lng:point.lng};
}

/** Every pin below is a fictional demo, including its society/committee. */
export const seedPins: Pin[] = [
  { id: "demo-food-pizza", campusBuildingId: "ucl-student-centre", type: "food", title: "Pizza looking for a good home", description: "Demo alert: a few slices left after a society meetup. Stock photo for illustration. Ask the organiser about ingredients and handling; dietary tags are illustrative.", location: "Student Centre · ground floor", lat: 51.5247529, lng: -0.1326144, dietary: ["Vegetarian"], durationMinutes: 24, image: "/images/pizza-demo.jpg", imageCredit: "pizza-demo", demo: true, organizer: "Example society committee" },
  { id: "demo-freebie-totes", type: "freebie", title: "Meet a society. Take a tote.", description: "Illustrative society welcome stall with tote bags and stickers. This is not a scraped or scheduled Union event.", location: "UCL Main Quad", lat: 51.52452, lng: -0.13402, dietary: [], durationMinutes: 105, demo: true, organizer: "Example society" },
  { id: "demo-deal-pastries", type: "deal", title: "Pastries for the walk home", description: "Demo yellow-sticker deal: a bag of mixed pastries. Stock photo for illustration. Price and availability are fictional; a real deal needs a current photo and confirmed shop.", location: "Goodge Street area · example shop", lat: 51.52037, lng: -0.13557, dietary: ["Vegetarian"], durationMinutes: 52, price: 1.25, originalPrice: 3.5, image: "/images/pastries-demo.jpg", imageCredit: "pastries-demo", demo: true },
  { id: "demo-food-sandwiches", campusBuildingId: "ucl-wilkins-building", type: "food", title: "Lunch meeting, bonus sandwiches", description: "Demo alert: unopened sandwich packs from an example event, including illustrative vegan options. Check ingredients, use-by date and storage directly with the host.", location: "Wilkins Building · foyer", lat: 51.5246607, lng: -0.1338349, dietary: ["Vegan"], durationMinutes: 16, demo: true, organizer: "Example event team" },
  { id: "demo-deal-fruit", type: "deal", title: "A little fruit, a smaller price", description: "Illustrative deal for a mixed fruit bag. This is a fictional offer, not a claim about any local retailer.", location: "Torrington Place area · example shop", lat: 51.52287, lng: -0.13405, dietary: ["Vegan", "Vegetarian"], durationMinutes: 78, price: 0.75, originalPrice: 2.5, demo: true },
  { id: "demo-freebie-coffee", type: "freebie", title: "Coffee & a conversation", description: "Fictional society drop-in with coffee and biscuits. Try the filters and card details; no real event is taking place at this demo pin.", location: "Gordon Square", lat: 51.52434, lng: -0.13052, dietary: ["Vegetarian"], durationMinutes: 65, demo: true, organizer: "Example student society" },
  { id: "demo-event-discussion", campusBuildingId: "ucl-student-centre", type: "event", title: "Example event · a society discussion", description: "Fictional demo discussion at a known campus building. This is not a scheduled Union event and does not promise food, merchandise or admission terms.", location: "Student Centre · example venue", ...demoEventPosition("ucl-student-centre"), dietary: [], startsInMinutes: 0, durationMinutes: 90, demo: true, organizer: "Example discussion society" },
  { id: "demo-event-workshop", campusBuildingId: "ucl-wilkins-building", type: "event", title: "Example event · creative workshop", description: "Fictional workshop shown two days into your private demo to illustrate upcoming events. No workshop, booking or giveaway is actually arranged here.", location: "Wilkins Building · example venue", ...demoEventPosition("ucl-wilkins-building"), dietary: [], startsInMinutes: 2 * 1440, durationMinutes: 2 * 1440 + 120, demo: true, organizer: "Example creative society" },
  { id: "demo-event-reading", campusBuildingId: "ucl-dms-watson-building", type: "event", title: "Example event · reading circle", description: "Fictional reading circle shown eight days into your private demo. The building position is real; the event, organiser and times are illustrative, with no freebies claimed.", location: "DMS Watson Building · example venue", ...demoEventPosition("ucl-dms-watson-building"), dietary: [], startsInMinutes: 8 * 1440, durationMinutes: 8 * 1440 + 60, demo: true, organizer: "Example reading society" },
];

export const seedThreads: Thread[] = [
  { id: "demo-thread-1", placeId: "student-centre", title: "Your favourite spot for a long reading day?", text: "Demo discussion: I am comparing individual study areas. What makes a desk work for you?", replies: 0, demo: true },
  { id: "demo-thread-2", placeId: "student-centre", title: "How far ahead do you book a group room?", text: "Demo discussion: we are planning a small project session and want to understand the booking process.", replies: 0, demo: true },
  { id: "demo-thread-3", placeId: "main-library", title: "Any tips for a first visit?", text: "Demo discussion: share general advice about finding the reading rooms and checking access.", replies: 0, demo: true },
  { id: "demo-thread-4", placeId: "senate-house", title: "What should I check before registering?", text: "Demo discussion: looking for the official registration and access information before visiting.", replies: 0, demo: true },
  { id: "demo-thread-5", placeId: "science-library", title: "Study buddy for an afternoon session?", text: "Demo discussion: a sample thread for finding company while working independently.", replies: 0, demo: true },
  { id: "demo-thread-6", placeId: "ramsay-hall", title: "What would you put on a first-term packing list?", text: "Demo discussion: practical packing ideas from a fictional group of residents.", replies: 0, demo: true },
  { id: "demo-thread-7", placeId: "astor-college", title: "Advice for comparing room types?", text: "Demo discussion: what questions would you ask at a hall viewing?", replies: 0, demo: true },
  { id: "demo-thread-8", placeId: "example-rental", title: "What to record at a rental viewing?", text: "Fictional discussion: ideas for an experience-based viewing checklist. Please do not post names, contact details or flat numbers.", replies: 0, demo: true },
];

export const imageCredits = [
  { id: "student-centre", title: "UCL Student Centre, London", author: "orangeaurochs", sourceUrl: "https://commons.wikimedia.org/wiki/File:UCL_Student_Centre,_London.jpg", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/", changes: "Resized by Wikimedia; display may crop to fit." },
  { id: "main-quad", title: "Main Quad, University College London", author: "Bryn Holmes", sourceUrl: "https://commons.wikimedia.org/wiki/File:Main_Quad,_University_College_London_-_geograph.org.uk_-_7425618.jpg", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/", changes: "Resized by Wikimedia; display may crop to fit." },
  { id: "senate-house", title: "Senate House of the University of London", author: "Philip Halling", sourceUrl: "https://commons.wikimedia.org/wiki/File:Senate_House_of_the_University_of_London_-_geograph.org.uk_-_7018395.jpg", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/", changes: "Original image; display may crop to fit." },
  { id: "pizza-demo", title: "Margherita pizza on plate", author: "Shisma", sourceUrl: "https://commons.wikimedia.org/wiki/File:Margherita_pizza_on_plate.jpg", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", changes: "Resized by Wikimedia; display may crop to fit. Illustration only, not evidence of an alert." },
  { id: "pastries-demo", title: "A pile of croissants", author: "Raysonho / Open Grid Scheduler", sourceUrl: "https://commons.wikimedia.org/wiki/File:APileOfCroissants.jpg", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", changes: "Resized by Wikimedia; display may crop to fit. Illustration only, not evidence of a deal." },
];

/** Source discovery is separate from demo pins. No automated feed was verified. */
export const unionSource = {
  name: "Students' Union UCL · What's on",
  url: "https://studentsunionucl.org/whats-on",
  termsUrl: "https://studentsunionucl.org/terms-and-conditions",
  checkedOn: "2026-10-12",
  status: "source-linked-only" as const,
  note: "Official public source. Demo society pins are fictional. Enable ingestion only after checking applicable terms and robots rules; retain source links, deduplicate and expire events.",
};
