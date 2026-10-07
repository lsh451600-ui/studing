const byId = id => document.getElementById(id);
const dialog = byId('login-dialog'), form = byId('login-form'), status = byId('login-status');
let pending = false, opener, currentUser = null;
async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(data.message || '요청을 완료하지 못했습니다.');
  return data;
}
function showUser(user) {
  currentUser = user || null;
  if (!user && byId('profile-dialog').open) byId('profile-dialog').close();
  byId('login-open').hidden = Boolean(user); byId('signup-open').hidden = Boolean(user);
  byId('member-status').hidden = !user; byId('logout-button').hidden = !user;
  byId('member-status').textContent = user ? '로그인 중 · ' + user.username + '님' : '';
  byId('member-status').closest('.member-controls').dataset.state = user ? 'authenticated' : 'anonymous';
  byId('logout-button').textContent = '로그아웃';
}
async function checkSession() {
  const data = await api('/api/session'); showUser(data.authenticated ? data.user : null);
  if (data.authenticated && data.profileUnavailable) {
    byId('member-feedback').textContent = '로그인되었습니다. 회원 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
  }
  if (data.authenticated && data.needsProfile && !byId('profile-dialog').open) {
    if (dialog.open) dialog.close();
    byId('profile-dialog').showModal();
  }
  return data;
}
async function openLogin(event) {
  opener = event?.currentTarget || byId('login-open');
  const signup = byId('signup-dialog'); if (signup.open) signup.close();
  loadProviders();
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
  byId('logout-button').textContent = '로그아웃 중…';
  try { await api('/api/logout', { method: 'POST' }); showUser(null); byId('member-feedback').textContent = '로그아웃되었습니다.'; }
  catch (error) { byId('member-feedback').textContent = error.message; }
  finally { byId('logout-button').disabled = false; byId('logout-button').textContent = '로그아웃'; }
});
window.addEventListener('member-authenticated', event => {
  showUser(event.detail); byId('member-feedback').textContent = '회원가입과 로그인이 완료되었습니다.';
});
checkSession().catch(() => {
  byId('member-status').hidden = false;
  byId('member-status').textContent = '로그인 상태 확인 필요';
  byId('logout-button').hidden = false;
  byId('member-feedback').textContent = '로그인 상태를 확인하지 못했습니다. 새로고침하거나 로그아웃 후 다시 시도해 주세요.';
});
const params = new URLSearchParams(location.search);
if (params.has('auth')) {
  const messages = {
    confirmed: '이메일 인증이 완료되었습니다.', social: '소셜 로그인 인증이 완료되었습니다.',
    social_failed: '소셜 로그인을 완료하지 못했습니다. 다시 시도해 주세요.',
    kakao_flow_expired: '로그인 요청이 만료되었거나 다른 창에서 변경되었습니다. 로그인 버튼을 눌러 다시 시작해 주세요. (KAKAO-01)',
    kakao_cancelled: '카카오 로그인이 취소되었습니다. 원하시면 다시 로그인해 주세요.',
    kakao_config_required: '카카오 로그인 설정 확인이 필요합니다. (KAKAO-02)',
    kakao_token_failed: '카카오 인증 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. (KAKAO-03)',
    kakao_secret_invalid: '카카오 로그인 설정 확인이 필요합니다. (KAKAO-04)',
    kakao_oidc_required: '카카오 계정 인증 설정 확인이 필요합니다. (KAKAO-05)',
    kakao_email_required: '이메일 없는 카카오 계정의 로그인 허용 설정이 필요합니다. (KAKAO-06)',
    kakao_provider_disabled: '카카오 로그인 연결이 아직 활성화되지 않았습니다. (KAKAO-07)',
    kakao_app_mismatch: '카카오 앱 연결 설정이 일치하지 않습니다. (KAKAO-08)',
    kakao_nonce_failed: '카카오 인증 요청을 확인하지 못했습니다. 로그인 버튼을 눌러 다시 시작해 주세요. (KAKAO-09)',
    kakao_member_setup: '카카오 회원 정보를 저장하지 못했습니다. 회원가입 설정 확인이 필요합니다. (KAKAO-10)',
    kakao_supabase_failed: '카카오 인증 후 회원 로그인 연결에 실패했습니다. (KAKAO-11)',
    kakao_session_failed: '카카오 로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요. (KAKAO-12)',
    kakao_provider_failed: '카카오에서 로그인 요청을 처리하지 못했습니다. (KAKAO-13)',
  };
  byId('member-feedback').textContent = messages[params.get('auth')] || '인증 링크가 만료되었거나 유효하지 않습니다. 로그인 화면에서 다시 확인해 주세요.';
  params.delete('auth'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
}

async function loadProviders() {
  document.querySelectorAll('[data-social]').forEach(button => { button.disabled = true; });
  byId('social-status').textContent = '간편 로그인 연결을 확인하고 있습니다.';
  try {
    const data = await api('/api/oauth');
    document.querySelectorAll('[data-social]').forEach(button => {
      const ready = data.providers?.[button.dataset.social] === true;
      button.disabled = !ready;
      button.textContent = (button.dataset.social === 'google' ? '구글' : '카카오') + (ready ? '로 계속하기' : ' 로그인 · 연결 준비 중');
    });
    byId('social-status').textContent = '';
  } catch { byId('social-status').textContent = '간편 로그인 연결을 확인하지 못했습니다.'; }
}
document.querySelectorAll('[data-social]').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('[data-social]').forEach(b => { b.disabled = true; });
  byId('social-status').textContent = '로그인 화면으로 이동하고 있습니다.';
  try {
    const data = await api('/api/oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: button.dataset.social }) });
    location.assign(data.url);
  } catch (error) { await loadProviders(); byId('social-status').textContent = error.message; }
}));
byId('profile-dialog').addEventListener('cancel', event => event.preventDefault());
byId('profile-logout').addEventListener('click', () => byId('logout-button').click());
byId('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; if (!form.reportValidity()) return;
  byId('profile-submit').disabled = true; byId('profile-logout').disabled = true;
  try {
    const data = await api('/api/member-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    showUser(data.user); byId('profile-dialog').close(); form.reset();
    byId('member-feedback').textContent = data.message;
  } catch (error) { byId('profile-status').textContent = error.message; }
  finally { byId('profile-submit').disabled = false; byId('profile-logout').disabled = false; }
});
