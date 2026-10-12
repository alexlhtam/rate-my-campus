import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/data.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const data = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const placeById = new Map(data.places.map(place => [place.id, place]));

test('demo reviews aggregate through the same canonical keys accepted by the review form', () => {
  const expected = {
    study: ['comfort', 'plugs', 'wifi', 'noise', 'accessibility'],
    lecture: ['comfort', 'plugs', 'wifi', 'noise', 'accessibility'],
    halls: ['value', 'cleanliness', 'social', 'staff', 'location'],
    rental: ['landlord', 'deposit', 'damp', 'value', 'noise'],
  };
  for (const review of data.seedReviews) {
    const place = placeById.get(review.placeId);
    assert.ok(place, `Unknown place on review ${review.id}`);
    assert.deepEqual(Object.keys(review.criteria), expected[place.category]);
    for (const value of Object.values(review.criteria)) {
      assert.ok(Number.isInteger(value) && value >= 1 && value <= 5);
    }
    assert.ok(review.rating >= 1 && review.rating <= 5);
  }
});

test('demo content remains distinguishable from real submissions and real event times', () => {
  const rows = [...data.places, ...data.seedReviews, ...data.seedPins, ...data.seedThreads];
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'IDs must be unique');
  for (const row of [...data.seedReviews, ...data.seedPins, ...data.seedThreads]) {
    assert.equal(row.demo, true);
  }
  for (const pin of data.seedPins) {
    assert.ok(pin.durationMinutes > 0);
    assert.equal(pin.expiresAt, undefined, 'A demo must not claim an absolute live expiry');
    assert.equal(pin.startsAt, undefined, 'A demo must not claim an absolute event date');
  }
  for (const thread of data.seedThreads) assert.ok(placeById.has(thread.placeId));
  const rental = data.places.find(place => place.category === 'rental');
  assert.equal(rental.demo, true);
  assert.match(rental.name, /^Example /);
  assert.match(rental.address, /approximate location only/);
});

test('all locally rendered photographs exist and have complete attribution', async () => {
  for (const row of [...data.places, ...data.seedPins].filter(row => row.image)) {
    assert.match(row.image, /^\/images\/[a-z-]+\.jpg$/);
    await access(new URL(`../public${row.image}`, import.meta.url));
    const credit = data.imageCredits.find(item => item.id === row.imageCredit);
    assert.ok(credit, `Missing credit for ${row.id}`);
    for (const field of ['title', 'author', 'sourceUrl', 'license', 'licenseUrl', 'changes']) {
      assert.ok(credit[field]?.length, `Missing ${field} for ${row.image}`);
    }
    assert.match(credit.sourceUrl, /^https:\/\/commons\.wikimedia\.org\//);
    assert.match(credit.licenseUrl, /^https:\/\/creativecommons\.org\//);
  }
});
