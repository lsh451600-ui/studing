import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('all three photos contribute to one search; additions, limit, and clearing work', async () => {
  const nodes = new Map(), workers = [], searches = [], revoked = [];
  const element = () => ({ files: [], value: '', children: [], handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, getContext() { return { drawImage() {} }; }, toBlob(fn) { fn({}); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = vm.createContext({
    document: { getElementById: node, createElement: element }, window: { addEventListener() {} },
    URL: { createObjectURL: () => 'blob:' + Math.random(), revokeObjectURL: url => revoked.push(url) },
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    createImageBitmap: async () => ({ width: 500, height: 500, close() {} }),
    Worker: class { constructor() { workers.push(this); this.messages = []; } postMessage(data) { this.messages.push(data); } terminate() { this.stopped = true; } },
    fetch: async url => { searches.push(url); return { ok: true, json: async () => ({ recommendations: [] }) }; },
  });
  vm.runInContext(readFileSync(new URL('../assets/js/ingredient-search.js', import.meta.url), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const add = async count => { node('ingredient-photo').files = Array.from({length:count}, () => ({type:'image/jpeg',size:100})); node('ingredient-photo').handlers.change(); await settle(); };
  const result = (worker, ingredients) => worker.onmessage({ data: { type: 'result', ingredients } });
  await add(1); result(workers[0], ['달걀']); await settle();
  assert.equal(searches.length,1);
  await add(2); const worker = workers.at(-1);
  result(worker,['달걀']); assert.equal(searches.length,1);
  result(worker,['두부','달걀']); assert.equal(searches.length,1);
  result(worker,['대파']); await settle();
  assert.equal(searches.length,2);
  assert.equal(new URLSearchParams(searches[1].split('?')[1]).get('ingredients'),'달걀, 두부, 대파');
  assert.equal(worker.messages.length,3);
  assert.equal(node('ingredient-preview').children.length,3);
  await add(1); assert.equal(workers.length,2); assert.match(node('ingredient-photo-status').textContent,/최대 3장/);
  node('ingredient-clear').handlers.click();
  assert.equal(revoked.length,3); assert.equal(node('ingredient-preview').children.length,0);
  await add(3); assert.equal(node('ingredient-preview').children.length,3);
  node('ingredient-clear').handlers.click();
  result(workers.at(-1),['감자']); await settle(); assert.equal(searches.length,2);
});
