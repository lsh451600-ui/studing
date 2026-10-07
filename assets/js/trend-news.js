const section = document.getElementById('trends');
const stamp = document.getElementById('news-status');
const kst = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
const safeURL = value => { try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
async function loadNews() {
  try {
    const response = await fetch('/api/trend-news', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!data.available || !Array.isArray(data.articles) || !data.articles.length) throw new Error('empty');
    const cards = document.createDocumentFragment();
    for (const article of data.articles.slice(0, 6)) {
      const url = safeURL(article.original_url || article.url); if (!url) continue;
      const card = document.createElement('a'); card.className = 'card'; card.href = url; card.target = '_blank'; card.rel = 'noopener noreferrer';
      const photo = document.createElement('div'); photo.className = 'news-photo news-photo-empty';
      const imageURL = safeURL(article.image || '');
      if (article.image && imageURL) {
        const image = document.createElement('img'); image.src = imageURL; image.alt = article.image_alt || article.title + ' · 기사 사진'; image.loading = 'lazy'; image.decoding = 'async'; image.width = 640; image.height = 400;
        photo.className = 'news-photo'; photo.append(image);
      } else { photo.textContent = '기사 이미지 미제공'; }
      const source = document.createElement('p'); source.className = 'cat'; source.textContent = article.source;
      const title = document.createElement('h3'); title.textContent = article.title;
      const published = document.createElement('p'); published.className = 'desc'; published.textContent = kst(article.published_at) + ' · 한국 시간';
      const read = document.createElement('div'); read.className = 'read'; read.textContent = '기사 원문 읽기 ↗';
      card.append(photo, source, title, published, read); cards.append(card);
    }
    section.querySelector('.cards').replaceChildren(cards);
    stamp.textContent = '최근 30일 외식 트렌드 · 최신 6개 · 접속할 때 조회\n접속 기준: ' + kst(data.requestedAt) + ' (한국 시간)\n실제 수집: ' + kst(data.checkedAt) + ' (한국 시간)' + (data.stale ? ' · 수집이 지연되어 이전 결과를 표시합니다.' + (/^NEWS-0[1-5]$/.test(data.failureCode || '') ? ' (' + data.failureCode + ')' : '') : '');
  } catch {
    stamp.textContent = '최신 기사 조회에 실패해 이전 수집 결과를 표시합니다. 실제 수집: ' + stamp.dataset.collected + ' (한국 시간)';
  }
}
loadNews();
window.addEventListener('pageshow', event => { if (event.persisted) loadNews(); });
