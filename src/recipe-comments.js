import { ensurePosts } from './recipe-server.js';
export async function ensureRecipeComments(db) {
  await ensurePosts(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS recipe_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES recipe_posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS recipe_comments_post ON recipe_comments(post_id, id)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS community_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
}
