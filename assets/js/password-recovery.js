const forgot = document.getElementById('forgot-password-form');
const reset = document.getElementById('reset-password-form');
const status = document.getElementById('recovery-status'), submit = document.getElementById('recovery-submit');
let recovery = window.__passwordRecovery || {};
delete window.__passwordRecovery;
let pending = false;
function message(value, error = false) { status.textContent = value; status.dataset.error = String(error); }
async function send(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(75000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '요청을 완료하지 못했습니다.');
  return data;
}
forgot?.addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !forgot.reportValidity()) return;
  pending = true; submit.disabled = true; message('재설정 메일을 요청하고 있습니다.');
  try { const data = await send('/api/forgot-password', { identifier: document.getElementById('recovery-identifier').value }); message(data.message); }
  catch (error) { message(error.message || '메일을 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.', true); }
  finally { pending = false; submit.disabled = false; }
});
if (reset) {
  if ((!recovery.tokenHash && !recovery.accessToken) || recovery.error) {
    submit.disabled = true;
    message('재설정 링크가 없거나 만료되었습니다. 비밀번호 찾기에서 메일을 다시 요청해 주세요.', true);
  }
  document.getElementById('reset-password-show').addEventListener('change', event => {
    for (const id of ['reset-password', 'reset-password-confirmation']) document.getElementById(id).type = event.target.checked ? 'text' : 'password';
  });
  reset.addEventListener('submit', async event => {
    event.preventDefault(); if (pending || !reset.reportValidity()) return;
    const password = document.getElementById('reset-password').value;
    if (password !== document.getElementById('reset-password-confirmation').value) { message('새 비밀번호와 확인 값이 일치하지 않습니다.', true); return; }
    if (!recovery.tokenHash && !recovery.accessToken) return;
    pending = true; submit.disabled = true; message('새 비밀번호를 저장하고 있습니다.');
    try {
      const data = await send('/api/reset-password', { password, tokenHash: recovery.tokenHash, accessToken: recovery.accessToken });
      recovery = {}; reset.reset();
      try { sessionStorage.removeItem('member-session-v1'); } catch {}
      window.dispatchEvent(new CustomEvent('member-authenticated', { detail: null }));
      message(data.message); reset.querySelectorAll('input').forEach(input => { input.disabled = true; });
      document.getElementById('recovery-next').href = '/?login_required=1'; document.getElementById('recovery-next').textContent = '새 비밀번호로 로그인';
    } catch (error) { message(error.message || '비밀번호를 변경하지 못했습니다. 재설정 메일을 다시 요청해 주세요.', true); }
    finally { for (const id of ['reset-password', 'reset-password-confirmation']) document.getElementById(id).value = ''; pending = false; submit.disabled = !recovery.tokenHash && !recovery.accessToken; }
  });
}
