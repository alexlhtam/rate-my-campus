import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename } from 'node:path';
import ts from 'typescript';

const temp = await mkdtemp(fileURLToPath(new URL('.community-refresh-', import.meta.url)));
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
await writeFile(join(temp, 'hooks.mjs'), 'export const useState=(...args)=>globalThis.__campusHooks.useState(...args); export const useEffect=(...args)=>globalThis.__campusHooks.useEffect(...args); export const useRef=(...args)=>globalThis.__campusHooks.useRef(...args);');
await writeFile(join(temp, 'view.mjs'), compile(await readFile(new URL('../lib/community-view.ts', import.meta.url), 'utf8')));
const source = (await readFile(new URL('../components/place-community.tsx', import.meta.url), 'utf8')).replace("from 'react'", "from './hooks.mjs'").replace("from '@/lib/community-view'", "from './view.mjs'");
await writeFile(join(temp, 'component.mjs'), compile(source));
const Component = (await import(pathToFileURL(join(temp, 'component.mjs')).href)).default;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
function nodes(node, predicate, result = []) { if (node && typeof node === 'object') { if (predicate(node)) result.push(node); const children = Array.isArray(node) ? node : [node.props?.children]; for (const child of children) nodes(child, predicate, result); } return result; }
// An isolated hook scheduler exercises asynchronous pagination without a DOM or
// modifying production code. JSX stays as React elements; event handlers run normally.
function harness(initialProps) {
  const slots = []; let cursor = 0; let pending = []; let dirty = true; let props = initialProps; let tree;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, update => { const next = typeof update === 'function' ? update(slots[index].value) : update; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++; const previous = slots[index]; if (!previous || !deps || deps.some((item, i) => !Object.is(previous.deps?.[i], item))) { slots[index] = { deps, cleanup: previous?.cleanup }; pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  function render() { let cycles = 0; while (dirty) { if (++cycles > 20) throw new Error('Unexpected render loop'); dirty = false; cursor = 0; pending = []; globalThis.__campusHooks = hooks; tree = Component(props); for (const effect of pending) effect(); } return tree; }
  return { render, async flush() { render(); for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } return tree; }, update(next) { props = { ...props, ...next }; dirty = true; }, cleanup() { for (const slot of slots) slot.cleanup?.(); delete globalThis.__campusHooks; } };
}
const base = { place: { id: 'library', category: 'study' }, demo: false, tab: 'reviews', reviews: [], threads: [], replies: [], summary: { count: 60 }, votes: {}, ai: false, refreshKey: 'v1', onReview() {}, onThread() {}, onReport() {}, async onAction() {}, onNotice() {} };
const reviews = prefix => Array.from({ length: 30 }, (_, i) => ({ id: `${prefix}-${i}`, placeId: 'library', rating: 4, text: `${prefix} review ${i}`, status: 'approved', term: '2026' }));

test('a data revision at page two replaces stale pages with the latest first page and resets the next offset', async () => {
  const originalFetch = globalThis.fetch; let revision = 1; const requests = [];
  globalThis.fetch = async url => { const offset = Number(new URL(url, 'https://campus.test').searchParams.get('offset')); requests.push(offset); return { ok: true, async json() { return { rows: reviews(revision === 1 ? offset === 0 ? 'removed' : 'old-second' : offset === 0 ? 'new-first' : 'new-second'), total: 60 }; } }; };
  const app = harness(base);
  try {
    let tree = await app.flush(); assert.match(text(tree), /removed review 0/);
    nodes(tree, node => node.type === 'button' && text(node) === 'Load more reviews')[0].props.onClick();
    tree = await app.flush(); assert.match(text(tree), /old-second review 0/);
    revision = 2; app.update({ refreshKey: 'v2' }); tree = await app.flush();
    assert.match(text(tree), /new-first review 0/); assert.ok(!text(tree).includes('removed review')); assert.ok(!text(tree).includes('old-second review'));
    assert.deepEqual(requests, [0, 30, 0], 'Do not refetch the obsolete page offset');
    nodes(tree, node => node.type === 'button' && text(node) === 'Load more reviews')[0].props.onClick();
    tree = await app.flush(); assert.match(text(tree), /new-second review 0/); assert.equal(requests.at(-1), 30);
    app.update({ refreshKey: 'v2' }); await app.flush(); assert.equal(requests.length, 4, 'Unchanged fingerprints must not reset paging on a polling rerender');
  } finally { app.cleanup(); globalThis.fetch = originalFetch; }
});

test('own pending discussion keeps its status and reason visible and cannot open the reply composer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { rows: [{ id: 'pending-thread', placeId: 'library', title: 'My pending question', text: 'Question', own: true, status: 'pending', moderationReason: 'Waiting for automated review' }], total: 1 }; } });
  const app = harness({ ...base, tab: 'community' });
  try {
    const tree = await app.flush();
    assert.match(text(tree), /pending · visible only to you/); assert.match(text(tree), /Waiting for automated review/);
    const button = nodes(tree, node => node.type === 'button' && text(node).includes('Join the conversation'))[0];
    assert.equal(button.props.disabled, true);
    button.props.onClick(); const after = await app.flush();
    assert.equal(nodes(after, node => typeof node.type === 'function' && node.type.name === 'Replies').length, 0);
  } finally { app.cleanup(); globalThis.fetch = originalFetch; }
});

test.after(async () => { assert.equal(dirname(temp), fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')); assert.ok(basename(temp).startsWith('.community-refresh-')); await rm(temp, { recursive: true, force: true }); });
