const player = document.getElementById('video-player');
const title = document.getElementById('video-title');
const meta = document.getElementById('video-meta');
const status = document.getElementById('video-status');
const watch = document.getElementById('video-watch');
let currentId = null;
const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
async function update() {
  try {
    const response = await fetch('/api/trend-video', { credentials: 'omit', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!data.available || !/^[A-Za-z0-9_-]{11}$/.test(data.video?.id || '')) {
      if (!currentId) document.getElementById('video-loading').textContent = '인기 영상 연결을 준비하고 있습니다.';
      status.textContent = '유튜브에서 외식 트렌드 영상을 살펴보세요.';
      return;
    }
    const video = data.video;
    if (currentId !== video.id) {
      const start = document.createElement('button');
      start.type = 'button'; start.className = 'video-start'; start.id = 'video-start';
      start.setAttribute('aria-label', video.title + ' 재생');
      const thumbnail = document.createElement('img');
      thumbnail.src = 'https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'; thumbnail.alt = '';
      const mark = document.createElement('span'); mark.className = 'video-play-mark'; mark.textContent = '▶'; mark.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = '영상 재생';
      start.append(thumbnail, mark, label);
      start.addEventListener('click', () => {
        const iframe = document.createElement('iframe');
        iframe.src = 'https://www.youtube-nocookie.com/embed/' + video.id + '?autoplay=1&playsinline=1&rel=0&controls=1';
        iframe.title = video.title; iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.allow = 'autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true; player.replaceChildren(iframe);
      }, { once: true });
      player.replaceChildren(start); currentId = video.id;
    }
    title.textContent = video.title;
    meta.textContent = video.channel + ' · 조회수 ' + new Intl.NumberFormat('ko-KR').format(video.views) + '회';
    status.textContent = '최근 30일 · 관련 검색 결과 조회수순 · 30분 갱신\n' + date(data.checkedAt) + ' 확인 (한국 시간)' + (data.stale ? ' · 갱신 지연으로 이전 결과를 표시합니다.' : '');
    watch.href = 'https://www.youtube.com/watch?v=' + video.id;
  } catch {
    if (!currentId) document.getElementById('video-loading').textContent = '영상을 불러오지 못했습니다.';
    status.textContent = currentId ? '갱신이 지연되어 이전 영상을 표시합니다.' : '잠시 후 다시 방문하거나 유튜브에서 살펴보세요.';
  }
}
update();
setInterval(() => { if (!document.hidden) update(); }, 30 * 60 * 1000);
