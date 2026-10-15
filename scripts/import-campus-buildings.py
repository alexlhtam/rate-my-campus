#!/usr/bin/env python3
"""Import reviewed UCL/OSM matches without changing or clipping source geometry.

python scripts/import-campus-buildings.py --refresh  # download public OSM extracts
python scripts/import-campus-buildings.py            # reproduce from local cache

The manifest is a reviewed identity join, not a spatial claim of UCL ownership.
Only Python's standard library is required. Raw extracts stay in ignored work/.
"""
import argparse
import hashlib
import json
import math
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'work/campus-footprints/audit'
DATA = ROOT / 'public/data'
SOURCES = {
    'bloomsbury-wide': '-0.143,51.517,-0.123,51.532',
    'bloomsbury-east': '-0.1235,51.517,-0.113,51.531',
    'ucl-east': '-0.02,51.534,0.002,51.543',
    'north-halls': '-0.142,51.532,-0.121,51.55',
    'caledonian-hall': '-0.124,51.542,-0.111,51.554',
    'stratford-halls': '-0.012,51.542,0.01,51.552',
    'victoria-hall': '-0.147,51.492,-0.138,51.5',
    'canary-wharf-hall': '-0.014,51.504,0.002,51.515',
    'fortis-green-hall': '-0.168,51.588,-0.153,51.596',
}


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def orient(ring, outer):
    if len(ring) < 4 or ring[0] != ring[-1]:
        raise ValueError('OSM ring is not closed; refusing artificial closure')
    return ring if (area(ring) > 0) == outer else ring[::-1]


def stitch(parts):
    pending = [list(part) for part in parts]
    rings = []
    while pending:
        ring = pending.pop(0)
        while ring[0] != ring[-1]:
            for i, part in enumerate(pending):
                if ring[-1] == part[0]:
                    ring.extend(part[1:])
                elif ring[-1] == part[-1]:
                    ring.extend(part[-2::-1])
                else:
                    continue
                pending.pop(i)
                break
            else:
                raise ValueError('Incomplete multipolygon members; fetch relation/full instead of inventing closure')
        rings.append(ring)
    return rings


def number(value):
    if value is None:
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) and value >= 0 else None
    except ValueError:
        return None


def metres(value):
    if not value:
        return None
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|feet)?\s*', value)
    if not match:
        return None
    return round(float(match[1]) * (0.3048 if match[2] in ('ft', 'feet') else 1), 3)


