const byId = id => document.getElementById(id);
const status = byId('account-status'), dialog = byId('withdrawal-dialog');
let pending = false;
function clearLocalSession() {
  try { sessionStorage.removeItem('member-session-v1'); sessionStorage.removeItem('member-login-next'); } catch {}
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
    byId('account-username').textContent = account.username;
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
