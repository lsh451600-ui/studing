import { canManagePost } from './board-permissions.js';
export function reply(status, data, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
export async function readJSON(request, maximum = 1024) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json') || !request.body) throw new Error('invalid');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function matchesPassword(candidate, expected) {
  const [left, right] = await Promise.all([candidate, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right); let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function adminReady(env) {
  return typeof env.RECIPE_ADMIN_PASSWORD === 'string' && env.RECIPE_ADMIN_PASSWORD.length >= 12 && env.RECIPE_ADMIN_PASSWORD !== env.RECIPE_PASSWORD;
}
function secretFor(env, role) {
  if (role === 'admin') return adminReady(env) ? env.RECIPE_ADMIN_PASSWORD : null;
  return env.RECIPE_PASSWORD ? `${env.RECIPE_PASSWORD}:${env.RECIPE_ADMIN_PASSWORD || ''}` : null;
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`private-session-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
export async function sessionCookie(env, role) {
  const seconds = role === 'admin' ? 3600 : 28800;
  const payload = `${role}.${Math.floor(Date.now() / 1000) + seconds}.${crypto.randomUUID()}`;
  const token = `${payload}.${await sign(payload, secretFor(env, role))}`;
  return `private_${role}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${seconds}`;
}
export function clearCookie(role) {
  return `private_${role}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`;
}
async function validSession(request, env, role) {
  const secret = secretFor(env, role); if (!secret) return false;
  const cookies = (request.headers.get('Cookie') || '').split(';').map(c => c.trim());
  const cookie = cookies.find(c => c.startsWith(`private_${role}=`)); if (!cookie) return false;
  const token = cookie.slice(cookie.indexOf('=') + 1), parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== role || !/^\d+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
  const now = Math.floor(Date.now() / 1000), expiry = Number(parts[1]);
  if (expiry <= now || expiry > now + (role === 'admin' ? 3600 : 28800)) return false;
  return matchesPassword(parts[3], await sign(parts.slice(0, 3).join('.'), secret));
}
export async function authorized(request, env, role = 'viewer') {
  if (await validSession(request, env, 'admin')) return true;
  return role === 'viewer' && await validSession(request, env, 'viewer');
}
export const POST_SCHEMA = `CREATE TABLE IF NOT EXISTS private_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
  image_base64 TEXT, image_type TEXT, created_at TEXT NOT NULL
)`;
export async function ensurePosts(db) {
  await db.prepare(POST_SCHEMA).run();
  const columns = (await db.prepare('PRAGMA table_info(private_posts)').all()).results;
  if (!columns.some(column => column.name === 'author_id')) {
    try { await db.prepare('ALTER TABLE private_posts ADD COLUMN author_id TEXT').run(); }
    catch (error) { if (!/duplicate column/i.test(String(error?.message))) throw error; }
  }
}
export async function rateLimit(request, db, scope, maximum = 10) {
  if (!db) return true;
  await db.prepare('CREATE TABLE IF NOT EXISTS private_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 900);
  const key = hex(await crypto.subtle.digest('SHA-256', encoder.encode(`${scope}:${window}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`)));
  const row = await db.prepare('INSERT INTO private_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts')
    .bind(key, (window + 1) * 900).first();
  await db.prepare('DELETE FROM private_limits WHERE expires_at < ?').bind(now).run();
  return row.attempts <= maximum;
}
export async function listPosts(db, before = null, { identity = null } = {}) {
  await ensurePosts(db);
  const fields = 'id, author_id, title, body, created_at, (image_type IS NOT NULL) AS has_image';
  const query = before ? db.prepare(`SELECT ${fields} FROM private_posts WHERE id < ? ORDER BY id DESC LIMIT 21`).bind(before)
    : db.prepare(`SELECT ${fields} FROM private_posts ORDER BY id DESC LIMIT 21`);
  const { results } = await query.all();
  const posts = results.slice(0, 20).map(({ author_id, ...post }) => ({ ...post, canEdit: canManagePost(identity, author_id), canDelete: canManagePost(identity, author_id), image_url: post.has_image ? `/api/private-image?id=${post.id}` : null }));
  return { posts, next: results.length > 20 ? posts[posts.length - 1].id : null };
}
export function validatePost(data) {
  if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') throw new Error('제목과 내용을 입력해 주세요.');
  const title = data.title.trim(), body = data.body.trim();
  if (!title || title.length > 120 || !body || body.length > 20000) throw new Error('제목은 120자, 내용은 20,000자 이내로 입력해 주세요.');
  let imageBase64 = null, imageType = null;
  if (data.image) {
    if (typeof data.image.base64 !== 'string' || data.image.base64.length > 1398104 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.image.base64)) throw new Error('이미지는 1MB 이하로 올려 주세요.');
    let bytes;
    try { bytes = Uint8Array.from(atob(data.image.base64), c => c.charCodeAt(0)); } catch { throw new Error('이미지 형식을 확인해 주세요.'); }
    if (bytes.length > 1048576 || bytes.length < 12) throw new Error('이미지는 1MB 이하로 올려 주세요.');
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) imageType = 'image/jpeg';
    else if (bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])) imageType = 'image/png';
    else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') imageType = 'image/webp';
    else throw new Error('JPG, PNG, WebP 이미지만 올릴 수 있습니다.');
    if (data.image.type !== imageType) throw new Error('이미지 형식을 확인해 주세요.');
    imageBase64 = data.image.base64;
  }
  return { title, body, imageBase64, imageType };
}
