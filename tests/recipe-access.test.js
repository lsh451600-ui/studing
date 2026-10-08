import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/recipes.js';
import { authorized } from '../src/recipe-server.js';
const env = { RECIPE_PASSWORD: 'reader-pass', RECIPE_ADMIN_PASSWORD: 'owner-password-long' };
function request(password) { return new Request('https://example.test/api/recipes', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); }
async function login(password, settings = env) {
  const response = await onRequest({ request: request(password), env: settings });
  const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const session = new Request('https://example.test/api/recipe-posts', { headers: { Cookie: cookies } });
  return { response, session, data: await response.json() };
}
test('writer password alone unlocks reading without account publishing permission', async () => {
  const { response, session, data } = await login(env.RECIPE_ADMIN_PASSWORD);
  assert.equal(response.status, 200); assert.equal(data.canWrite, false); assert.equal(data.accountWriter, false);
  assert.equal(await authorized(session, env, 'admin'), true);
  assert.equal(await authorized(session, env, 'viewer'), true);
});
test('reader entry cannot grant write permission; wrong password is rejected', async () => {
  const { session, data } = await login(env.RECIPE_PASSWORD);
  assert.equal(data.canWrite, false); assert.equal(await authorized(session, env, 'admin'), false);
  assert.equal(await authorized(session, env, 'viewer'), true);
  assert.equal((await login('wrong-password')).response.status, 401);
});
test('unconfigured writer/storage are reported without granting writing access', async () => {
  const settings = { RECIPE_PASSWORD: 'reader-pass' };
  const { data, session } = await login(settings.RECIPE_PASSWORD, settings);
  assert.equal(data.adminConfigured, false); assert.equal(data.storageAvailable, false);
  assert.equal(data.canWrite, false); assert.equal(await authorized(session, settings, 'admin'), false);
});
