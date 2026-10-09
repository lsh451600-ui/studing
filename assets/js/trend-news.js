const section = document.getElementById('trends');
const stamp = document.getElementById('news-status');
const kst = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
const safeURL = value => { if (typeof value !== 'string' || !value.trim()) return null; try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
function protectPhoto(image, fallbackURL) {
  let retried = false;
  const fallback = () => {
    const url = safeURL(fallbackURL);
    if (!retried && url && url !== image.src) { retried = true; image.src = url; }
    else image.closest('.card')?.remove();
  };
  image.addEventListener('error', fallback);
  if (image.complete && !image.naturalWidth) fallback();
}
for (const image of section.querySelectorAll('.news-photo img')) protectPhoto(image, image.dataset.fallback);
async function loadNews() {
  try {
    const response = await fetch('/api/trend-news', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!data.available || !Array.isArray(data.articles) || !data.articles.length) throw new Error('empty');
    const cards = document.createDocumentFragment();
    for (const article of data.articles.slice(0, 6)) {
      const url = safeURL(article.original_url || article.url); if (!url || !article.image) continue;
      const card = document.createElement('a'); card.className = 'card'; card.href = url; card.target = '_blank'; card.rel = 'noopener noreferrer';
      const imageURL = safeURL(article.image);
      if (imageURL && (new URL(imageURL).origin === location.origin || new URL(imageURL).protocol === 'https:') && article.image) {
        const photo = document.createElement('div'); photo.className = 'news-photo';
        const image = document.createElement('img'); image.src = imageURL; image.alt = article.image_alt || article.title;
        image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.width = 640; image.height = 400;
        protectPhoto(image, article.image_fallback);
        photo.append(image); card.append(photo);
        const credit = document.createElement('p'); credit.className = 'news-photo-credit'; credit.textContent = '사진 출처: ' + article.source; card.append(credit);
      } else { continue; }
      const source = document.createElement('p'); source.className = 'cat'; source.textContent = article.source;
      const title = document.createElement('h3'); title.textContent = article.title;
      const published = document.createElement('p'); published.className = 'desc'; published.textContent = kst(article.published_at) + ' · 한국 시간';
      const read = document.createElement('div'); read.className = 'read'; read.textContent = '기사 원문 읽기 ↗';
      card.append(source, title, published, read); cards.append(card);
    }
    if (!cards.childElementCount) throw new Error('no_photos');
    section.querySelector('.cards').replaceChildren(cards);
    stamp.textContent = '최근 7일 외식 트렌드 · ' + data.articles.length + '개 · 매일 오전 9시·오후 9시 자동 갱신\n접속 기준: ' + kst(data.requestedAt) + ' (한국 시간)\n실제 수집: ' + kst(data.checkedAt) + ' (한국 시간)' + (data.sourceMode === 'relay' ? (Date.parse(data.requestedAt) - Date.parse(data.checkedAt) <= 15 * 60000 ? ' · Google 뉴스 자동 수집본' : ' · 자동 수집이 지연되어 마지막 수집본을 표시합니다.') : data.stale ? ' · 수집이 지연되어 이전 결과를 표시합니다.' + (/^NEWS-0[1-5]$/.test(data.failureCode || '') ? ' (' + data.failureCode + ')' : '') : '');
  } catch {
    stamp.textContent = '최신 기사 조회에 실패해 이전 수집 결과를 표시합니다. 실제 수집: ' + stamp.dataset.collected + ' (한국 시간)';
  }
}
loadNews();
window.addEventListener('pageshow', event => { if (event.persisted) loadNews(); });

// Refresh already-open homepages as scheduled content becomes available.
setInterval(() => { if (!document.hidden) loadNews(); }, 5 * 60 * 1000);
