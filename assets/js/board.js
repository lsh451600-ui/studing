const byId = id => document.getElementById(id);
let selected = null, next = null, generation = 0, authVersion = 0, sessionAuthenticated = false, writing = false, commenting = false;
const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
async function api(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(method === 'GET' ? {} : { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '연결하지 못했습니다. 다시 시도해 주세요.');
  return result;
}
function node(tag, text, className) { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; }
function authenticated() { return sessionAuthenticated; }
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
  if (!append) { selected = null; byId('board-detail').hidden = true; byId('board-index').hidden = false; byId('board-editor').hidden = true; }
  byId('board-status').textContent = '게시물을 불러오고 있습니다.';
  try {
    const params = new URLSearchParams();
    if (append && next) params.set('before', next);
    const data = await api('/api/board-posts' + (params.size ? '?' + params : ''));
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
    byId('board-post-actions').hidden = !(data.permissions?.canEdit || data.permissions?.canDelete);
    byId('board-edit-open').hidden = !data.permissions?.canEdit;
    byId('board-delete').hidden = !data.permissions?.canDelete;
    byId('board-edit-form').hidden = true;
    byId('board-edit-title').value = data.post.title;
    byId('board-edit-body').value = data.post.body;
    byId('board-comments').replaceChildren();
    for (const comment of data.comments) {
      const item = node('li', '', 'board-comment');
      item.append(node('p', comment.author + ' · ' + date(comment.created_at), 'board-meta'), node('p', comment.body, 'board-comment-body'));
      byId('board-comments').append(item);
    }
    byId('board-comment-empty').hidden = data.comments.length > 0;
    byId('board-status').textContent = data.permissions?.permissionsUnavailable ? '수정 권한을 확인할 수 없습니다. 글은 계속 볼 수 있으며 잠시 후 다시 시도해 주세요.' : ''; updateAuth();
    if (focus) byId('board-title').focus({ preventScroll: true });
  } catch (error) { if (version === generation) byId('board-status').textContent = error.message; }
}
byId('board-login').addEventListener('click', () => byId('login-open').click());
byId('board-write').addEventListener('click', () => {
  if (!byId('board-detail').hidden) {
    history.pushState(null, '', '/board');
    byId('board-detail').hidden = true;
    byId('board-index').hidden = false;
  }
  byId('board-editor').hidden = false;
  updateAuth();
  if (!authenticated()) byId('login-open').click();
  else byId('board-post-title').focus();
});
byId('board-more').addEventListener('click', async () => { byId('board-more').disabled = true; try { await loadList(true); } finally { byId('board-more').disabled = false; } });
byId('board-post-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (writing || !authenticated() || !event.target.reportValidity()) return;
  writing = true; updateAuth(); byId('board-post-status').textContent = '등록하고 있습니다.';
  try {
    const data = await api('/api/board-posts', {
      method: 'POST',
      body: { title: byId('board-post-title').value, body: byId('board-post-body').value }
    });
    event.target.reset(); byId('board-post-status').textContent = '';
    history.pushState(null, '', '/board?post=' + data.id);
    await loadDetail(data.id);
  } catch (error) { byId('board-post-status').textContent = error.message; }
  finally { writing = false; updateAuth(); }
});
byId('board-edit-open').addEventListener('click', () => {
  byId('board-edit-form').hidden = false;
  byId('board-edit-title').focus();
});
byId('board-edit-cancel').addEventListener('click', () => { byId('board-edit-form').hidden = true; });
byId('board-edit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (writing || !authenticated() || !event.target.reportValidity()) return;
  writing = true; byId('board-edit-submit').disabled = true; byId('board-edit-status').textContent = '수정 내용을 저장하고 있습니다.';
  try {
    await api('/api/board-posts?id=' + selected, { method: 'PATCH', body: { title: byId('board-edit-title').value, body: byId('board-edit-body').value } });
    byId('board-edit-status').textContent = '수정했습니다.';
    await loadDetail(selected, false);
  } catch (error) { byId('board-edit-status').textContent = error.message; }
  finally { writing = false; byId('board-edit-submit').disabled = false; }
});
byId('board-delete').addEventListener('click', async () => {
  if (!selected || !confirm('이 게시물을 삭제할까요? 삭제한 글과 댓글은 복구할 수 없습니다.')) return;
  const postId = selected;
  byId('board-delete').disabled = true;
  try {
    await api('/api/board-posts?id=' + postId, { method: 'DELETE' });
    history.pushState(null, '', '/board');
    byId('board-comment-form').reset();
    await loadList();
  } catch (error) { byId('board-status').textContent = error.message; }
  finally { byId('board-delete').disabled = false; }
});
byId('board-comment-form').addEventListener('submit', async event => {
  event.preventDefault(); if (commenting || !selected || !authenticated() || !event.target.reportValidity()) return;
  commenting = true; updateAuth(); byId('board-comment-status').textContent = '등록하고 있습니다.';
  const postId = selected;
  try {
    await api('/api/board-comments', { method: 'POST', body: { postId, body: byId('board-comment-body').value } });
    event.target.reset(); byId('board-comment-status').textContent = '댓글을 등록했습니다.';
    if (selected === postId) await loadDetail(postId, false);
  } catch (error) { byId('board-comment-status').textContent = error.message; }
  finally { commenting = false; updateAuth(); }
});
window.addEventListener('member-session-change', event => {
  authVersion++;
  sessionAuthenticated = event.detail === true;
  updateAuth();
});
async function syncSession() {
  const version = authVersion;
  try {
    const data = await api('/api/session');
    if (version !== authVersion) return;
    sessionAuthenticated = data.authenticated === true;
    updateAuth();
  } catch (error) {
    if (version !== authVersion) return;
    sessionAuthenticated = false;
    updateAuth();
    byId('board-status').textContent = '로그인 상태를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.';
  }
}
function navigate() { const id = new URLSearchParams(location.search).get('post'); if (/^[1-9][0-9]*$/.test(id || '')) loadDetail(id); else loadList(); }
window.addEventListener('popstate', navigate); updateAuth(); syncSession(); navigate();
