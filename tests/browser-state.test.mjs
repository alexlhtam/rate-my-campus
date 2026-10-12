import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const foodSource = await readFile(new URL('../lib/food.ts', import.meta.url), 'utf8');
const foodCode=ts.transpileModule(foodSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const source = (await readFile(new URL('../lib/browser-state.ts', import.meta.url), 'utf8')).replace("'./food'", "'data:text/javascript;base64,"+Buffer.from(foodCode).toString('base64')+"'");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseDemoState, readSavedIDs, safeStorageRead, safeStorageWrite } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('missing, corrupted and incompatible browser state always produces iterable defaults', () => {
  for (const raw of [null, '{broken', '[]', '"str"', '42', '{"reviews":{},"posts":"string","votes":[]}']) {
    const state = parseDemoState(raw);
    for (const key of ['reviews', 'posts', 'threads', 'replies', 'reports']) assert.deepEqual(state[key], []);
    assert.deepEqual(state.votes, {});
  }
  assert.deepEqual(readSavedIDs('{}'), []); assert.deepEqual(readSavedIDs('null'), []); assert.deepEqual(readSavedIDs('["a","a",{},3,"../a","b"]'), ['a', 'b']);
});
test('local contributions preserve usable fields while rejecting unsafe display shapes and fake account identity', () => {
  const input = { reviews: [{ id: 'review-a', placeId: 'library', rating: 4, tags: ['Quiet', {}], text: {}, term: 'Autumn', year: 2026, criteria: { comfort: 4, wifi: 99 }, demo: false, own: false, userId: 'private' }],
    posts: [{ id: 'food-a', type: 'food', title: 'Lunch', description: 'Soup', lat: 51.5, lng: -0.1, expiresAt: '2026-10-13T09:00:00Z', dietary: { arbitrary: 1 }, portionsRemaining: 4, collectionInstructions: 'Foyer', price: 0, image: 'data:image/png;base64,YQ==' }],
    threads: [{ id: 'thread-a', placeId: 'library', title: {}, text: ['bad'] }], replies: [{ id: 'reply-a', threadId: 'thread-a', text: 'Hello' }], votes: { 'food-a': 'gone', 'review-a': 'helpful', nope: 'admin' } };
  const out = parseDemoState(JSON.stringify(input));
  assert.equal(out.reviews[0].demo, true); assert.equal(out.reviews[0].own, true); assert.equal(out.reviews[0].userId, undefined);
  assert.deepEqual(out.reviews[0].criteria, { comfort: 4 }); assert.deepEqual(out.reviews[0].tags, ['Quiet']); assert.equal(out.reviews[0].text, '');
  assert.deepEqual(out.posts[0].dietary, []); assert.equal(out.posts[0].portionsRemaining, 4); assert.equal(out.posts[0].price, 0); assert.equal(out.posts[0].image, input.posts[0].image);
  assert.equal(out.threads[0].title, ''); assert.equal(out.replies[0].text, 'Hello'); assert.deepEqual(out.votes, { 'food-a': 'gone', 'review-a': 'helpful' });
});
test('invalid local pins and ratings never reach map or rating consumers', () => {
  const out = parseDemoState(JSON.stringify({ reviews: [{ id: 'x', placeId: 'a', rating: '5' }, { id: 'y', placeId: 'a', rating: 999 }], posts: [{ id: 'z', type: 'food', title: 'Oops', expiresAt: 'invalid', lat: 500, lng: 0 }] }));
  assert.deepEqual(out.reviews, []); assert.deepEqual(out.posts, []);
});
test('denied reads, full storage and browser storage getter errors are handled without throwing', () => {
  const failed = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota exceeded'); } };
  assert.equal(safeStorageRead('a', failed), null); assert.equal(safeStorageWrite('a', 'data', failed), false);
  const writes = []; const memory = { getItem: () => 'data', setItem: (...args) => writes.push(args) };
  assert.equal(safeStorageRead('a', memory), 'data'); assert.equal(safeStorageWrite('a', 'data', memory), true); assert.deepEqual(writes, [['a', 'data']]);
  const original = globalThis.window;
  try { globalThis.window = Object.defineProperty({}, 'localStorage', { get() { throw new Error('disabled'); } }); assert.equal(safeStorageRead('a'), null); assert.equal(safeStorageWrite('a', 'data'), false); }
  finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('food metadata, closure and revision survive reload without turning declared details into verified facts', () => {
  const post = { id: 'food-roundtrip', type: 'food', title: 'Society lunch', description: 'Boxed lunches', location: 'Student Centre', lat: 51.5246, lng: -.134,
    expiresAt: '2026-10-12T12:45:00Z', createdAt: '2026-10-12T12:00:00Z', availabilityUpdatedAt: '2026-10-12T12:10:00Z', closedAt: '2026-10-12T12:10:00Z', closureReason: 'collected', portionsRemaining: 0, revision: 4, collectionInstructions: 'Collect from the society table.',
    foodDetails: { allergenStatus: 'provided', allergens: ['milk', 'cereals-gluten'], ingredients: 'Wheat, milk', handling: 'Sealed boxes', sourceLabel: 'Chess Society', pickupAccess: 'ucl', bringContainer: true },
    freshStillCount: 99, freshGoneCount: 99, userId: 'private-account', demo: false, own: false };
  const parsed = parseDemoState(JSON.stringify({ posts: [post], foodFeedback: { 'demo-sample': { kind: 'still', at: 1791806400000 } } }));
  const restored = parsed.posts[0];
  assert.equal(restored.revision, 4); assert.equal(restored.portionsRemaining, 0); assert.equal(restored.closedAt, post.closedAt); assert.equal(restored.closureReason, 'collected'); assert.equal(restored.availabilityUpdatedAt, post.availabilityUpdatedAt);
  assert.deepEqual(restored.foodDetails, post.foodDetails); assert.equal(restored.collectionInstructions, post.collectionInstructions);
  assert.equal(restored.demo, true); assert.equal(restored.own, true); assert.equal(restored.userId, undefined); assert.equal(restored.freshStillCount, undefined); assert.equal(restored.freshGoneCount, undefined);
  assert.deepEqual(parsed.foodFeedback['demo-sample'], { kind: 'still', at: 1791806400000 });
});

test('older food drafts keep allergens unknown and malformed feedback is discarded during reload', () => {
  const post = { id: 'legacy-food', type: 'food', title: 'Lunch', lat: 51.5, lng: -.1, expiresAt: '2026-10-12T13:00:00Z', revision: '5', foodDetails: { allergenStatus: 'provided', allergens: ['not-an-allergen'], ingredients: '  ' } };
  const parsed = parseDemoState(JSON.stringify({ posts: [post], foodFeedback: { good: { kind: 'gone', at: 1791806400000 }, invalid: { kind: 'admin', at: 1791806400000 }, invalidTime: { kind: 'still', at: 'today' }, '../path': { kind: 'gone', at: 1791806400000 } } }));
  assert.equal(parsed.posts[0].revision, 0); assert.equal(parsed.posts[0].foodDetails.allergenStatus, 'unknown'); assert.deepEqual(parsed.posts[0].foodDetails.allergens, []);
  assert.deepEqual(Object.keys(parsed.foodFeedback), ['good']);
});
