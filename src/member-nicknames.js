export async function ensureNicknames(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS member_nicknames (member_id TEXT PRIMARY KEY, nickname TEXT NOT NULL, nickname_key TEXT NOT NULL UNIQUE)').run();
}
export async function savedNickname(db, memberId) {
  if (!db) return null;
  try {
    return (await db.prepare('SELECT nickname FROM member_nicknames WHERE member_id = ?').bind(memberId).first())?.nickname || null;
  } catch (error) {
    if (/no such table.*member_nicknames/i.test(String(error?.message))) return null;
    throw error;
  }
}
export async function storeNickname(db, memberId, nickname) {
  await ensureNicknames(db);
  await db.prepare('INSERT INTO member_nicknames (member_id, nickname, nickname_key) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key')
    .bind(memberId, nickname, nickname.toLowerCase()).run();
}
