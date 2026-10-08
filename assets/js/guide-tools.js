// Local-only examples: no input is stored or sent to a server.
export function contribution(price, variable) {
  if (![price, variable].every(Number.isFinite) || price <= 0 || variable < 0) return null;
  return { amount: price - variable, ratio: (price - variable) / price };
}
export function breakEven(fixed, price, variable, days) {
  const margin = contribution(price, variable);
  if (!margin || margin.amount <= 0 || !Number.isFinite(fixed) || fixed < 0 || !Number.isInteger(days) || days < 1 || days > 31) return null;
  const units = Math.ceil(fixed / margin.amount);
  return { units, revenue: units * price, daily: Math.ceil(units / days) };
}
if (typeof document !== 'undefined') {
  const won = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value) + '원';
  for (const form of document.querySelectorAll('[data-guide-tool]')) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim() === '' ? NaN : Number(value)]));
      const output = form.querySelector('output');
      if (form.dataset.guideTool === 'margin') {
        const result = contribution(values.price, values.variable);
        output.textContent = result ? '1건당 공헌이익 ' + won(result.amount) + ' · 공헌이익률 ' + (result.ratio * 100).toFixed(1) + '%' + (result.amount <= 0 ? ' · 판매량이 늘어도 고정비를 충당할 수 없습니다.' : '') : '판매가는 0보다 크게, 변동비는 0 이상으로 입력해 주세요.';
      } else {
        const result = breakEven(values.fixed, values.price, values.variable, values.days);
        output.textContent = result ? '월 최소 ' + result.units.toLocaleString('ko-KR') + '건 · 매출 ' + won(result.revenue) + ' · 영업일당 평균 목표 ' + result.daily.toLocaleString('ko-KR') + '건 (올림)' : '판매가는 변동비보다 크게, 고정비는 0 이상, 영업일은 1~31의 정수로 입력해 주세요.';
      }
    });
  }
  document.querySelectorAll('[data-print-guide]').forEach(button => button.addEventListener('click', () => window.print()));
}
