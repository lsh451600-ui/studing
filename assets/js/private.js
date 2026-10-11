import { appendRecipeComments } from './recipe-comments.js?v=crown-20261009-industry';
import { appendPostActions } from './post-actions.js?v=20261009-ingredients';
const byId = id => document.getElementById(id);
let accessRevoked = false;
const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let unlocked = false;
let page = 1, totalPages = 1, sort = 'latest', query = '', generation = 0, authGeneration = 0, posting = false;
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options });
  const data = await response.json(); if (!response.ok) { const error = new Error(data.message || '자료를 불러오지 못했습니다.'); error.status = response.status; throw error; } return data;
}
function render(posts) {
  const content = byId('recipe-content'); content.replaceChildren();
  if (!posts.length) content.append(make('p', query ? '검색 결과가 없습니다.' : '아직 등록된 자료가 없습니다.'));
  for (const post of posts) {
    const card = make('details', '', 'recipe-post'), row = make('summary', '', 'recipe-row');
    const title = make('span', post.title, 'recipe-row-title'), downloads = make('span', String(post.downloads || 0), 'recipe-downloads'), time = make('time');
    time.dateTime = post.created_at; time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(post.created_at));
    const comments = make('span', String(post.comment_count || 0), 'recipe-comment-count');
    row.append(title, comments, downloads, time); const detail = make('div', '', 'recipe-detail'); card.append(row, detail);
    if (post.image_url) { const image = make('img'); image.src = post.image_url; image.alt = post.title + ' 자료 사진'; image.loading = 'lazy'; detail.append(image); }
    detail.append(make('p', post.body, 'recipe-post-body'));
    if (post.attachment_url) {
      const link = make('a', post.attachment_name + ' 다운로드', 'recipe-attachment'); link.href = post.attachment_url; link.download = post.attachment_name;
      link.addEventListener('click', async event => {
        event.preventDefault(); if (link.dataset.busy) return; link.dataset.busy = 'true';
        try {
          const response = await fetch(post.attachment_url, { credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error('파일을 내려받지 못했습니다.');
          const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = make('a'); anchor.href = url; anchor.download = post.attachment_name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          downloads.textContent = response.headers.get('X-Recipe-Downloads') || String(Number(downloads.textContent) + 1);
        } catch (error) { byId('industry-status').textContent = error.message; }
        finally { delete link.dataset.busy; }
      }); detail.append(link);
    }
    appendRecipeComments(card, detail, post, api, { endpoint: '/api/private-comments', subject: '자료' });
    appendPostActions(detail, post, { endpoint: '/api/private-posts', api, refresh: load }); content.append(card);
  }
}
function paginate() {
  const nav = byId('recipe-pagination'); nav.replaceChildren();
  if (totalPages <= 1) return;
  const start = Math.max(1, Math.min(page - 2, totalPages - 4)), end = Math.min(totalPages, start + 4);
  const add = (label, value, disabled = false) => { const button = make('button', label); button.type = 'button'; button.disabled = disabled; if (value === page && /^\d+$/.test(label)) button.setAttribute('aria-current', 'page'); button.addEventListener('click', () => { page = value; load(); }); nav.append(button); };
  add('이전', page - 1, page === 1); if (start > 1) add('1', 1); if (start > 2) nav.append(make('span', '…'));
  for (let n = start; n <= end; n++) add(String(n), n);
  if (end < totalPages - 1) nav.append(make('span', '…')); if (end < totalPages) add(String(totalPages), totalPages); add('다음', page + 1, page === totalPages);
}
async function load() {
  if (!unlocked) return;
  const version = ++generation; byId('industry-status').textContent = '자료를 불러오고 있습니다.';
  try {
    const params = new URLSearchParams({ page, sort }); if (query) params.set('q', query);
    const data = await api('/api/private-posts?' + params);
    if (version !== generation) return; page = data.page; totalPages = data.totalPages; render(data.posts); paginate(); byId('industry-status').textContent = '';
  } catch (error) { if (version === generation) { if ([401, 403].includes(error.status)) lock(); byId(unlocked ? 'industry-status' : 'industry-access-status').textContent = error.message; } }
}
async function syncWriter() {
  const version = ++authGeneration;
  try {
    const data = await api('/api/session'); if (version !== authGeneration) return;
    const admin = data.authenticated && data.user?.isAdmin === true;
    byId('industry-write').hidden = !admin || !unlocked; if (!admin) byId('recipe-editor').hidden = true;
  } catch { if (version === authGeneration) { byId('industry-write').hidden = true; byId('recipe-editor').hidden = true; } }
}
byId('industry-heading').addEventListener('click', event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); query = ''; page = 1; byId('industry-query').value = ''; byId('recipe-editor').hidden = true; load(); });
byId('industry-search').addEventListener('submit', event => { event.preventDefault(); query = byId('industry-query').value.trim(); page = 1; load(); });
for (const button of document.querySelectorAll('[data-industry-sort]')) button.addEventListener('click', () => { sort = button.dataset.industrySort; page = 1; for (const el of document.querySelectorAll('[data-industry-sort]')) el.setAttribute('aria-pressed', String(el === button)); load(); });
byId('industry-write').addEventListener('click', () => { byId('recipe-editor').hidden = false; byId('industry-title').focus(); });
byId('industry-cancel').addEventListener('click', () => { byId('recipe-editor').hidden = true; });
const encode = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('첨부 파일을 읽지 못했습니다.')); reader.onload = () => resolve({ base64: String(reader.result).split(',')[1], type: file.type, name: file.name }); reader.readAsDataURL(file); });
byId('industry-post-form').addEventListener('submit', async event => {
  event.preventDefault(); if (posting || !event.target.reportValidity()) return;
  posting = true; byId('industry-submit').disabled = true; const status = byId('industry-post-status'); status.textContent = '저장하고 있습니다.';
  try {
    const image = byId('industry-image').files[0], attachment = byId('industry-file').files[0];
    if (image && attachment) throw new Error('사진 또는 파일 하나만 첨부해 주세요.');
    if (image?.size > 1048576 || attachment?.size > 524288) throw new Error('사진은 1MB, 파일은 512KB 이하로 첨부해 주세요.');
    await api('/api/private-posts', json({ title: byId('industry-title').value, body: byId('industry-body').value, image: image ? await encode(image) : null, attachment: attachment ? await encode(attachment) : null }));
    event.target.reset(); status.textContent = ''; byId('recipe-editor').hidden = true; page = 1; query = ''; byId('industry-query').value = ''; await load();
  } catch (error) { status.textContent = error.message; }
  finally { posting = false; byId('industry-submit').disabled = false; }
});
function lock() {
  unlocked = false; generation++; authGeneration++;
  byId('recipe-content').replaceChildren(); byId('recipe-pagination').replaceChildren();
  byId('recipe-board').hidden = true; byId('industry-gate').hidden = false;
  byId('industry-write').hidden = true; byId('recipe-editor').hidden = true;
  byId('industry-post-form').reset();
}
async function unlockIndustry() {
  const version = ++generation;
  byId('industry-access-status').textContent = '';
  try {
    const data = await api('/api/private');
    if (version !== generation) return;
    unlocked = true; page = data.page || 1; totalPages = data.totalPages || 1; query = ''; sort = 'latest';
    byId('industry-query').value = ''; render(data.posts); paginate();
    byId('recipe-board').hidden = false; byId('industry-gate').hidden = true;
    byId('industry-write').hidden = !data.canWrite; byId('industry-access-status').textContent = '';
  } catch (error) { if (version === generation) byId('industry-access-status').textContent = error.message; }
}
async function syncAdminAccess() { if (!accessRevoked && !unlocked) await unlockIndustry(); }
window.addEventListener('member-session-change', event => {
  accessRevoked = event.detail === false; lock(); syncAdminAccess(); });
window.addEventListener('pageshow', event => { if (event.persisted) { lock(); syncAdminAccess(); } });
window.addEventListener('pagehide', lock);
lock();

syncAdminAccess();
