const dialog = document.getElementById('signup-dialog');
const form = document.getElementById('signup-form');
const submit = document.getElementById('signup-submit');
const status = document.getElementById('signup-status');
let pending = false;
let available = false;
let opener;

document.getElementById('signup-open').addEventListener('click', async event => {
  opener = event.currentTarget;
  dialog.showModal();
  status.textContent = '회원가입 가능 여부를 확인하고 있습니다.';
  submit.disabled = true;
  available = false;
  submit.textContent = '회원가입하기';
  try {
    const response = await fetch('/api/register', { cache: 'no-store' });
    const data = await response.json();
    available = response.ok && data.available === true;
    submit.disabled = !available;
    status.textContent = available ? '' : '회원가입을 준비 중입니다. 잠시 후 다시 방문해 주세요.';
  } catch {
    status.textContent = '회원가입에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
});
document.getElementById('signup-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  document.getElementById('signup-password').value = '';
  document.getElementById('signup-password').type = 'password';
  document.getElementById('signup-show-password').checked = false;
  opener?.focus();
});
dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
document.getElementById('signup-show-password').addEventListener('change', event => {
  document.getElementById('signup-password').type = event.target.checked ? 'text' : 'password';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || !available || !form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form));
  if (!/^\+?[0-9]{9,15}$/.test(payload.phone.replace(/[\s()-]/g, ''))) {
    status.textContent = '전화번호를 확인해 주세요. 숫자 9~15자리로 입력해 주세요.';
    document.getElementById('signup-phone').focus();
    return;
  }
  pending = true;
  submit.disabled = true;
  document.getElementById('signup-close').disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '가입 정보를 확인하고 있습니다.';
  try {
    const response = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (response.status === 201) {
      form.reset();
      available = false;
      status.textContent = data.message;
      submit.textContent = '가입 완료';
    } else {
      status.textContent = data.message || '가입을 완료하지 못했습니다. 다시 시도해 주세요.';
    }
  } catch {
    status.textContent = '가입 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    document.getElementById('signup-password').value = '';
    document.getElementById('signup-password').type = 'password';
    document.getElementById('signup-show-password').checked = false;
    pending = false;
    submit.disabled = !available;
    document.getElementById('signup-close').disabled = false;
    form.removeAttribute('aria-busy');
  }
});
