const byId = id => document.getElementById(id);
const form = byId('recipe-access-form'), input = byId('recipe-password'), submit = byId('recipe-submit');
const status = byId('recipe-status'), gate = byId('recipe-gate'), content = byId('recipe-content');
const board = byId('recipe-board'), adminPanel = byId('recipe-admin-panel'), editor = byId('recipe-editor');
const adminForm = byId('recipe-admin-form'), postForm = byId('recipe-post-form');
let pending = false, posting = false, next = null, previewURL = null, generation = 0;
function clearPreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null; byId('recipe-image-preview').removeAttribute('src'); byId('recipe-image-preview').hidden = true;
}
function resetView() {
  generation++; form.reset(); input.type = 'password'; content.replaceChildren();
  content.hidden = true; board.hidden = true; adminPanel.hidden = true; editor.hidden = true;
  adminForm.reset(); postForm.reset(); clearPreview(); gate.hidden = false; status.textContent = '';
  byId('recipe-admin-status').textContent = ''; byId('recipe-post-status').textContent = '';
  byId('recipe-board-status').textContent = ''; next = null;
  byId('recipe-admin-open').hidden = false; byId('recipe-admin-exit').hidden = true;
}
async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) { const error = new Error(data.message || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error; }
  return data;
}
const jsonOptions = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function renderPosts(posts, append = false) {
  if (!append) content.replaceChildren();
  if (!posts.length && !append) {
    const empty = document.createElement('p'); empty.textContent = '아직 등록된 레시피가 없습니다.'; content.append(empty);
  }
  for (const post of posts) {
    const card = document.createElement('article'); card.className = 'recipe-post';
    const title = document.createElement('h2'); title.textContent = post.title;
    const time = document.createElement('time'); time.dateTime = post.created_at;
    time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(post.created_at));
    card.append(title, time);
    if (post.image_url) {
      const image = document.createElement('img'); image.src = post.image_url; image.alt = post.title + ' · 레시피 사진'; image.loading = 'lazy'; card.append(image);
    }
    const body = document.createElement('p'); body.className = 'recipe-post-body'; body.textContent = post.body; card.append(body); content.append(card);
  }
  content.hidden = false;
}
async function refreshPosts(append = false) {
  const current = generation;
  const data = await api('/api/recipe-posts' + (append && next ? '?before=' + next : ''));
  if (current !== generation) return;
  renderPosts(data.posts, append); next = data.next; byId('recipe-more').hidden = !next;
}
byId('recipe-show-password').addEventListener('change', event => { input.type = event.target.checked ? 'text' : 'password'; });
byId('recipe-lock').addEventListener('click', async () => {
  if (posting) { byId('recipe-post-status').textContent = '게시물 저장을 마친 뒤 잠글 수 있습니다.'; return; }
  try { await api('/api/recipes', { method: 'DELETE' }); resetView(); input.focus(); }
  catch (error) { byId('recipe-board-status').textContent = '잠금 처리에 실패했습니다. 다시 눌러 주세요.'; }
});
window.addEventListener('pagehide', resetView);
form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !form.reportValidity()) return;
  pending = true; submit.disabled = true; form.setAttribute('aria-busy', 'true'); status.textContent = '비밀번호를 확인하고 있습니다.';
  const current = generation;
  try {
    const data = await api('/api/recipes', jsonOptions({ password: input.value }));
    if (current !== generation) return;
    renderPosts(data.posts || []); next = data.next; byId('recipe-more').hidden = !next;
    board.hidden = false; gate.hidden = true;
    byId('recipe-admin-open').disabled = !data.adminConfigured || !data.storageAvailable;
    byId('recipe-board-status').textContent = !data.storageAvailable ? '게시판을 준비 중입니다.' : !data.adminConfigured ? '게시물 작성을 준비 중입니다.' : '';
    byId('recipe-board-heading').focus();
  } catch (error) { status.textContent = error.message; }
  finally {
    input.value = ''; input.type = 'password'; byId('recipe-show-password').checked = false;
    pending = false; submit.disabled = false; form.removeAttribute('aria-busy');
  }
});
byId('recipe-admin-open').addEventListener('click', () => { adminPanel.hidden = false; byId('recipe-admin-password').focus(); });
adminForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!adminForm.reportValidity()) return;
  const button = byId('recipe-admin-submit'); button.disabled = true;
  const current = generation;
  try {
    await api('/api/recipe-admin', jsonOptions({ password: byId('recipe-admin-password').value }));
    if (current !== generation) return;
    adminPanel.hidden = true; editor.hidden = false; byId('recipe-admin-open').hidden = true;
    byId('recipe-admin-exit').hidden = false; byId('recipe-post-title').focus();
  } catch (error) { byId('recipe-admin-status').textContent = error.message; }
  finally { byId('recipe-admin-password').value = ''; button.disabled = false; }
});
byId('recipe-admin-exit').addEventListener('click', async () => {
  if (posting) return;
  try {
    await api('/api/recipe-admin', { method: 'DELETE' }); editor.hidden = true; postForm.reset(); clearPreview();
    byId('recipe-admin-open').hidden = false; byId('recipe-admin-exit').hidden = true;
  } catch (error) { byId('recipe-board-status').textContent = error.message; }
});
byId('recipe-post-image').addEventListener('change', event => {
  clearPreview(); const file = event.target.files[0]; if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1048576) {
    event.target.value = ''; byId('recipe-post-status').textContent = 'JPG, PNG, WebP 이미지 1MB 이하만 올릴 수 있습니다.'; return;
  }
  byId('recipe-post-status').textContent = ''; previewURL = URL.createObjectURL(file);
  byId('recipe-image-preview').src = previewURL; byId('recipe-image-preview').hidden = false;
});
function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.onload = () => resolve({ base64: String(reader.result).split(',')[1], type: file.type }); reader.readAsDataURL(file);
  });
}
postForm.addEventListener('submit', async event => {
  event.preventDefault(); if (posting || !postForm.reportValidity()) return;
  posting = true; byId('recipe-post-submit').disabled = true; postForm.setAttribute('aria-busy', 'true');
  const postStatus = byId('recipe-post-status'); postStatus.textContent = '게시물을 저장하고 있습니다.';
  try {
    const file = byId('recipe-post-image').files[0];
    if (file && file.size > 1048576) throw new Error('이미지는 1MB 이하로 올려 주세요.');
    const payload = { title: byId('recipe-post-title').value, body: byId('recipe-post-body').value, image: file ? await encodeFile(file) : null };
    await api('/api/recipe-posts', jsonOptions(payload)); postForm.reset(); clearPreview();
    postStatus.textContent = '게시물을 올렸습니다.';
    try { await refreshPosts(); } catch { byId('recipe-board-status').textContent = '게시물은 저장됐습니다. 목록을 새로고침해 주세요.'; }
  } catch (error) { postStatus.textContent = error.message; }
  finally { posting = false; byId('recipe-post-submit').disabled = false; postForm.removeAttribute('aria-busy'); }
});
byId('recipe-more').addEventListener('click', async () => {
  const button = byId('recipe-more'); button.disabled = true;
  try { await refreshPosts(true); } catch (error) { byId('recipe-board-status').textContent = error.message; }
  finally { button.disabled = false; }
});
