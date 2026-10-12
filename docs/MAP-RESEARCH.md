# UCL map directory research

Reviewed 12 October 2026. The canonical data file is `public/data/campus-directory.json`: 181 records, including 126 in Bloomsbury/Fitzrovia, the two principal UCL East buildings and 53 other sites. It includes all 34 distinct halls named in UCL's current 2026/27 accommodation offering. That is coverage of the advertised accommodation list, not the whole UCL estate, and it does not mean every record has a verified map outline.

## Sources and scope

The [UCL Estates area facilities management directory](https://www.ucl.ac.uk/estates/our-services/area-facilities-management) supplies the broad public list of names and addresses. It includes whole buildings, groups of terraced houses, rooms, shared sites and temporary facilities. Being listed does **not** establish ownership or exclusive occupation of an entire map footprint.

The [inclusive facilities list](https://www.ucl.ac.uk/estates/our-work/inclusive-environments/inclusive-facilities-ucl/toilets-ucl), explicitly updated in August 2026, corroborates 122 records with official building numbers and provides current uses. The catalog preserves those numbers separately from the app's stable generated IDs. Groups can have several official numbers; unknown numbers remain null. The [complete property register](https://www.ucl.ac.uk/estates/about-ucl-estates/our-buildings/ucl-buildings-register) requires MyCampus login and was not accessed.

Current [Library Services](https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ucl-libraries), [Bartlett locations](https://www.ucl.ac.uk/bartlett/about/our-locations-and-facilities), [UCL East visitor information](https://www.ucl.ac.uk/engage/ucl-east/about-ucl-east/visit-us) and [Accommodation contacts](https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation) supply more specific uses and resolve several postal-address conflicts. No old PDF is the sole authority for inclusion. Verified building numbers and their official source URLs are retained in the canonical catalog.

## Current accommodation coverage

The [2026/27 fee schedule](https://www.ucl.ac.uk/study/accommodation/fees-guidance-and-payment/fees-and-contract-dates-2026-27) names 34 distinct halls, matching the current [contact list](https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation). The directory now contains all 34. The previous version contained 28; this audit adds Eleanor Rosa House, Unite St Pancras Way, urbanest Canary Wharf, urbanest Kings Cross, urbanest St Pancras and Venti House. Existing IDs are preserved.

| Operator | Current advertised halls | Relationship |
| --- | ---: | --- |
| UCL | 23 | UCL-managed accommodation |
| University of London | 6 | Intercollegiate halls offered through UCL nomination |
| urbanest | 3 | Managed by urbanest; accommodation contract with UCL |
| Unite Students | 1 | Managed and contracted by Unite; UCL nomination |
| Fresh | 1 | Venti House, managed and contracted by Fresh |

The operator distinction follows UCL's current [hall categories](https://www.ucl.ac.uk/study/accommodation/halls), [intercollegiate list](https://www.ucl.ac.uk/study/accommodation/halls/intercollegiate-halls) and individual pages for [urbanest Canary Wharf](https://www.ucl.ac.uk/study/urbanest-canary-wharf), [Unite St Pancras Way](https://www.ucl.ac.uk/study/unite-st-pancras-way) and [Venti House](https://www.ucl.ac.uk/study/venti-house). A hall's inclusion does not establish current room availability or exclusive UCL occupation.

Each current hall has `accommodation.current`, `academicYear`, `listingName`, `operator`, `contractProvider`, `relationship` and supporting sources. `accommodationAudit` records the 34 expected IDs and list-level scope. One Pool Street retains its mixed academic/residential classification and counts as one hall. Separate Estates records for Aberdeen Mansions, Denys Holland House, the Camden Road bungalows and 115–117 Gower Street are not counted as extra current advertised halls.

Garden Halls, College Hall, Connaught Hall, International Hall and Handel Mansions were already in the directory as partners. Excluding `ucl-partner` records from geometry matching was a coverage defect: affiliation can be verified without implying UCL ownership. The geometry audit now matches these against their actual OSM identities. All 11 current partner halls have reviewed geometry.

Of the 34 current advertised halls, 32 now have reviewed map outlines. John Adams Hall and John Tovell House remain searchable by name and address without invented outlines. John Adams occupies 15–23 Endsleigh Street within a larger listed 13–23 terrace; John Tovell occupies 89 and 93–97 Gower Street within a larger mapped terrace. Neither allocation can yet be separated confidently from the public geometry.

## Decisions that affect the map

- Cruciform is UCL building 212, with its library on the lower ground floor. It is distinct from the modern University College Hospital. Use the matched Cruciform building parts, not a bounding rectangle or nearby hospital footprint. [Current Cruciform page](https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/cruciform-hub)
- Marshgate (445) and One Pool Street (444) form the principal UCL East campus. UCL also uses teaching and research space within the larger Here East site; do not classify that entire development as UCL. [UCL East](https://www.ucl.ac.uk/engage/ucl-east/about-ucl-east/visit-us), [Bartlett locations](https://www.ucl.ac.uk/bartlett/about/our-locations-and-facilities)
- Dr Williams's Library and Henry Morley were acquired by UCL in March 2024. They should not be excluded based on an older map. [UCL acquisition announcement](https://www.ucl.ac.uk/news/2024/may/ucl-acquires-dr-williamss-library-and-henry-morley-building)
- Senate House, hospital sites and intercollegiate halls retain shared/partner qualifications. UCL's use of facilities does not make the entire property UCL. [Accommodation operators](https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation)
- The South Quad pop-up is still evidenced by September–October 2026 welcome activities. It remains a temporary facility, requiring its own geometry match. [Current welcome event](https://www.ucl.ac.uk/study/events/2026/sep/new-student-advice-helpdesks-2026-bloomsbury)
- The legacy Egyptology entry is the Petrie Museum: an [Estates FM map](https://www.ucl.ac.uk/estates/sites/estates/files/ucl_-_fm_zone_-_group_b.pdf) assigns Egyptology number 041, while the current inclusive facilities list identifies the Petrie Museum as 41. The [current museum page](https://www.ucl.ac.uk/engage/museums-collections/petrie-museum-egyptian-and-sudanese-archaeology/visit-petrie-museum) corroborates its Malet Place address. The stable ID remains `ucl-egyptology`; 1–4 Malet Place is a separate record, number 46.
- The Medical School at 74 Huntley Street (374) and Rockefeller (201) have distinct current Estates identifiers. Historic use of Rockefeller as a wider label does not establish that both records share one complete footprint; the exact allocation remains qualified. [Current medical-school guidance](https://www.ucl.ac.uk/medical-sciences/divisions/medical-school/information-current-mbbs-students-and-staff/policies-and-faqs)

## Matching rules

Join geometry using `buildingId === directory.id`. Keep original OSM identities and part/outline relationships in the footprint dataset. Directory coordinates are null because no numeric coordinates were established from the reviewed official sources. A geometry-derived representative point is a display location, not an official address or entrance.

Never geocode a generic “Gower Street WC1E 6BT” postal address into an invented precise building position. Preserve uncertain records in search with their address. A matched outline does not verify building height: unknown height stays unknown, and visual extrusion estimates must remain labelled.

`reviewNotes` preserves conflicts: Estates vs current postcodes, 332 vs 334–336 Gray's Inn Road, grouped halls, and changing departmental addresses. Do not promote those into confident claims. Source pages are mutable; this is a reviewed snapshot, not a live official register.

The structured coverage audit is kept separately from the source directory. `public/data/campus-footprint-index.json` records every matched directory ID, its reviewed geometry identities and the source of its representative point. `public/data/campus-building-quality.json` records every unmatched ID with a reason. Together they account for the complete directory without treating an official postal address as a verified position. The regression checks require these sets to be disjoint and to cover every directory record, and require unmapped records to remain searchable.

The reviewed snapshot contains 126 mapped directory entries and 55 remaining gaps. Of the mapped entries, 107 are in Bloomsbury/Fitzrovia, two are at UCL East and 17 are elsewhere. Each gap has a specific explanation and a structured reason code in the quality report; 19 are in Bloomsbury/Fitzrovia. The geometry contains 297 source features: 287 rendered features and 10 enclosing outlines, with 12 courtyard rings preserved. Counts of features differ from counts of buildings because a building can have multiple parts. These figures describe this reviewed public-source dataset, not comprehensive coverage of the UCL estate.

## Reviewable places and alert positions

`lib/data.ts` links real reviewable places to the directory with `campusBuildingId`. The Main Library and Gustave Tuck Lecture Theatre both link to Wilkins; the IOE Library and Logan Hall both link to 20 Bedford Way. Cruciform Lecture Theatre 1 links to the Cruciform building. These are building associations, not room or entrance coordinates. [Gustave Tuck location](https://www.ucl.ac.uk/your-universe/contact), [Logan Hall location](https://www.ucl.ac.uk/qualitative-health-research-network/2026-qhrn-conference-programme-and-logistics), [Cruciform Lecture Theatre 1](https://www.ucl.ac.uk/medical-sciences/events/2026/mar/ucl-faculty-medical-sciences-programmes-offer-holder-day)

Matched place positions are rounded representative points from `public/data/campus-footprint-index.json`. John Adams Hall retains an explicitly approximate position: its [UCL address](https://www.ucl.ac.uk/study/john-adams-hall) is established, but its allocation within the larger [listed Endsleigh Street terrace](https://historicengland.org.uk/listing/the-list/list-entry/1078299) has not been matched unambiguously to OSM geometry. The fictional rental and area-only example shops remain approximate. The two fictional alerts explicitly naming the Student Centre and Wilkins use those buildings' representative positions; their fictional status is unchanged.

## Map behaviour

The main map uses MapLibre with pan, zoom, rotation, a north reset, building labels and a flat/3D toggle. Campus presets cover Bloomsbury, UCL East and across London. A searchable directory matches building names, aliases and addresses, with campus and mapped/unmapped filters. The map information shows how many directory entries have a reviewed outline and links to the entries still awaiting a match. Selecting a located result fits its reviewed footprint; an unlocated result shows its source-backed address without inventing a map position. Building cards expose source links, occupation qualifications and the operator of current advertised accommodation. Nearby overlapping community pins open a list of the actual items.

Reviewed OSM polygons and building parts form the raised layer. Courtyard holes remain open, and enclosing outlines are not extruded over their detailed parts. Only features with reviewed UCL affiliation are used; a shared or partial site keeps that qualification. Heights are indicative unless the source supplies a measured value. There is no rectangular campus ownership mask or fixed building-count claim.

Configured Google roadmap tiles pass through the server proxy and require attribution for the visible area. The fallback basemap is attributed OpenStreetMap. If WebGL cannot initialise, a flat raster map preserves panning, zooming, place pins, confirmation and the shared searchable directory, including coverage counts, filters and source/partner cards. Selecting a mapped directory result pans the flat map to its reviewed location. Rotation and 3D are unavailable in that fallback. The location confirmation view is flat and keeps Google-sourced coordinates on Google imagery.
