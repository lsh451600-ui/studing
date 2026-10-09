import { membership } from './member-levels.js';
import { validatePost as validateRecipePost } from './recipe-server.js';
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
  const auth = await membership(request, env);
  if (!auth.canAccessRecipes) return false;
  if (auth.isAdmin) return true;
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
  for (const [name, definition] of [['author_id', 'TEXT'], ['downloads', 'INTEGER NOT NULL DEFAULT 0'], ['attachment_base64', 'TEXT'], ['attachment_name', 'TEXT'], ['attachment_type', 'TEXT']]) {
    if (columns.some(column => column.name === name)) continue;
    try { await db.prepare(`ALTER TABLE private_posts ADD COLUMN ${name} ${definition}`).run(); }
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
export async function ensureComments(db) {
  await ensurePosts(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS private_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES private_posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS private_comments_post ON private_comments(post_id,id)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS community_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
}
export async function listPosts(db, before = null, { identity = null, page = 1, q = '', sort = 'latest' } = {}) {
  await ensureComments(db);
  const fields = 'id, author_id, title, body, created_at, downloads, (SELECT COUNT(*) FROM private_comments WHERE post_id = private_posts.id) AS comment_count, (image_type IS NOT NULL) AS has_image, attachment_name';
  const filters = [], values = [];
  if (q) { filters.push('(instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0)'); values.push(q, q); }
  if (before) { filters.push('id < ?'); values.push(before); }
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const { total } = await db.prepare('SELECT COUNT(*) AS total FROM private_posts' + where).bind(...values).first();
  const totalPages = Math.max(1, Math.ceil(total / 10)); page = Math.min(page, totalPages);
  const order = sort === 'title' ? 'title COLLATE NOCASE ASC, id DESC' : sort === 'downloads' ? 'downloads DESC, id DESC' : 'id DESC';
  const { results } = await db.prepare(`SELECT ${fields} FROM private_posts${where} ORDER BY ${order} LIMIT 10 OFFSET ?`).bind(...values, (page - 1) * 10).all();
  const posts = results.map(({ author_id, ...post }) => ({ ...post, canEdit: canManagePost(identity, author_id), canDelete: canManagePost(identity, author_id), image_url: post.has_image ? `/api/private-image?id=${post.id}` : null, attachment_url: post.attachment_name ? `/api/private-file?id=${post.id}` : null }));
  return { posts, page, total, totalPages, next: page < totalPages && posts.length ? posts.at(-1).id : null };
}
export function validatePost(data) {
  return validateRecipePost({ ...data, category: '미분류' });
}
