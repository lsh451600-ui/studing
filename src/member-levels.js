import { currentSession, settings } from './member-auth.js';
import { memberProfile } from './social-auth.js';
import { isOperator } from './board-permissions.js';
export async function ensureLevels(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS member_levels (member_id TEXT PRIMARY KEY, level TEXT NOT NULL CHECK(level IN ('regular','special')), updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare('CREATE TABLE IF NOT EXISTS member_level_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL, previous_level TEXT NOT NULL, level TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
}
export async function levelOf(db, id) {
  if (!db) return 'regular';
  await ensureLevels(db);
  return (await db.prepare('SELECT level FROM member_levels WHERE member_id = ?').bind(id).first())?.level || 'regular';
}
export async function membership(request, env) {
  if (!settings(env).ready) return { authenticated: false, isAdmin: false, level: 'regular', canAccessRecipes: false };
  const session = await currentSession(request, env);
  if (!session.user) return { authenticated: false, isAdmin: false, level: 'regular', canAccessRecipes: false, session };
  const profile = await memberProfile(env, session), isAdmin = isOperator(profile);
  const level = await levelOf(env.MEMBERS_DB, session.user.id);
  return { authenticated: true, id: session.user.id, session, profile, isAdmin, level, canAccessRecipes: isAdmin || level === 'special' };
}

// Resolve current grades when rendering, so old posts follow promotions and demotions.
export async function authorLevels(db, rows) {
  const ids = [...new Set(rows.map(row => row.author_id).filter(Boolean))];
  if (!ids.length || !db) return rows.map(({ author_id, ...row }) => ({ ...row, authorLevel: 'regular' }));
  await ensureLevels(db);
  const levels = new Map();
  for (let start = 0; start < ids.length; start += 90) {
    const batch = ids.slice(start, start + 90);
    const { results } = await db.prepare('SELECT member_id, level FROM member_levels WHERE member_id IN (' + batch.map(() => '?').join(',') + ')').bind(...batch).all();
    for (const row of results) levels.set(row.member_id, row.level);
  }
  return rows.map(({ author_id, ...row }) => ({ ...row, authorLevel: levels.get(author_id) || 'regular' }));
}
