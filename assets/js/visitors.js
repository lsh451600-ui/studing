const counter = document.createElement('div');
counter.className = 'visitor-counter'; counter.id = 'visitor-counter';
counter.setAttribute('role', 'status'); counter.setAttribute('aria-live', 'polite');
counter.title = '한국 시간 기준 · 같은 브라우저는 하루 한 번 집계 · 총 방문자는 일별 집계의 누적 합계';
counter.innerHTML = '<span>오늘 <b id="visitor-today">—</b></span><span aria-hidden="true">/</span><span>총 <b id="visitor-total">—</b></span>';
document.body.append(counter);
async function update() {
  try {
    const response = await fetch('/api/visitors', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) { counter.title = data.reason === 'storage_not_configured' ? '방문자 저장소가 연결되지 않았습니다.' : '방문자 집계 연결이 지연되고 있습니다.'; return; }
    if (!data.available || !Number.isSafeInteger(data.today) || !Number.isSafeInteger(data.total)) return;
    counter.title = '한국 시간 기준 · 같은 브라우저는 하루 한 번 집계 · 총 방문자는 일별 집계의 누적 합계';
    const number = new Intl.NumberFormat('ko-KR');
    document.getElementById('visitor-today').textContent = number.format(data.today);
    document.getElementById('visitor-total').textContent = number.format(data.total);
  } catch { /* Keep an honest unavailable marker instead of a fabricated count. */ }
}
update();
setInterval(() => { if (!document.hidden) update(); }, 5 * 60 * 1000);

window.addEventListener('pageshow', event => { if (event.persisted) update(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
