const byId = id => document.getElementById(id);
const dialog = byId('login-dialog'), form = byId('login-form'), status = byId('login-status');
let pending = false, opener, currentUser = null;
async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(data.message || '요청을 완료하지 못했습니다.');
  return data;
}
function showUser(user) {
  currentUser = user || null;
  byId('login-open').hidden = Boolean(user); byId('signup-open').hidden = Boolean(user);
  byId('member-status').hidden = !user; byId('logout-button').hidden = !user;
  byId('member-status').textContent = user ? user.username + '님' : '';
}
async function checkSession() {
  const data = await api('/api/session'); showUser(data.authenticated ? data.user : null);
  return data;
}
async function openLogin(event) {
  opener = event?.currentTarget || byId('login-open');
  const signup = byId('signup-dialog'); if (signup.open) signup.close();
  dialog.showModal(); status.textContent = '로그인 가능 여부를 확인하고 있습니다.'; byId('login-submit').disabled = true;
  try {
    const data = await checkSession();
    if (data.authenticated) { dialog.close(); return; }
    byId('login-submit').disabled = !data.available;
    status.textContent = data.available ? '' : '로그인을 준비 중입니다. 잠시 후 다시 방문해 주세요.';
  } catch (error) { status.textContent = error.message; }
}
byId('login-open').addEventListener('click', openLogin);
byId('signup-to-login').addEventListener('click', openLogin);
byId('login-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
dialog.addEventListener('close', () => {
  byId('login-password').value = ''; byId('login-password').type = 'password'; byId('login-show-password').checked = false;
  if (!opener?.hidden) opener?.focus();
});
byId('login-show-password').addEventListener('change', event => { byId('login-password').type = event.target.checked ? 'text' : 'password'; });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !form.reportValidity()) return;
  pending = true; byId('login-submit').disabled = true; byId('login-close').disabled = true;
  form.setAttribute('aria-busy', 'true'); status.textContent = '로그인하고 있습니다.';
  try {
    const data = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: byId('login-identifier').value, password: byId('login-password').value }) });
    if (!data.authenticated || !data.user) throw new Error('로그인 결과를 확인하지 못했습니다.');
    showUser(data.user); form.reset(); dialog.close(); byId('member-feedback').textContent = '로그인되었습니다.';
  } catch (error) { status.textContent = error.message; }
  finally {
    byId('login-password').value = ''; pending = false;
    byId('login-submit').disabled = false; byId('login-close').disabled = false; form.removeAttribute('aria-busy');
  }
});
byId('logout-button').addEventListener('click', async () => {
  byId('logout-button').disabled = true;
  try { await api('/api/logout', { method: 'POST' }); showUser(null); byId('member-feedback').textContent = '로그아웃되었습니다.'; }
  catch (error) { byId('member-feedback').textContent = error.message; }
  finally { byId('logout-button').disabled = false; }
});
window.addEventListener('member-authenticated', event => {
  showUser(event.detail); byId('member-feedback').textContent = '회원가입과 로그인이 완료되었습니다.';
});
checkSession().catch(() => { byId('member-feedback').textContent = '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'; });
const params = new URLSearchParams(location.search);
if (params.has('auth')) {
  byId('member-feedback').textContent = params.get('auth') === 'confirmed' ? '이메일 인증이 완료되었습니다.' : '인증 링크가 만료되었거나 유효하지 않습니다. 로그인 화면에서 다시 확인해 주세요.';
  params.delete('auth'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
}
