import { appendRecipeComments } from './recipe-comments.js?v=crown-20261009-count';
import { appendPostActions } from './post-actions.js?v=20261009-ingredients';
const byId = id => document.getElementById(id);
let accessRevoked = false;
const status = byId('recipe-status'), gate = byId('recipe-gate'), content = byId('recipe-content');
const board = byId('recipe-board'), editor = byId('recipe-editor');
const postForm = byId('recipe-post-form');
let pending = false, posting = false, currentPage = 1, currentSort = 'latest', previewURL = null, generation = 0, storage = false, accountWriter = false;
function clearPreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null; byId('recipe-image-preview').removeAttribute('src'); byId('recipe-image-preview').hidden = true;
}
function resetView() {
  window.dispatchEvent(new Event('recipe-access-locked'));
  generation++; storage = false; accountWriter = false; content.replaceChildren();
  content.hidden = true; board.hidden = true; editor.hidden = true;
  postForm.reset(); clearPreview(); gate.hidden = false; status.textContent = '';
  byId('recipe-post-status').textContent = '';
  byId('recipe-board-status').textContent = ''; currentPage = 1;
  currentSort = 'latest'; updateSortButtons();
  byId('recipe-admin-open').hidden = true;
}
async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) { const error = new Error(data.message || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error; }
  return data;
}
const jsonOptions = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function renderPosts(posts) {
  content.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('p'); empty.textContent = byId('recipe-search-query').value.trim() || byId('recipe-filter-category').value ? '검색 결과가 없습니다.' : '아직 등록된 레시피가 없습니다.'; content.append(empty);
  }
  for (const post of posts) {
    const card = document.createElement('details'); card.className = 'recipe-post'; card.id = 'recipe-post-' + post.id;
    const summary = document.createElement('summary'); summary.className = 'recipe-row';
    const category = document.createElement('span'); category.className = 'recipe-category'; category.textContent = post.category || '미분류';
    const title = document.createElement('span'); title.className = 'recipe-row-title'; title.textContent = post.title;
    const time = document.createElement('time'); time.dateTime = post.created_at;
    time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(post.created_at));
    const downloads = document.createElement('span'); downloads.className = 'recipe-downloads';
    downloads.textContent = String(post.downloads || 0);
    const comments = document.createElement('span'); comments.className = 'recipe-comment-count'; comments.textContent = String(post.comment_count || 0); comments.setAttribute('aria-label', '댓글 ' + comments.textContent + '개');
    summary.append(category, title, comments, downloads, time); card.append(summary);
    const detail = document.createElement('div'); detail.className = 'recipe-detail'; card.append(detail);
    if (post.image_url) {
      const image = document.createElement('img'); image.src = post.image_url; image.alt = post.title + ' · 레시피 사진'; image.loading = 'lazy'; detail.append(image);
    }
    const body = document.createElement('p'); body.className = 'recipe-post-body'; body.textContent = post.body; detail.append(body); content.append(card);
    if (post.attachment_url) {
      const attachment = document.createElement('a'); attachment.className = 'recipe-attachment'; attachment.href = post.attachment_url;
      attachment.download = post.attachment_name || ''; attachment.textContent = '첨부파일 받기 · ' + post.attachment_name; detail.append(attachment);
      const feedback = document.createElement('span'); feedback.setAttribute('role', 'status'); detail.append(feedback);
      let downloading = false;
      attachment.addEventListener('click', async event => {
        event.preventDefault();
        if (downloading) return;
        downloading = true; attachment.setAttribute('aria-disabled', 'true'); feedback.textContent = '';
        try {
          const response = await fetch(post.attachment_url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error('첨부파일을 다운로드하지 못했습니다. 다시 시도해 주세요.');
          const blob = await response.blob(), url = URL.createObjectURL(blob);
          const link = document.createElement('a'); link.href = url; link.download = post.attachment_name || 'attachment';
          document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
          post.downloads = Number(response.headers.get('X-Recipe-Downloads')) || (post.downloads || 0) + 1;
          downloads.textContent = String(post.downloads);
        } catch (error) { feedback.textContent = error.message; }
        finally { downloading = false; attachment.removeAttribute('aria-disabled'); }
      });
    }
    appendPostActions(detail, post, { endpoint: '/api/recipe-posts', api, refresh: refreshPosts, categories: ['미분류', '한식', '중식', '일식', '양식', '베이커리'], ingredientField: true });
    appendRecipeComments(card, detail, post, api);
  }
  content.hidden = false;
}
async function openRecipe(id, updateURL = true) {
  if (!/^[1-9]\d*$/.test(String(id))) return;
  const current = ++generation;
  try {
    const data = await api('/api/recipe-posts?' + new URLSearchParams({ id }));
    if (current !== generation) return;
    if (!data.posts.length) throw new Error('삭제되었거나 찾을 수 없는 레시피입니다.');
    renderPosts(data.posts); renderPagination(data);
    const card = byId('recipe-post-' + id); card.open = true;
    card.querySelector('summary').focus(); card.scrollIntoView({ block:'start', behavior:'smooth' });
    if (updateURL) { const url = new URL(location.href); url.searchParams.set('recipe', id); history.pushState(null, '', url); }
    byId('recipe-board-status').textContent = '';
  } catch (error) { if (current === generation) byId('recipe-board-status').textContent = error.message; }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-recipe-id]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); openRecipe(link.dataset.recipeId);
});
function renderPagination(data) {
  currentPage = data.page || 1;
  const pages = data.totalPages || 1, pagination = byId('recipe-pagination');
  pagination.replaceChildren();
  // Keep numbered navigation compact for large collections.
  const numbers = new Set([1, pages]);
  for (let n = Math.max(1, currentPage - 2); n <= Math.min(pages, currentPage + 2); n++) numbers.add(n);
  let previous = 0;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    if (previous && n > previous + 1) {
      const gap = document.createElement('span'); gap.textContent = '…'; pagination.append(gap);
    }
    const button = document.createElement('button'); button.type = 'button'; button.textContent = String(n);
    button.dataset.page = n; button.setAttribute('aria-label', n + '페이지');
    if (n === currentPage) button.setAttribute('aria-current', 'page');
    pagination.append(button); previous = n;
  }
}
async function refreshPosts(page = currentPage) {
  const current = generation;
  const params = new URLSearchParams({ page: String(page) });
  const q = byId('recipe-search-query').value.trim(), category = byId('recipe-filter-category').value;
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  params.set('sort', currentSort);
  const data = await api('/api/recipe-posts?' + params);
  if (current !== generation) return;
  renderPosts(data.posts); renderPagination(data); updateSortButtons();
  const url = new URL(location.href); if (url.searchParams.has('recipe')) { url.searchParams.delete('recipe'); history.replaceState(null, '', url); }
}
window.addEventListener('pagehide', resetView);
async function unlockRecipes(focus = false) {
  if (pending) return;
  pending = true; gate.setAttribute('aria-busy', 'true'); status.textContent = '회원 권한을 확인하고 있습니다.';
  const current = generation;
  try {
    const data = await api('/api/recipes');
    if (current !== generation) return;
    renderPosts(data.posts || []); renderPagination(data); updateSortButtons();
    board.hidden = false; gate.hidden = true;
    storage = Boolean(data.storageAvailable); accountWriter = data.accountWriter === true;
    editor.hidden = !accountWriter;
    byId('recipe-admin-open').disabled = false;
    byId('recipe-admin-open').hidden = !accountWriter;
    byId('recipe-board-status').textContent = !storage ? '게시판에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '';
    if (focus) byId('recipe-board-heading').focus();
    const linkedId = new URL(location.href).searchParams.get('recipe');
    if (linkedId) await openRecipe(linkedId, false);
  } catch (error) { if (current === generation) status.textContent = error.message; }
  finally {
    pending = false; gate.removeAttribute('aria-busy');
    if (current !== generation && !gate.hidden) syncAdminAccess();
  }
}
async function syncAdminAccess() { if (!accessRevoked && !gate.hidden) await unlockRecipes(); }
byId('recipe-admin-open').addEventListener('click', () => {
  if (!accountWriter) return;
  editor.hidden = false; byId('recipe-post-title').focus();
});
byId('recipe-heading-link').addEventListener('click', async event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!gate.hidden) { syncAdminAccess(); return; }
  generation++; currentPage = 1; editor.hidden = true;
  byId('recipe-search-form').reset();
  window.dispatchEvent(new Event('recipe-filter-reset'));
  for (const post of content.querySelectorAll('details[open]')) post.open = false;
  try { await refreshPosts(); byId('recipe-board-heading').focus({ preventScroll: true }); }
  catch (error) { byId('recipe-board-status').textContent = error.message; }
});
window.addEventListener('member-session-change', event => {
  accessRevoked = event.detail === false;
  // A changed login must recheck publishing rights before the editor is shown again.
  resetView(); syncAdminAccess();
});
function updateSortButtons() {
  for (const button of document.querySelectorAll('[data-recipe-sort]')) {
    button.setAttribute('aria-pressed', String(button.dataset.recipeSort === currentSort));
  }
}
for (const button of document.querySelectorAll('[data-recipe-sort]')) {
  button.addEventListener('click', async () => {
    currentSort = button.dataset.recipeSort; generation++; currentPage = 1;
    try { await refreshPosts(); }
    catch (error) { byId('recipe-board-status').textContent = error.message; }
  });
}
byId('recipe-category-menu').addEventListener('click', async event => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  byId('recipe-filter-category').value = button.dataset.category;
  byId('recipe-category-menu').open = false;
  byId('recipe-filter-category').dispatchEvent(new Event('change'));
});
byId('recipe-filter-category').addEventListener('change', async () => {
  generation++; currentPage = 1;
  try { await refreshPosts(); }
  catch (error) { byId('recipe-board-status').textContent = error.message; }
});
byId('recipe-search-form').addEventListener('submit', async event => {
  event.preventDefault(); generation++; currentPage = 1;
  const button = byId('recipe-search-submit'); button.disabled = true;
  try { await refreshPosts(); } catch (error) { byId('recipe-board-status').textContent = error.message; }
  finally { button.disabled = false; }
});
byId('recipe-post-image').addEventListener('change', event => {
  clearPreview(); const file = event.target.files[0]; if (!file) return;
  if (byId('recipe-post-file').files.length) {
    event.target.value = ''; byId('recipe-post-status').textContent = '사진과 파일은 한 게시물에 하나씩만 첨부할 수 있습니다.'; return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1048576) {
    event.target.value = ''; byId('recipe-post-status').textContent = 'JPG, PNG, WebP 이미지 1MB 이하만 올릴 수 있습니다.'; return;
  }
  byId('recipe-post-status').textContent = ''; previewURL = URL.createObjectURL(file);
  byId('recipe-image-preview').src = previewURL; byId('recipe-image-preview').hidden = false;
});
byId('recipe-post-file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'xlsx', 'txt', 'csv'].includes(extension) || file.size > 524288) {
    event.target.value = ''; byId('recipe-post-status').textContent = 'PDF, DOCX, XLSX, TXT, CSV 파일을 512KB 이하로 올려 주세요.'; return;
  }
  if (byId('recipe-post-image').files.length) {
    event.target.value = ''; byId('recipe-post-status').textContent = '사진과 파일은 한 게시물에 하나씩만 첨부할 수 있습니다.'; return;
  }
  byId('recipe-post-status').textContent = '';
});
function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.onload = () => {
      const types = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv' };
      const extension = file.name.split('.').pop().toLowerCase();
      resolve({ base64: String(reader.result).split(',')[1], type: file.type || types[extension], name: file.name });
    };
    reader.readAsDataURL(file);
  });
}
postForm.addEventListener('submit', async event => {
  event.preventDefault(); if (posting || !postForm.reportValidity()) return;
  if (!accountWriter) return;
  if (!storage) { byId('recipe-post-status').textContent = '게시판에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'; return; }
  posting = true; byId('recipe-post-submit').disabled = true; postForm.setAttribute('aria-busy', 'true');
  const postStatus = byId('recipe-post-status'); postStatus.textContent = '게시물을 저장하고 있습니다.';
  try {
    const file = byId('recipe-post-image').files[0];
    if (file && file.size > 1048576) throw new Error('이미지는 1MB 이하로 올려 주세요.');
    const attachmentFile = byId('recipe-post-file').files[0];
    if (file && attachmentFile) throw new Error('사진과 파일은 한 게시물에 하나씩만 첨부할 수 있습니다.');
    const attachment = attachmentFile ? await encodeFile(attachmentFile) : null;
    const payload = { category: byId('recipe-post-category').value, title: byId('recipe-post-title').value, body: byId('recipe-post-body').value, ingredients: byId('recipe-post-ingredients').value, image: file ? await encodeFile(file) : null, attachment };
    await api('/api/recipe-posts', jsonOptions(payload)); postForm.reset(); clearPreview();
    postStatus.textContent = '게시물을 올렸습니다.';
    try { await refreshPosts(1); } catch { byId('recipe-board-status').textContent = '게시물은 저장됐습니다. 목록을 새로고침해 주세요.'; }
  } catch (error) { postStatus.textContent = error.message; }
  finally { posting = false; byId('recipe-post-submit').disabled = false; postForm.removeAttribute('aria-busy'); }
});
byId('recipe-pagination').addEventListener('click', async event => {
  const button = event.target.closest('button[data-page]');
  if (!button || Number(button.dataset.page) === currentPage) return;
  generation++;
  byId('recipe-pagination').setAttribute('aria-busy', 'true');
  try {
    await refreshPosts(Number(button.dataset.page));
    byId('recipe-content').scrollIntoView({ block: 'start' });
  } catch (error) { byId('recipe-board-status').textContent = error.message; }
  finally { byId('recipe-pagination').removeAttribute('aria-busy'); }
});

window.addEventListener('pageshow', event => { if (event.persisted) { resetView(); syncAdminAccess(); } });
syncAdminAccess();
