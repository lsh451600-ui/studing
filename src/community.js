import { currentSession, reply, settings } from './member-auth.js';
import { memberProfile } from './social-auth.js';
export async function initialize(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS community_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS community_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS community_comments_post ON community_comments(post_id, id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS community_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
  ]);
}
export async function member(request, env) {
  if (!settings(env).ready) return { response: reply(503, '로그인 연결을 확인해 주세요.') };
  const session = await currentSession(request, env);
  if (!session.user) return { response: reply(401, '로그인 후 작성할 수 있습니다.', {}, session.cookies) };
  const profile = await memberProfile(env, session);
  if (!profile) return { response: reply(403, '회원 정보를 입력한 뒤 작성해 주세요.', {}, session.cookies) };
  // Profiles created before the nickname migration may not have a nickname yet.
  return { session, author: profile.nickname || profile.username };
}
export async function allowWrite(db, user, scope) {
  const now = Date.now(), period = Math.floor(now / 600000);
  const row = await db.prepare('INSERT INTO community_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts')
    .bind(scope + ':' + user + ':' + period, (period + 1) * 600000).first();
  await db.prepare('DELETE FROM community_limits WHERE expires_at < ?').bind(now).run();
  return row.attempts <= (scope === 'post' ? 5 : 20);
}
export function idOf(value) { return /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