def build(refresh=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    source_records = []
    objects = {}
    for key, bbox in SOURCES.items():
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={bbox}'
        path = CACHE / f'{key}.osm'
        if refresh:
            request = urllib.request.Request(url, headers={'User-Agent': 'RateOurCampus-footprint-audit/1.0 (public UCL campus research)'})
            with urllib.request.urlopen(request, timeout=90) as response:
                path.write_bytes(response.read())
        if not path.exists():
            raise FileNotFoundError(f'{path}: run with --refresh first')
        raw = path.read_bytes()
        tree = ET.fromstring(raw)
        osm_date = tree.find('meta').get('osm_base') if tree.find('meta') is not None else None
        source_records.append({'url': url, 'file': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'osmBase': osm_date,
                               'retrievedAt': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()})
        for element in tree:
            if element.tag not in ('node', 'way', 'relation'):
                continue
            key = (element.tag, element.get('id'))
            if key not in objects or int(element.get('version', '0')) > int(objects[key].get('version', '0')):
                objects[key] = element

    def tags(element):
        return {tag.get('k'): tag.get('v') for tag in element.findall('tag')}

    def way_nodes(way_id):
        return [node.get('ref') for node in objects[('way', str(way_id))].findall('nd')]

    def coordinates(refs):
        return [[float(objects[('node', ref)].get('lon')), float(objects[('node', ref)].get('lat'))] for ref in refs]

    def geometry(kind, osm_id):
        element = objects[(kind, str(osm_id))]
        if kind == 'way':
            return {'type': 'Polygon', 'coordinates': [orient(coordinates(way_nodes(osm_id)), True)]}
        if tags(element).get('type') != 'multipolygon':
            raise ValueError('Building relations must be expanded into their real parts in the manifest')
        outer, inner = [], []
        for member in element.findall('member'):
            if member.get('type') != 'way':
                raise ValueError('Nested relation requires explicit audit')
            target = inner if member.get('role') == 'inner' else outer
            target.append(way_nodes(member.get('ref')))
        polygons = [[orient(coordinates(ring), True)] for ring in stitch(outer)]
        for ring in stitch(inner):
            hole = orient(coordinates(ring), False)
            containers = [polygon for polygon in polygons if inside(hole[0], polygon[0])]
            if len(containers) != 1:
                raise ValueError('OSM inner ring has an ambiguous outer ring')
            containers[0].append(hole)
        return {'type': 'Polygon', 'coordinates': polygons[0]} if len(polygons) == 1 else {'type': 'MultiPolygon', 'coordinates': polygons}

    directory = {building['id']: building for building in json.loads((DATA / 'campus-directory.json').read_text(encoding='utf8'))['buildings']}
    manifest = json.loads((ROOT / 'scripts/import-campus-buildings.manifest.json').read_text(encoding='utf8'))
    features, index, conflicts = [], [], []
    seen = set()
    for match in manifest['matches']:
        building = directory[match['buildingId']]
        if building['membership']['status'] not in ('ucl-used', 'ucl-partner'):
            raise ValueError(f"Unverified affiliation: {building['id']}")
        source_urls, outlines, matched_features = [], [], []
        for selected in match['features']:
            kind, osm_id = selected.get('type', 'way'), selected['id']
            key = (kind, str(osm_id))
            if key in seen:
                raise ValueError(f'Duplicate source geometry: {key}')
            seen.add(key)
            element = objects[key]
            osm_tags = tags(element)
            shape = geometry(kind, osm_id)
            height, base = metres(osm_tags.get('height')), metres(osm_tags.get('min_height'))
            levels, roof_levels = number(osm_tags.get('building:levels')), number(osm_tags.get('roof:levels'))
            min_levels = number(osm_tags.get('building:min_level'))
            height_status = 'osm-tagged' if height is not None else 'unknown'
            estimate = height if height is not None else ((levels + (roof_levels or 0)) * 3 if levels is not None else 12)
            visual_source = 'OSM height tag; not independently surveyed' if height is not None else ('OSM levels × 3 m; approximate floor/roof spacing' if levels is not None else 'Illustrative 12 m fallback; no height or level count supplied')
            visual_base = base if base is not None else ((min_levels or 0) * 3)
            vertical_conflict = None
            if height is None and estimate <= visual_base:
                # Some mapped elevated bridges/roofs encode a part's level count,
                # rather than the total top level. Preserve those raw tags and
                # make this interpretation explicit rather than emitting an
                # impossible extrusion whose top lies beneath its base.
                estimate = visual_base + max(((levels or 0) + (roof_levels or 0)) * 3, 0.5)
                visual_source = 'Elevated-part interpretation: base plus tagged part/roof levels × 3 m; estimate, vertical tags ambiguous'
                vertical_conflict = 'Tagged level-derived top is not above its tagged minimum level; visual top interprets levels as elevated-part thickness.'
            # Official floor counts do not imply metric heights. Conflicts are
            # retained, with OSM massing only and a warning on each affected part.
            conflict = match.get('heightConflict')
            if conflict:
                visual_source += '; conflicting official floor count, see heightConflict'
            role = selected.get('role', 'building')
            url = f'https://www.openstreetmap.org/{kind}/{osm_id}'
            props = {
                'buildingId': building['id'], 'name': building['name'], 'partName': selected.get('name') or osm_tags.get('name'),
                'campus': building['campus'], 'role': role, 'affiliationVerified': True,
                'affiliation': building['membership']['status'], 'occupationScope': building['membership']['scope'],
                'affiliationEvidence': building['membership']['evidence'], 'officialSourceUrls': building['officialSourceUrls'],
                'geometrySource': 'OpenStreetMap', 'source': 'OpenStreetMap', 'sourceUrl': url, 'source_url': url,
                'osmType': kind, 'osmId': osm_id, 'osmVersion': int(element.get('version')),
                'geometrySourceDate': element.get('timestamp'), 'geometryRetrievedDate': max(s['retrievedAt'] for s in source_records)[:10],
                'sourceRelation': selected.get('relation'), 'geometryMatchBasis': match['matchBasis'],
                'geometryContextSourceUrls': match.get('contextSourceUrls', []),
                'height': height, 'heightStatus': height_status, 'heightSource': 'OSM height tag' if height is not None else None,
                'minHeight': base, 'min_height': base, 'minHeightStatus': 'osm-tagged' if base is not None else 'unknown',
                'levels': levels, 'roofLevels': roof_levels, 'minLevels': min_levels,
                'visualHeight': max(estimate, 0.5), 'visualMinHeight': visual_base, 'verticalTagConflict': vertical_conflict,
                'visualHeightStatus': 'osm-tagged' if height is not None else ('estimated-from-levels' if levels is not None else 'illustrative-fallback'),
                'visualHeightSource': visual_source, 'heightConflict': conflict,
                'roofShape': osm_tags.get('roof:shape'), 'osmTags': osm_tags,
                'notes': match.get('notes', []) + selected.get('notes', []),
            }
            feature = {'type': 'Feature', 'id': f'{kind}-{osm_id}', 'properties': props, 'geometry': shape}
            features.append(feature)
            matched_features.append(feature)
            source_urls.append(url)
            if role == 'outline':
                outlines.append(feature)
        # A footprint-derived label point is explicitly not an entrance/geocode.
        reference = (outlines or matched_features)[0]
        polygon = reference['geometry']['coordinates']
        polygon = polygon[0] if reference['geometry']['type'] == 'MultiPolygon' else polygon
        exterior = polygon[0]
        center = [sum(p[0] for p in exterior[:-1]) / (len(exterior) - 1), sum(p[1] for p in exterior[:-1]) / (len(exterior) - 1)]
        if not inside(center, exterior) or any(inside(center, ring) for ring in polygon[1:]):
            # Find an interior point without inventing a new polygon or claiming an entrance.
            xs, ys = [p[0] for p in exterior], [p[1] for p in exterior]
            candidates = [[min(xs) + (max(xs) - min(xs)) * x / 20, min(ys) + (max(ys) - min(ys)) * y / 20] for x in range(1, 20) for y in range(1, 20)]
            center = next((point for point in sorted(candidates, key=lambda p: (p[0]-center[0])**2+(p[1]-center[1])**2) if inside(point, exterior) and not any(inside(point, ring) for ring in polygon[1:])), exterior[0])
        index.append({'buildingId': building['id'], 'name': building['name'], 'campus': building['campus'],
                      'coordinates': {'lat': center[1], 'lng': center[0], 'sourceUrl': reference['properties']['sourceUrl'], 'kind': 'footprint-label-point'},
                      'geometryMatch': {'status': 'reviewed', 'featureIds': [f['id'] for f in matched_features], 'sourceUrls': source_urls,
                                        'basis': match['matchBasis'], 'notAnEntrance': True}})
        if match.get('heightConflict'):
            conflicts.append({'buildingId': building['id'], **match['heightConflict']})

    stats = {'directoryBuildings': len(directory), 'matchedBuildings': len(index), 'features': len(features),
             'renderedFeatures': sum(f['properties']['role'] != 'outline' for f in features),
             'outlineFeatures': sum(f['properties']['role'] == 'outline' for f in features),
             'taggedMetricHeights': sum(f['properties']['height'] is not None for f in features),
             'campuses': {campus: sum(i['campus'] == campus for i in index) for campus in ('bloomsbury', 'east', 'other')},
             'interiorRings': sum(sum(len(p)-1 for p in (f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']])) for f in features)}
    matched_ids = {item['buildingId'] for item in index}
    current_halls = [building for building in directory.values() if building.get('accommodation', {}).get('current')]
    stats['currentHallsTotal'] = len(current_halls)
    stats['currentHallsMapped'] = sum(building['id'] in matched_ids for building in current_halls)
    stats['affiliations'] = {status: sum(directory[item['buildingId']]['membership']['status'] == status for item in index) for status in ('ucl-used', 'ucl-partner')}
    meta = {'schemaVersion': 2, 'auditDate': manifest['auditDate'], 'snapshotDate': max(s['retrievedAt'] for s in source_records)[:10], 'attribution': '© OpenStreetMap contributors',
            'license': 'ODbL-1.0', 'licenseUrl': 'https://www.openstreetmap.org/copyright',
            'method': 'Explicit reviewed identity join of official UCL directory and unmodified OSM way/relation geometry. Geometry is never clipped to a campus rectangle.',
            'sources': source_records, 'statistics': stats, 'heightConflicts': conflicts,
            'limitations': [
                'UCL affiliation confirms a listed use, not freehold ownership or exclusive occupation; occupation scope follows the official directory.',
                'OSM geometry is community mapping, not a survey or architectural model. Source version and dates are recorded for each footprint.',
                'Heights are unknown unless an explicit OSM metric height tag exists. Floor-derived visual heights use 3 metres per level, including roof levels, and are estimates.',
                'Buildings without either height or levels use an explicitly illustrative 12 metre visual height. These values are not physical measurements.',
                'Roof shapes are retained as metadata; flat roof extrusion does not reconstruct pitched roofs, facades or exact physical massing.',
                'Shared premises show the external envelope; the dataset does not claim that UCL occupies every floor or the whole site.',
                'Unmatched directory entries remain searchable in the official directory but receive no fabricated map footprint or postal-address coordinate.',
                'South Quad temporary learning hub is included following the current August/September 2026 UCL facilities evidence, despite its temporary designation.',
                'Ambiguous elevated-part level tags are preserved and flagged; the visual interpretation keeps estimated tops above bases without claiming a metric survey.',
                'Part geometry is used for Cruciform and UCL East. Non-extruded outlines are kept separately for selection; renderer must filter role=outline from 3D extrusion.'
            ]}
    geojson = {'type': 'FeatureCollection', 'name': 'Verified UCL-associated building footprints', 'metadata': meta, 'features': features}
    index_data = {'schemaVersion': 1, 'auditDate': manifest['auditDate'], 'buildings': index}
    audited_unmatched = {item['buildingId']: item for item in manifest.get('unmatched', [])}
    missing_audits = set(directory) - matched_ids - set(audited_unmatched)
    if missing_audits:
        raise ValueError(f'New unmatched directory entries need a specific coverage audit: {sorted(missing_audits)}')
    quality = {**meta, 'unmatchedBuildings': [
        {'buildingId': building['id'], 'name': building['name'], 'campus': building['campus'],
         'address': building['address'], 'currentHall': bool(building.get('accommodation', {}).get('current')),
         'reasonCode': audited_unmatched[building['id']]['reasonCode'], 'reason': audited_unmatched[building['id']]['reason']}
        for building in directory.values() if building['id'] not in matched_ids
    ]}
    for filename, content in [('campus-buildings.geojson', geojson), ('campus-footprint-index.json', index_data), ('campus-building-quality.json', quality)]:
        (DATA / filename).write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(stats))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Fetch fresh public OSM extracts before importing')
    build(parser.parse_args().refresh)
