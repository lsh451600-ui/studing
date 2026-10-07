const form = document.getElementById('recipe-access-form');
const input = document.getElementById('recipe-password');
const submit = document.getElementById('recipe-submit');
const status = document.getElementById('recipe-status');
const gate = document.getElementById('recipe-gate');
const content = document.getElementById('recipe-content');
let pending = false;
document.getElementById('recipe-show-password').addEventListener('change', event => {
  input.type = event.target.checked ? 'text' : 'password';
});
function lock() {
  form.reset(); input.type = 'password'; content.replaceChildren(); content.hidden = true;
  gate.hidden = false; status.textContent = '';
}
document.getElementById('recipe-lock').addEventListener('click', () => { lock(); input.focus(); });
window.addEventListener('pagehide', lock);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || !form.reportValidity()) return;
  pending = true; submit.disabled = true; form.setAttribute('aria-busy', 'true');
  status.textContent = '비밀번호를 확인하고 있습니다.';
  try {
    const response = await fetch('/api/recipes', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
    const data = await response.json();
    if (!response.ok) { status.textContent = data.message || '다시 시도해 주세요.'; return; }
    const heading = document.createElement('h2'); heading.textContent = data.title; heading.tabIndex = -1;
    const description = document.createElement('p'); description.textContent = data.description;
    content.replaceChildren(heading, description);
    content.hidden = false; gate.hidden = true; heading.focus();
  } catch {
    status.textContent = '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    input.value = ''; input.type = 'password';
    document.getElementById('recipe-show-password').checked = false;
    pending = false; submit.disabled = false; form.removeAttribute('aria-busy');
  }
});
