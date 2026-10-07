const byId = id => document.getElementById(id);
let selected = null, next = null, generation = 0, writing = false, commenting = false;
const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
async function api(url, data) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '연결하지 못했습니다. 다시 시도해 주세요.');
  return result;
}
function node(tag, text, className) { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; }
function authenticated() { return document.querySelector('.member-controls').dataset.state === 'authenticated'; }
function updateAuth() {
  const ready = authenticated();
  byId('board-login-hint').hidden = ready;
  byId('board-post-submit').disabled = !ready || writing;
  byId('board-comment-submit').disabled = !ready || commenting;
}
function rows(posts, append) {
  if (!append) byId('board-list').replaceChildren();
  if (!posts.length && !append) byId('board-list').append(node('p', '첫 이야기를 남겨 주세요.', 'board-empty'));
  for (const post of posts) {
    const link = node('a', '', 'board-row'); link.href = '/board?post=' + post.id;
    link.append(node('strong', post.title), node('span', post.author + ' · ' + date(post.created_at) + ' · 댓글 ' + post.comments, 'board-meta'));
    link.addEventListener('click', event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); history.pushState(null, '', link.href); loadDetail(post.id); });
    byId('board-list').append(link);
  }
}
async function loadList(append = false) {
  const version = ++generation;
  if (!append) { selected = null; byId('board-detail').hidden = true; byId('board-index').hidden = false; }
  byId('board-status').textContent = '게시물을 불러오고 있습니다.';
  try {
    const data = await api('/api/board-posts' + (append && next ? '?before=' + next : ''));
    if (version !== generation) return;
    rows(data.posts, append); next = data.next; byId('board-more').hidden = !next; byId('board-status').textContent = '';
  } catch (error) { if (version === generation) byId('board-status').textContent = error.message; }
}
async function loadDetail(id, focus = true) {
  const version = ++generation;
  byId('board-status').textContent = '게시물을 불러오고 있습니다.';
  try {
    const data = await api('/api/board-posts?id=' + id);
    if (version !== generation) return;
    selected = data.post.id; byId('board-index').hidden = true; byId('board-editor').hidden = true; byId('board-detail').hidden = false;
    byId('board-title').textContent = data.post.title;
    byId('board-author').textContent = data.post.author + ' · ' + date(data.post.created_at) + ' (한국 시간)';
    byId('board-body').textContent = data.post.body;
    byId('board-comments').replaceChildren();
    for (const comment of data.comments) {
      const item = node('li', '', 'board-comment');
      item.append(node('p', comment.author + ' · ' + date(comment.created_at), 'board-meta'), node('p', comment.body));
      byId('board-comments').append(item);
    }
    byId('board-comment-empty').hidden = data.comments.length > 0;
    byId('board-status').textContent = ''; updateAuth();
    if (focus) byId('board-title').focus({ preventScroll: true });
  } catch (error) { if (version === generation) byId('board-status').textContent = error.message; }
}
byId('board-write').addEventListener('click', () => {
  byId('board-editor').hidden = false; updateAuth();
  if (!authenticated()) byId('login-open').click(); else byId('board-post-title').focus();
});
byId('board-login').addEventListener('click', () => byId('login-open').click());
byId('board-back').addEventListener('click', () => { history.pushState(null, '', '/board'); byId('board-comment-form').reset(); loadList(); });
byId('board-more').addEventListener('click', async () => { byId('board-more').disabled = true; try { await loadList(true); } finally { byId('board-more').disabled = false; } });
byId('board-post-form').addEventListener('submit', async event => {
  event.preventDefault(); if (writing || !authenticated() || !event.target.reportValidity()) return;
  writing = true; updateAuth(); byId('board-post-status').textContent = '등록하고 있습니다.';
  try {
    const data = await api('/api/board-posts', { title: byId('board-post-title').value, body: byId('board-post-body').value });
    event.target.reset(); byId('board-post-status').textContent = ''; history.pushState(null, '', '/board?post=' + data.id); await loadDetail(data.id);
  } catch (error) { byId('board-post-status').textContent = error.message; }
  finally { writing = false; updateAuth(); }
});
byId('board-comment-form').addEventListener('submit', async event => {
  event.preventDefault(); if (commenting || !selected || !authenticated() || !event.target.reportValidity()) return;
  commenting = true; updateAuth(); byId('board-comment-status').textContent = '등록하고 있습니다.';
  const postId = selected;
  try {
    await api('/api/board-comments', { postId, body: byId('board-comment-body').value });
    event.target.reset(); byId('board-comment-status').textContent = '댓글을 등록했습니다.';
    if (selected === postId) await loadDetail(postId, false);
  } catch (error) { byId('board-comment-status').textContent = error.message; }
  finally { commenting = false; updateAuth(); }
});
new MutationObserver(updateAuth).observe(document.querySelector('.member-controls'), { attributes: true, attributeFilter: ['data-state'] });
function navigate() { const id = new URLSearchParams(location.search).get('post'); if (/^[1-9][0-9]*$/.test(id || '')) loadDetail(id); else loadList(); }
window.addEventListener('popstate', navigate); updateAuth(); navigate();
