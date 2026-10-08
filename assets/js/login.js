// Default Supabase recovery emails may return to the configured site root.
const recoveryFragment = new URLSearchParams(location.hash.slice(1));
const recoveryQuery = new URLSearchParams(location.search);
if (!location.pathname.startsWith('/reset-password') && recoveryFragment.get('type') === 'recovery') {
  const fragment = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  location.replace('/reset-password' + fragment);
} else if (!location.pathname.startsWith('/reset-password') && recoveryFragment.get('error_code') === 'otp_expired') {
  const fragment = location.hash; history.replaceState(null, '', location.pathname + location.search);
  location.replace('/reset-password' + fragment);
} else if (!location.pathname.startsWith('/reset-password') && recoveryQuery.get('type') === 'recovery' && recoveryQuery.get('token_hash')) {
  const tokenHash = recoveryQuery.get('token_hash');
  history.replaceState(null, '', location.pathname);
  location.replace('/reset-password?token_hash=' + encodeURIComponent(tokenHash));
}
const byId = id => document.getElementById(id);
const dialog = byId('login-dialog'), form = byId('login-form'), status = byId('login-status');
const params = new URLSearchParams(location.search);
const SESSION_CACHE_KEY = 'member-session-v1';
const SESSION_CACHE_MS = 120000;
const protectedPaths = new Set(['/recipes', '/recipes.html', '/board', '/board.html', '/startup', '/startup.html', '/private', '/private.html', '/mypage', '/mypage.html']);
const protectedNext = (() => {
  let next = params.get('next');
  try { next ||= sessionStorage.getItem('member-login-next'); } catch {}
  if (!next) return null;
  try {
    const target = new URL(next, location.origin);
    return target.origin === location.origin && protectedPaths.has(target.pathname) ? target.pathname + target.search + target.hash : null;
  } catch { return null; }
})();
if (params.has('login_required') && protectedNext) { try { sessionStorage.setItem('member-login-next', protectedNext); } catch {} }
const errorDialog = document.createElement('dialog');
errorDialog.id = 'auth-error-dialog'; errorDialog.className = 'auth-error-dialog';
errorDialog.setAttribute('role', 'alertdialog');
errorDialog.setAttribute('aria-labelledby', 'auth-error-title');
errorDialog.setAttribute('aria-describedby', 'auth-error-message');
errorDialog.innerHTML = '<div class="auth-error-icon" aria-hidden="true">!</div><h2 id="auth-error-title">로그인 확인</h2><p id="auth-error-message"></p><button id="auth-error-close" type="button">확인</button>';
document.body.append(errorDialog);
let errorOpener;
function showAuthError(message) {
  byId('member-feedback').textContent = '';
  byId('auth-error-message').textContent = message;
  if (!errorDialog.open) { errorOpener = document.activeElement; errorDialog.showModal(); }
}
byId('auth-error-close').addEventListener('click', () => errorDialog.close());
errorDialog.addEventListener('close', () => {
  const target = dialog.open ? byId('login-password') : errorOpener;
  if (target?.isConnected && !target.hidden && !target.disabled) target.focus({ preventScroll: true });
});
const linkButton = document.createElement('button');
linkButton.className = 'kakao-link-button';
linkButton.id = 'kakao-link-button'; linkButton.type = 'button'; linkButton.hidden = true;
document.querySelector('#site-menu .menu-footer').prepend(linkButton);
linkButton.addEventListener('click', async () => {
  linkButton.disabled = true;
  byId('member-feedback').textContent = '';
  try {
    const data = await api('/api/oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'kakao', action: 'link' }) });
    location.assign(data.url);
  } catch (error) { showAuthError(error.message); linkButton.disabled = false; }
});
const myPageLink = document.createElement('a');
myPageLink.id = 'mypage-link'; myPageLink.href = '/mypage'; myPageLink.textContent = '마이페이지'; myPageLink.hidden = true;
document.querySelector('#site-menu .menu-footer').prepend(myPageLink);
const forgotLink = document.createElement('a');
forgotLink.className = 'forgot-password-link'; forgotLink.href = '/forgot-password'; forgotLink.textContent = '비밀번호 찾기';
form.after(forgotLink);
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
  myPageLink.hidden = !user;
  byId('menu-account-status').textContent = user ? user.username + '님' : '로그인하지 않았습니다.';
  byId('menu-account-status').dataset.state = user ? 'authenticated' : 'anonymous';
  byId('menu-account-status').setAttribute('aria-label', user ? '로그인 중 · ' + user.username + '님' : '로그인하지 않았습니다.');
  byId('menu-account-status').title = user ? user.username + '님' : '';
  byId('menu-account-action').hidden = false;
  byId('menu-account-action').textContent = user ? '로그아웃' : '로그인';
  linkButton.hidden = !user || Boolean(user.kakaoLinked);
  linkButton.disabled = false;
  linkButton.textContent = '카카오 연결';
  linkButton.setAttribute('aria-label', '카카오 계정 연결');
  if (!user && byId('profile-dialog').open) byId('profile-dialog').close();
  byId('login-open').hidden = Boolean(user); byId('signup-open').hidden = Boolean(user);
  byId('member-status').hidden = !user; byId('logout-button').hidden = !user;
  byId('member-status').textContent = '';
  if (user) {
    const profile = document.createElement('a'); profile.href = '/mypage'; profile.className = 'member-profile-link';
    profile.textContent = user.username + '님'; profile.setAttribute('aria-label', user.username + '님 마이페이지');
    byId('member-status').append(profile);
  }
  byId('member-status').title = user ? '로그인 중 · ' + user.username + '님' : '';
  byId('member-status').setAttribute('aria-label', user ? '로그인 중 · ' + user.username + '님' : '회원 상태');
  byId('member-status').closest('.member-controls').dataset.state = user ? 'authenticated' : 'anonymous';
  byId('logout-button').textContent = '로그아웃';
}
function readSessionCache() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || 'null');
    if (entry && Date.now() - entry.savedAt < SESSION_CACHE_MS && entry.data) return entry.data;
  } catch {}
  return null;
}
function writeSessionCache(data) {
  try { sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
}
function clearSessionCache() {
  try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch {}
}
async function checkSession({ force = false } = {}) {
  let data = force ? null : readSessionCache();
  if (!data) {
    data = await api('/api/session');
    writeSessionCache(data);
  }
  showUser(data.authenticated ? data.user : null);
  if (data.authenticated && data.profileUnavailable) {
    byId('member-feedback').textContent = '회원 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
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
  } catch (error) { status.textContent = error.message; byId('login-submit').disabled = true; }
}
byId('login-open').addEventListener('click', openLogin);
byId('menu-account-action').addEventListener('click', () => {
  byId('site-menu').close();
  if (currentUser) byId('logout-button').click();
  else byId('login-open').click();
});
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
    writeSessionCache({ available: true, authenticated: true, user: data.user });
    try { sessionStorage.removeItem('member-login-next'); } catch {}
    showUser(data.user); form.reset(); dialog.close(); byId('member-feedback').textContent = '';
    if (protectedNext) { location.assign(protectedNext); return; }
  } catch (error) { status.textContent = ''; showAuthError(error.message); }
  finally {
    byId('login-password').value = ''; pending = false;
    byId('login-submit').disabled = false; byId('login-close').disabled = false; form.removeAttribute('aria-busy');
  }
});
byId('logout-button').addEventListener('click', async () => {
  byId('logout-button').disabled = true;
  byId('logout-button').textContent = '로그아웃 중…';
  try { await api('/api/logout', { method: 'POST' }); clearSessionCache(); writeSessionCache({ available: true, authenticated: false, user: null }); try { sessionStorage.removeItem('member-login-next'); } catch {} showUser(null); byId('member-feedback').textContent = ''; if (['/mypage', '/mypage.html'].includes(location.pathname)) location.replace('/'); }
  catch (error) { showAuthError(error.message); }
  finally { byId('logout-button').disabled = false; byId('logout-button').textContent = '로그아웃'; }
});
window.addEventListener('member-authenticated', event => {
  writeSessionCache({ available: true, authenticated: Boolean(event.detail), user: event.detail || null });
  showUser(event.detail); byId('member-feedback').textContent = '';
});
const navigationType = performance.getEntriesByType('navigation')[0]?.type;
const initialSession = checkSession({ force: navigationType === 'reload' || params.has('auth') || params.has('login_required') }).catch(() => {
  clearSessionCache();
  byId('member-status').hidden = false;
  byId('member-status').textContent = '로그인 상태 확인 지연';
  byId('menu-account-status').textContent = '로그인 상태를 확인하지 못했습니다.';
  byId('menu-account-status').dataset.state = 'unknown';
  byId('logout-button').hidden = true;
  byId('login-open').hidden = false;
  byId('signup-open').hidden = false;
  byId('member-feedback').textContent = '로그인 확인이 잠시 지연되고 있습니다. 다시 시도해 주세요.';
  return null;
});
if (params.has('login_required')) {
  initialSession.then(data => {
    if (data?.authenticated && protectedNext) { try { sessionStorage.removeItem('member-login-next'); } catch {} location.replace(protectedNext); return; }
    if (data?.available) openLogin();
    else if (data) byId('member-feedback').textContent = '로그인 서비스를 준비 중입니다. 잠시 후 다시 시도해 주세요.';
  });
} else if (params.has('auth') && protectedNext) {
  initialSession.then(data => { if (data?.authenticated) { try { sessionStorage.removeItem('member-login-next'); } catch {} location.replace(protectedNext); } });
}
if (params.has('auth')) {
  const messages = {
    kakao_linked: '기존 회원 계정에 카카오가 연결되었습니다. 다음부터 카카오로 로그인할 수 있습니다.',
    kakao_link_session: '연결하려던 로그인 상태가 변경되었습니다. 기존 아이디로 로그인한 뒤 다시 연결해 주세요.',
    kakao_link_conflict: '이 카카오는 다른 회원 계정에 이미 연결되어 있습니다.',
    kakao_link_disabled: 'Supabase에서 수동 계정 연결 허용 설정이 필요합니다.',
    kakao_link_failed: '카카오 계정을 연결하지 못했습니다. 이미 다른 계정에 연결되어 있는지 확인해 주세요.',
    confirmed: '이메일 인증이 완료되었습니다.', social: '소셜 로그인 인증이 완료되었습니다.',
    social_failed: '소셜 로그인을 완료하지 못했습니다. 다시 시도해 주세요.',
    kakao_flow_expired: '로그인 요청이 만료되었거나 다른 창에서 변경되었습니다. 로그인 버튼을 눌러 다시 시작해 주세요. (KAKAO-01)',
    kakao_cancelled: '카카오 로그인이 취소되었습니다. 원하시면 다시 로그인해 주세요.',
    kakao_config_required: '카카오 로그인 설정 확인이 필요합니다. (KAKAO-02)',
    kakao_key_invalid: '카카오 REST API 키 설정을 확인해야 합니다. (KOE101)',
    kakao_key_changed: '로그인 도중 카카오 앱 키가 변경되었습니다. 로그인 버튼에서 다시 시작해 주세요. (KOE114)',
    kakao_redirect_mismatch: '카카오 인증 요청과 처리 주소가 일치하지 않습니다. (KOE303)',
    kakao_code_expired: '카카오 인증 코드가 만료되었거나 이미 사용되었습니다. 로그인 버튼에서 다시 시작해 주세요. (KOE320)',
    kakao_rate_limited: '카카오 로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요. (KOE237)',
    kakao_platform_invalid: '카카오 앱의 웹 플랫폼 설정을 확인해야 합니다. (KOE009)',
    kakao_ip_restricted: '카카오 앱의 요청 IP 제한 설정을 확인해야 합니다. (KOE127)',
    kakao_connection_timeout: '서버에서 카카오에 연결하는 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요. (KAKAO-14)',
    kakao_connection_failed: '서버에서 카카오 인증 서버로 연결하지 못했습니다. 서버 연결 확인이 필요합니다. (KAKAO-15)',
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
  let message = messages[params.get('auth')] || '인증 링크가 만료되었거나 유효하지 않습니다. 로그인 화면에서 다시 확인해 주세요.';
  const detail = params.get('detail') || '';
  if (params.get('auth') === 'kakao_token_failed' && /^(KOE[0-9]{3}|HTTP[0-9]{3})$/.test(detail)) {
    message += ' [' + detail + ']';
  }
  if (!['confirmed', 'social', 'kakao_linked'].includes(params.get('auth'))) showAuthError(message);
  params.delete('detail');
  params.delete('auth'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
}

function socialStatus(message) {
  for (const id of ['social-status', 'signup-social-status']) { if (byId(id)) byId(id).textContent = message; }
}
byId('signup-open').addEventListener('click', loadProviders);
let providerLookup = null, socialPending = false;
function socialLabel(button, ready = true) {
  const name = button.dataset.social === 'google' ? '구글' : '카카오';
  return name + (button.dataset.mode === 'signup' ? (ready ? '로 가입하기' : ' 가입 · 연결 준비 중') : (ready ? '로 계속하기' : ' 로그인 · 연결 준비 중'));
}
async function loadProviders() {
  // A slow readiness lookup must not block Google's actual authorization request.
  if (socialPending) return;
  if (providerLookup) return providerLookup;
  providerLookup = updateProviders();
  try { await providerLookup; } finally { providerLookup = null; }
}
async function updateProviders() {
  try {
    const data = await api('/api/oauth');
    if (socialPending) return;
    document.querySelectorAll('[data-social]').forEach(button => {
      const ready = data.providers?.[button.dataset.social] === true;
      button.disabled = !ready;
      button.textContent = socialLabel(button, ready);
    });
    socialStatus('');
  } catch {
    if (socialPending) return;
    // POST /api/oauth checks provider readiness again on the server.
    document.querySelectorAll('[data-social]').forEach(button => { button.disabled = false; button.textContent = socialLabel(button); });
    socialStatus('연결 상태 확인이 지연됩니다. 가입·로그인 버튼을 눌러 다시 연결할 수 있습니다.');
  }
}
document.querySelectorAll('[data-social]').forEach(button => button.addEventListener('click', async () => {
  if (socialPending) return;
  socialPending = true;
  document.querySelectorAll('[data-social]').forEach(b => { b.disabled = true; });
  socialStatus('로그인 화면으로 이동하고 있습니다.');
  try {
    const data = await api('/api/oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: button.dataset.social }) });
    const target = new URL(data.url);
    if (target.protocol !== 'https:') throw new Error('인증 주소를 확인하지 못했습니다. 다시 시도해 주세요.');
    location.assign(data.url);
  } catch (error) {
    socialPending = false;
    document.querySelectorAll('[data-social]').forEach(b => { b.disabled = false; b.textContent = socialLabel(b); });
    socialStatus(error.message);
    showAuthError(error.message);
  }
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
    byId('member-feedback').textContent = '';
    await checkSession({ force: true });
  } catch (error) { byId('profile-status').textContent = error.message; }
  finally { byId('profile-submit').disabled = false; byId('profile-logout').disabled = false; }
});
