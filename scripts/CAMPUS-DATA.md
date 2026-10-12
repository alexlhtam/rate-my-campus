# Campus footprint import

The public directory proves that UCL lists or uses a building. It does not prove
ownership or exclusive occupation. `public/data/campus-directory.json` is the
independent, officially sourced directory. The import manifest is the manually
reviewed join between that directory and OpenStreetMap geometry.

Run `python scripts/import-campus-buildings.py --refresh` to download bounded
public OSM API extracts for Bloomsbury, UCL East and the current halls in the
wider London area. Subsequent `python scripts/import-campus-buildings.py`
runs reproduce the output from the ignored `work/campus-footprints/audit/` cache.
The script uses Python's standard library. It records source URLs, SHA-256 hashes,
retrieval dates and OSM object versions. A fresh geometry download does not renew
the identity audit date: review the manifest and official directory separately.

The importer writes:

- `public/data/campus-buildings.geojson`: original complete ways, stitched
  multipolygons, their holes and reviewed building parts. Only ring winding is
  normalized. No smoothing, rectangular clipping or invented geometry occurs.
- `public/data/campus-footprint-index.json`: stable directory IDs, source feature
  IDs and explicitly derived map-label points. These are not entrance coordinates.
- `public/data/campus-building-quality.json`: source and coverage information,
  unmatched buildings, height conflicts and known limitations.

The October 2026 audit fixes the Cruciform error: OSM building relation 11790454
uses way 863409196 as an outline, not its upper-storey shape. The true cross-shaped
upper part is way 27432119 (121 vertices); ways 863409197–863409202 supply six lower
podium parts. Extruding the outline as a five-storey block loses the actual shape.
The manifest now preserves the relation's complete parts.

The coverage audit also fixes the Garden Halls omission. Its name is attached to
OSM residential landuse way 1368856792, while its actual building polygons have
mostly unnamed part tags. That named site provides affiliation context; eight
actual building polygons, including Hughes Parry Tower, provide the geometry.
The site boundary is never extruded and the spaces between buildings stay open.
Verified `ucl-partner` halls are accepted alongside `ucl-used` buildings, retaining
their operator and shared occupation status. College, Connaught, International,
Handel and Garden Halls are University of London partners, not exclusively UCL
owned buildings.

Current halls outside the initial campus area are checked with additional
bounded extracts, including Camden, Caledonian Road, Victoria, Fortis Green,
Stratford and Canary Wharf. The quality report records exact current coverage
counts. John Adams and John Tovell remain unresolved terrace allocations: their
documented room/address ranges do not establish separate whole-building outlines.
Every remaining directory entry has an audited reason and reason code in the
manifest. New unmatched entries fail import until an explicit reason is supplied.

`role: outline` is for selection or flat footprints and **must not be extruded**.
Senate House and Bedford Way courtyard holes must also survive rendering. This is
an OSM footprint model with approximate flat-top extrusion, not a surveyed 3D mesh.

`height` and `minHeight` remain null when OSM has no metric tag. Display heights
are separate: `visualHeight` and `visualMinHeight` use tagged levels × 3 metres,
including roof levels, or an explicitly illustrative 12-metre fallback. Metric
OSM tags are themselves unsurveyed unless their source says otherwise. Elevated
parts with contradictory top/minimum levels have a documented visual interpretation.
Marshgate's OSM levels conflict with UCL's eight-floor description, which also
mentions double-height rooms; the data records the unresolved conflict rather
than asserting an exact physical height from either floor count.

Shared and partially occupied sites retain their official occupation scope. A
building's exterior envelope does not imply that all its rooms belong to UCL.
Unmatched directory entries receive no guessed footprint or postal centroid.

Run `node --test tests/campus-footprints.test.mjs` after changes. Geometry is
OpenStreetMap data under ODbL 1.0. Display **© OpenStreetMap contributors**, linked
to <https://www.openstreetmap.org/copyright>, wherever these footprints are shown.
