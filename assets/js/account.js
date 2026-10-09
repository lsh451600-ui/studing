import { decorateMember } from './member-badge.js?v=20261009';
const byId = id => document.getElementById(id);
const status = byId('account-status'), dialog = byId('withdrawal-dialog');
let pending = false;
function clearLocalSession() {
  try { sessionStorage.removeItem('member-session-v1'); sessionStorage.removeItem('member-session-v2'); sessionStorage.removeItem('member-login-next'); } catch {}
}
async function accountAPI(options = {}) {
  const response = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(75000), ...options });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !options.method) { clearLocalSession(); location.replace('/?login_required=1&next=%2Fmypage'); }
    throw new Error(data.message || '회원 정보를 확인하지 못했습니다.');
  }
  return data;
}
async function load() {
  try {
    const { account } = await accountAPI();
    byId('account-username').textContent = account.username; decorateMember(byId('account-username'), account.level);
    byId('account-level').textContent = account.isAdmin ? '운영자' : account.level === 'special' ? '특별회원' : '일반회원';
    byId('recipe-access-notice').hidden = !['recipe_access', 'industry_access'].some(key => new URLSearchParams(location.search).has(key));
    byId('member-level-panel').hidden = !account.isAdmin;
    if (account.isAdmin) loadMembers();
    byId('account-nickname').value = account.nickname || '';
    byId('account-email').textContent = account.email || '등록된 이메일 없음';
    byId('account-phone').textContent = account.phone || '등록된 전화번호 없음';
    byId('account-created').textContent = account.createdAt ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' }).format(new Date(account.createdAt)) : '확인할 수 없음';
    byId('account-providers').textContent = account.providers.map(provider => ({ email: '아이디·이메일', kakao: '카카오', google: '구글' })[provider] || '소셜 로그인').join(' · ');
    byId('withdrawal-password-field').hidden = !account.passwordRequired;
    byId('withdrawal-password').required = account.passwordRequired;
    byId('withdrawal-social-help').hidden = account.passwordRequired;
    byId('account-content').hidden = false;
    status.textContent = '';
  } catch (error) { status.textContent = error.message || '회원 정보를 불러오지 못했습니다. 새로고침해 주세요.'; status.dataset.error = 'true'; }
}
byId('nickname-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending || !form.reportValidity()) return;
  const feedback = byId('nickname-status');
  pending = true; byId('nickname-submit').disabled = true;
  feedback.textContent = '닉네임을 저장하고 있습니다.'; delete feedback.dataset.error;
  try {
    const result = await fetch('/api/nickname', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: byId('account-nickname').value }) });
    const data = await result.json();
    if (!result.ok) throw new Error(data.message || '닉네임을 저장하지 못했습니다.');
    byId('account-nickname').value = data.nickname;
    try {
      const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      const session = await sessionResponse.json();
      if (sessionResponse.ok && session.authenticated && session.user) window.dispatchEvent(new CustomEvent('member-authenticated', { detail: session.user }));
    } catch { /* The saved profile is reloaded on the next page visit. */ }
    feedback.textContent = '닉네임을 저장했습니다. 게시글과 댓글에 적용됩니다.';
  } catch (error) { feedback.textContent = error.message || '닉네임을 저장하지 못했습니다. 다시 시도해 주세요.'; feedback.dataset.error = 'true'; }
  finally { pending = false; byId('nickname-submit').disabled = false; }
});
byId('withdrawal-open').addEventListener('click', () => { byId('withdrawal-status').textContent = ''; dialog.showModal(); });
byId('withdrawal-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
dialog.addEventListener('close', () => { byId('withdrawal-form').reset(); byId('withdrawal-open').focus(); });
byId('withdrawal-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending || !form.reportValidity()) return;
  pending = true; byId('withdrawal-submit').disabled = true; byId('withdrawal-close').disabled = true;
  const feedback = byId('withdrawal-status'); feedback.textContent = '본인 확인 후 탈퇴를 처리하고 있습니다.';
  try {
    const data = await accountAPI({ method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    clearLocalSession();
    dialog.close();
    byId('account-content').hidden = true; status.textContent = data.message;
    window.dispatchEvent(new CustomEvent('member-authenticated', { detail: null }));
    const home = document.createElement('a'); home.className = 'account-back'; home.href = '/'; home.textContent = '홈으로 돌아가기'; status.after(home);
  } catch (error) { feedback.textContent = error.message || '회원탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
  finally { byId('withdrawal-password').value = ''; pending = false; byId('withdrawal-submit').disabled = false; byId('withdrawal-close').disabled = false; }
});
load();

window.addEventListener('pageshow', event => { if (event.persisted) { byId('account-content').hidden = true; load(); } });

let memberPage = 1, memberQuery = '', memberGeneration = 0;
async function levelAPI(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options });
  const data = await response.json(); if (!response.ok) throw new Error(data.message || '회원 등급을 확인하지 못했습니다.'); return data;
}
async function loadMembers() {
  const version = ++memberGeneration, status = byId('member-level-status'); status.textContent = '회원 목록을 불러오고 있습니다.';
  try {
    const params = new URLSearchParams({ page: memberPage, q: memberQuery });
    const data = await levelAPI('/api/member-levels?' + params); if (version !== memberGeneration) return;
    const list = byId('member-level-list'); list.replaceChildren();
    for (const member of data.members) {
      const row = document.createElement('div'); row.className = 'member-level-row';
      const name = document.createElement('strong'); name.textContent = member.username; decorateMember(name, member.level);
      if (member.isAdmin) { const label = document.createElement('span'); label.textContent = '운영자'; row.append(name, label); }
      else {
        const select = document.createElement('select'); select.setAttribute('aria-label', member.username + ' 회원 등급');
        for (const [value, label] of [['regular', '일반회원'], ['special', '특별회원']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
        select.value = member.level;
        const save = document.createElement('button'); save.type = 'button'; save.textContent = '저장'; save.setAttribute('aria-label', member.username + ' 등급 저장');
        save.addEventListener('click', async () => { save.disabled = true; select.disabled = true;
          try { await levelAPI('/api/member-levels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: member.id, level: select.value }) }); member.level = select.value; decorateMember(name, member.level); status.textContent = member.username + '님의 등급을 ' + select.selectedOptions[0].textContent + '으로 변경했습니다.'; }
          catch (error) { status.textContent = error.message; select.value = member.level; }
          finally { save.disabled = false; select.disabled = false; }
        }); row.append(name, select, save);
      } list.append(row);
    }
    if (!data.members.length) list.textContent = '검색 결과가 없습니다.';
    byId('member-level-page').textContent = String(memberPage); byId('member-level-prev').disabled = memberPage <= 1; byId('member-level-next').disabled = !data.hasMore; status.textContent = '';
  } catch (error) { if (version === memberGeneration) status.textContent = error.message; }
}
byId('member-level-search').addEventListener('submit', event => { event.preventDefault(); memberPage = 1; memberQuery = byId('member-level-query').value.trim(); loadMembers(); });
byId('member-level-prev').addEventListener('click', () => { memberPage--; loadMembers(); });
byId('member-level-next').addEventListener('click', () => { memberPage++; loadMembers(); });
