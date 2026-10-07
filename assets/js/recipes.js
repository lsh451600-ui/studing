const byId = id => document.getElementById(id);
const form = byId('recipe-access-form'), input = byId('recipe-password'), submit = byId('recipe-submit');
const status = byId('recipe-status'), gate = byId('recipe-gate'), content = byId('recipe-content');
const board = byId('recipe-board'), adminPanel = byId('recipe-admin-panel'), editor = byId('recipe-editor');
const adminForm = byId('recipe-admin-form'), postForm = byId('recipe-post-form');
let pending = false, posting = false, next = null, previewURL = null, generation = 0, owner = false, storage = false, configured = false;
function clearPreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null; byId('recipe-image-preview').removeAttribute('src'); byId('recipe-image-preview').hidden = true;
}
function resetView() {
  generation++; owner = false; storage = false; configured = false; form.reset(); input.type = 'password'; content.replaceChildren();
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
    const card = document.createElement('details'); card.className = 'recipe-post';
    const summary = document.createElement('summary'); summary.className = 'recipe-row';
    const title = document.createElement('span'); title.className = 'recipe-row-title'; title.textContent = post.title;
    const time = document.createElement('time'); time.dateTime = post.created_at;
    time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(post.created_at));
    const arrow = document.createElement('span'); arrow.className = 'recipe-row-arrow'; arrow.textContent = '+'; arrow.setAttribute('aria-hidden', 'true');
    summary.append(title, time, arrow); card.append(summary);
    const detail = document.createElement('div'); detail.className = 'recipe-detail'; card.append(detail);
    if (post.image_url) {
      const image = document.createElement('img'); image.src = post.image_url; image.alt = post.title + ' · 레시피 사진'; image.loading = 'lazy'; detail.append(image);
    }
    const body = document.createElement('p'); body.className = 'recipe-post-body'; body.textContent = post.body; detail.append(body); content.append(card);
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
    owner = Boolean(data.canWrite); storage = Boolean(data.storageAvailable); configured = Boolean(data.adminConfigured);
    editor.hidden = false;
    byId('recipe-admin-open').disabled = false;
    byId('recipe-admin-open').hidden = owner; byId('recipe-admin-exit').hidden = !owner;
    byId('recipe-board-status').textContent = !storage ? '게시물 저장을 위해 Cloudflare D1의 MEMBERS_DB 연결이 필요합니다.' : !configured ? '운영자만 등록할 수 있도록 Cloudflare에 RECIPE_ADMIN_PASSWORD를 설정해 주세요. 입력한 내용은 이 화면에 유지됩니다.' : owner ? '' : '제목과 내용을 작성한 뒤 운영자 인증을 완료하면 등록할 수 있습니다.';
    byId('recipe-board-heading').focus();
  } catch (error) { status.textContent = error.message; }
  finally {
    input.value = ''; input.type = 'password'; byId('recipe-show-password').checked = false;
    pending = false; submit.disabled = false; form.removeAttribute('aria-busy');
  }
});
function openWriter() {
  editor.hidden = false;
  if (owner || !configured || !storage) { byId('recipe-post-title').focus(); return; }
  adminPanel.hidden = false; byId('recipe-admin-password').focus();
}
byId('recipe-admin-open').addEventListener('click', openWriter);
adminForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!adminForm.reportValidity()) return;
  const button = byId('recipe-admin-submit'); button.disabled = true;
  const current = generation;
  try {
    await api('/api/recipe-admin', jsonOptions({ password: byId('recipe-admin-password').value }));
    if (current !== generation) return;
    owner = true; adminPanel.hidden = true; editor.hidden = false; byId('recipe-admin-open').hidden = true;
    byId('recipe-admin-exit').hidden = false; byId('recipe-post-title').focus();
  } catch (error) { byId('recipe-admin-status').textContent = error.message; }
  finally { byId('recipe-admin-password').value = ''; button.disabled = false; }
});
byId('recipe-admin-exit').addEventListener('click', async () => {
  if (posting) return;
  try {
    await api('/api/recipe-admin', { method: 'DELETE' }); owner = false; editor.hidden = false; postForm.reset(); clearPreview();
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
  if (!storage || !configured) { byId('recipe-post-status').textContent = !storage ? '저장소가 연결되지 않았습니다. Cloudflare D1 바인딩 MEMBERS_DB를 확인해 주세요.' : '운영자 비밀번호가 설정되지 않았습니다. Cloudflare 환경 변수 RECIPE_ADMIN_PASSWORD를 설정해 주세요.'; return; }
  if (!owner) { byId('recipe-post-status').textContent = '운영자 인증 후 등록하기를 다시 눌러 주세요.'; openWriter(); return; }
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

