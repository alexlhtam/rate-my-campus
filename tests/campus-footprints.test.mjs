import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const data = await read('public/data/campus-buildings.geojson');
const directory = await read('public/data/campus-directory.json');
const index = await read('public/data/campus-footprint-index.json');
const manifest = await read('scripts/import-campus-buildings.manifest.json');
const polygons = feature => feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];

test('every footprint is an explicitly reviewed official directory join with reproducible OSM provenance', () => {
  const buildings = new Map(directory.buildings.map(building => [building.id, building]));
  const expected = new Set(manifest.matches.flatMap(match => match.features.map(feature => `${feature.type || 'way'}-${feature.id}`)));
  const actual = new Set();
  assert.ok(index.buildings.length >= 75);
  for (const feature of data.features) {
    const properties = feature.properties, official = buildings.get(properties.buildingId);
    assert.ok(official, properties.buildingId);
    assert.ok(['ucl-used', 'ucl-partner'].includes(official.membership.status), `Unverified affiliation for ${properties.buildingId}`);
    if (official.membership.status === 'ucl-partner') assert.equal(properties.occupationScope, 'shared-site', 'Partner halls must not become exclusive UCL property');
    assert.equal(properties.affiliationVerified, true);
    assert.equal(properties.occupationScope, official.membership.scope);
    assert.equal(properties.campus, official.campus);
    assert.match(properties.sourceUrl, /^https:\/\/www.openstreetmap.org\/(way|relation)\/\d+$/);
    assert.ok(properties.osmVersion >= 1);
    assert.ok(!Number.isNaN(Date.parse(properties.geometrySourceDate)));
    assert.ok(properties.officialSourceUrls.some(url => url.startsWith('https://www.ucl.ac.uk/')));
    assert.ok(expected.has(feature.id), `Unreviewed footprint ${feature.id}`);
    assert.ok(!actual.has(feature.id), `Duplicate footprint ${feature.id}`);
    actual.add(feature.id);
  }
  assert.deepEqual(actual, expected);
  assert.equal(data.metadata.statistics.matchedBuildings, index.buildings.length);
  assert.ok(data.metadata.sources.length >= 3);
  for (const source of data.metadata.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
});

test('all complete source rings retain valid finite coordinates, closure and GeoJSON winding', () => {
  for (const feature of data.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    for (const polygon of polygons(feature)) for (const [ringIndex, ring] of polygon.entries()) {
      assert.ok(ring.length >= 4, feature.id);
      assert.deepEqual(ring[0], ring.at(-1), `${feature.id}: source ring must close`);
      for (const [lng, lat] of ring) {
        assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
        assert.ok(Math.abs(lng) <= 180 && Math.abs(lat) <= 85, `${feature.id}: valid Web Mercator coordinates; membership is verified by sources, not a London clipping box`);
      }
      const signedArea = ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
      assert.ok(ringIndex === 0 ? signedArea > 0 : signedArea < 0, `${feature.id}: ring ${ringIndex} winding`);
    }
  }
});

test('Cruciform renders its real cross and low podium parts, never its enclosing rectangle as a tower', () => {
  const cruciform = data.features.filter(feature => feature.properties.buildingId === 'ucl-cruciform-building');
  const envelope = cruciform.find(feature => feature.properties.osmId === 863409196);
  const cross = cruciform.find(feature => feature.properties.osmId === 27432119);
  assert.equal(envelope.properties.role, 'outline');
  assert.equal(cross.properties.role, 'part');
  assert.equal(cross.geometry.coordinates[0].length, 121);
  assert.equal(cross.properties.sourceRelation, 11790454);
  const podium = cruciform.filter(feature => feature !== cross && feature !== envelope);
  assert.equal(podium.length, 6);
  assert.ok(podium.every(feature => feature.properties.role === 'part' && feature.properties.visualHeight < cross.properties.visualHeight));
});

test('courtyards and both UCL East complexes retain separate real massing components', () => {
  const senate = data.features.find(feature => feature.id === 'relation-11948662');
  assert.equal(senate.properties.role, 'outline');
  assert.equal(senate.geometry.coordinates.length, 4, 'Senate House has three courtyard holes');
  const bedford = data.features.find(feature => feature.id === 'relation-7962897');
  assert.equal(bedford.geometry.coordinates.length, 4, 'Bedford multipolygon part has three courtyard holes');
  assert.equal(bedford.properties.role, 'part');
  for (const buildingId of ['ucl-marshgate', 'ucl-one-pool-street']) {
    const features = data.features.filter(feature => feature.properties.buildingId === buildingId);
    assert.equal(features.filter(feature => feature.properties.role === 'outline').length, 1);
    assert.ok(features.filter(feature => feature.properties.role === 'part').length >= 3);
    assert.ok(features.every(feature => feature.properties.campus === 'east'));
  }
});

test('unknown metric heights remain null and visual estimates cannot masquerade as surveyed heights', () => {
  let unknown = 0;
  for (const { id, properties } of data.features) {
    assert.ok(properties.visualHeight > properties.visualMinHeight, id);
    if (properties.height === null) {
      unknown++;
      assert.equal(properties.heightStatus, 'unknown');
      assert.ok(['estimated-from-levels', 'illustrative-fallback'].includes(properties.visualHeightStatus));
    } else {
      assert.equal(properties.heightStatus, 'osm-tagged');
      assert.ok(properties.osmTags.height);
    }
  }
  assert.ok(unknown > 100);
  const marshgate = data.features.filter(feature => feature.properties.buildingId === 'ucl-marshgate');
  assert.ok(marshgate.every(feature => feature.properties.heightConflict?.officialSourceUrl));
  assert.ok(index.buildings.every(building => building.geometryMatch.notAnEntrance === true));
});
