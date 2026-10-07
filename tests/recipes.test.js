import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, matchesPassword } from '../functions/api/recipes.js';
const secret = 'test-only-password';
const req = (password = secret, origin = 'https://studing.pages.dev') => new Request('https://studing.pages.dev/api/recipes', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
});
test('compares exact passwords, including leading zeros', async () => {
  assert.equal(await matchesPassword('0078', '0078'), true);
  assert.equal(await matchesPassword('78', '0078'), false);
});
test('fails closed without a configured secret', async () => {
  const response = await onRequest({ request: req(), env: {} });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
});
test('GET returns readiness without recipe data; foreign-origin requests are rejected', async () => {
  const status = await onRequest({ request: new Request('https://studing.pages.dev/api/recipes'), env: { RECIPE_PASSWORD: secret } });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { available: true });
  assert.equal((await onRequest({ request: req(secret, 'https://other.example'), env: { RECIPE_PASSWORD: secret } })).status, 403);
});
test('wrong passwords receive no content and correct passwords open the page', async () => {
  const env = { RECIPE_PASSWORD: secret };
  const denied = await onRequest({ request: req('wrong'), env });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).recipes, undefined);
  const allowed = await onRequest({ request: req(), env });
  assert.equal(allowed.status, 200);
  const data = await allowed.json();
  assert.equal(data.title, '레시피');
  assert.deepEqual(data.recipes, []);
  assert.ok(!JSON.stringify(data).includes(secret));
});
test('malformed and oversized input is rejected', async () => {
  const env = { RECIPE_PASSWORD: secret };
  assert.equal((await onRequest({ request: req('x'.repeat(600)), env })).status, 400);
  assert.equal((await onRequest({ request: req(null), env })).status, 400);
});
