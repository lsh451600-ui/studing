import { initialize as initializeCommunity } from './community.js';
export async function initialize(db) {
  await initializeCommunity(db);
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS trend_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, rich_body TEXT, is_secret INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS trend_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES trend_posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS trend_comments_post ON trend_comments(post_id,id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS trend_board_migrations (id TEXT PRIMARY KEY)')
  ]);
  if (!await db.prepare("SELECT id FROM trend_board_migrations WHERE id = 'separate-tables-v1'").first()) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO trend_posts (id,author_id,author,title,body,is_secret,created_at,views) SELECT id,author_id,author,title,body,is_secret,created_at,views FROM community_posts WHERE board = 'trend'"),
      db.prepare("INSERT OR IGNORE INTO trend_comments (id,post_id,author_id,author,body,created_at) SELECT c.id,c.post_id,c.author_id,c.author,c.body,c.created_at FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE p.board = 'trend'"),
      db.prepare("INSERT OR IGNORE INTO trend_board_migrations (id) VALUES ('separate-tables-v1')")
    ]);
  }
}
export function formattedBody(data) {
  if (data.richBody === undefined || data.richBody === null) return { body: typeof data.body === 'string' ? data.body.trim() : '', rich: null };
  if (!Array.isArray(data.richBody) || data.richBody.length > 2000) throw new Error('글 서식을 확인해 주세요.');
  const runs = data.richBody.map(run => {
    if (!run || typeof run.text !== 'string' || !(run.color === 'inherit' || /^#[0-9a-f]{6}$/i.test(run.color)) || ![12,14,16,18,20,24,28,32].includes(run.size) || typeof run.bold !== 'boolean') throw new Error('글 서식을 확인해 주세요.');
    return { text: run.text, color: run.color, size: run.size, bold: run.bold };
  });
  const body = runs.map(run => run.text).join('');
  if (body.length > 10000) throw new Error('내용은 10,000자 이내로 입력해 주세요.');
  return { body, rich: JSON.stringify(runs) };
}
