# UCL map directory research

Reviewed 12 October 2026. The canonical data file is `public/data/campus-directory.json`: 175 records, including 126 in Bloomsbury/Fitzrovia, the two principal UCL East buildings and 47 other sites. Four University of London halls supplement the Estates list and are explicitly marked as partner residences.

## Sources and scope

The [UCL Estates area facilities management directory](https://www.ucl.ac.uk/estates/our-services/area-facilities-management) supplies the broad public list of names and addresses. It includes whole buildings, groups of terraced houses, rooms, shared sites and temporary facilities. Being listed does **not** establish ownership or exclusive occupation of an entire map footprint.

The [inclusive facilities list](https://www.ucl.ac.uk/estates/our-work/inclusive-environments/inclusive-facilities-ucl/toilets-ucl), explicitly updated in August 2026, corroborates 121 records with official building numbers and provides current uses. The catalog preserves those numbers separately from the app's stable generated IDs. Groups can have several official numbers; unknown numbers remain null. The [complete property register](https://www.ucl.ac.uk/estates/about-ucl-estates/our-buildings/ucl-buildings-register) requires MyCampus login and was not accessed.

Current [Library Services](https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/ucl-libraries), [Bartlett locations](https://www.ucl.ac.uk/bartlett/about/our-locations-and-facilities), [UCL East visitor information](https://www.ucl.ac.uk/engage/ucl-east/about-ucl-east/visit-us) and [Accommodation contacts](https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation) supply more specific uses and resolve several postal-address conflicts. No old PDF is the sole authority for inclusion. Raw public building-number headings are retained under `work/campus-directory/official-building-ids.json`.

## Decisions that affect the map

- Cruciform is UCL building 212, with its library on the lower ground floor. It is distinct from the modern University College Hospital. Use the matched Cruciform building parts, not a bounding rectangle or nearby hospital footprint. [Current Cruciform page](https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/cruciform-hub)
- Marshgate (445) and One Pool Street (444) form the principal UCL East campus. Here East is separate UCL accommodation within the larger Here East site; do not classify that entire development as UCL. [UCL East](https://www.ucl.ac.uk/engage/ucl-east/about-ucl-east/visit-us), [Bartlett locations](https://www.ucl.ac.uk/bartlett/about/our-locations-and-facilities)
- Dr Williams's Library and Henry Morley were acquired by UCL in March 2024. They should not be excluded based on an older map. [UCL acquisition announcement](https://www.ucl.ac.uk/news/2024/may/ucl-acquires-dr-williamss-library-and-henry-morley-building)
- Senate House, hospital sites and intercollegiate halls retain shared/partner qualifications. UCL's use of facilities does not make the entire property UCL. [Accommodation operators](https://www.ucl.ac.uk/study/accommodation/contact-ucl-accommodation)
- The South Quad pop-up is still evidenced by September–October 2026 welcome activities. It remains a temporary facility, requiring its own geometry match. [Current welcome event](https://www.ucl.ac.uk/study/events/2026/sep/new-student-advice-helpdesks-2026-bloomsbury)

## Matching rules

Join geometry using `buildingId === directory.id`. Keep original OSM identities and part/outline relationships in the footprint dataset. Directory coordinates are null because no numeric coordinates were established from the reviewed official sources. A geometry-derived representative point is a display location, not an official address or entrance.

Never geocode a generic “Gower Street WC1E 6BT” postal address into an invented precise building position. Preserve uncertain records in search with their address. A matched outline does not verify building height: unknown height stays unknown, and visual extrusion estimates must remain labelled.

`reviewNotes` preserves conflicts: Estates vs current postcodes, 332 vs 334–336 Gray's Inn Road, grouped halls, and changing departmental addresses. Do not promote those into confident claims. Source pages are mutable; this is a reviewed snapshot, not a live official register.

## Reviewable places and alert positions

`lib/data.ts` links real reviewable places to the directory with `campusBuildingId`. The Main Library and Gustave Tuck Lecture Theatre both link to Wilkins; the IOE Library and Logan Hall both link to 20 Bedford Way. Cruciform Lecture Theatre 1 links to the Cruciform building. These are building associations, not room or entrance coordinates. [Gustave Tuck location](https://www.ucl.ac.uk/your-universe/contact), [Logan Hall location](https://www.ucl.ac.uk/qualitative-health-research-network/2026-qhrn-conference-programme-and-logistics), [Cruciform Lecture Theatre 1](https://www.ucl.ac.uk/medical-sciences/events/2026/mar/ucl-faculty-medical-sciences-programmes-offer-holder-day)

Matched place positions are rounded representative points from `public/data/campus-footprint-index.json`. John Adams Hall retains an explicitly approximate position: its [UCL address](https://www.ucl.ac.uk/study/john-adams-hall) is established, but its allocation within the larger [listed Endsleigh Street terrace](https://historicengland.org.uk/listing/the-list/list-entry/1078299) has not been matched unambiguously to OSM geometry. The fictional rental and area-only example shops remain approximate. The two fictional alerts explicitly naming the Student Centre and Wilkins use those buildings' representative positions; their fictional status is unchanged.

## Map behaviour

The main map uses MapLibre with pan, zoom, rotation, a north reset, building labels and a flat/3D toggle. Campus presets cover Bloomsbury, UCL East and across London. A searchable directory matches building names, aliases and addresses, with a campus filter. Selecting a located result fits its reviewed footprint; an unlocated result shows its source-backed address without inventing a map position. Building cards expose source links and occupation qualifications. Nearby overlapping community pins open a list of the actual items.

Reviewed OSM polygons and building parts form the raised layer. Courtyard holes remain open, and enclosing outlines are not extruded over their detailed parts. Only features with reviewed UCL affiliation are used; a shared or partial site keeps that qualification. Heights are indicative unless the source supplies a measured value. There is no rectangular campus ownership mask or fixed building-count claim.

Configured Google roadmap tiles pass through the server proxy and require attribution for the visible area. The fallback basemap is attributed OpenStreetMap. If WebGL cannot initialise, a flat raster map preserves basic panning, zooming, place pins and confirmation. It does not reproduce the MapLibre directory, rotation or 3D interaction. The location confirmation view is flat and keeps Google-sourced coordinates on Google imagery.
