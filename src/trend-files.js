export async function validateFiles(db, postId, input) {
  if (input === undefined) return null;
  if (!Array.isArray(input) || input.length > 5) throw new Error('files');
  const files = []; let total = 0;
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new Error('file');
    let file;
    if (item.id) {
      file = postId && await db.prepare('SELECT id,name,size,data FROM trend_files WHERE id=? AND post_id=?').bind(item.id,postId).first();
      if (!file || files.some(value => value.id === file.id)) throw new Error('file');
    } else {
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(item.name) || typeof item.data !== 'string' || item.data.length > 682668 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) throw new Error('file');
      const size = atob(item.data).length;
      if (!size || size > 500 * 1024) throw new Error('size');
      file = { id: crypto.randomUUID(), name: item.name.trim(), size, data: item.data };
    }
    total += file.size;
    if (total > 1024 * 1024) throw new Error('total');
    files.push(file);
  }
  return files;
}
export function fileStatements(db, postId, files) {
  if (files === null) return [];
  const statements = postId ? [db.prepare('DELETE FROM trend_files WHERE post_id=?').bind(postId)] : [];
  for (const file of files) statements.push(postId
    ? db.prepare('INSERT INTO trend_files (id,post_id,name,size,data) VALUES (?,?,?,?,?)').bind(file.id,postId,file.name,file.size,file.data)
    : db.prepare('INSERT INTO trend_files (id,post_id,name,size,data) VALUES (?,(SELECT MAX(id) FROM trend_posts),?,?,?)').bind(file.id,file.name,file.size,file.data));
  return statements;
}
