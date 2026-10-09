const player = document.getElementById('video-player');
const title = document.getElementById('video-title');
const meta = document.getElementById('video-meta');
const status = document.getElementById('video-status');
const watch = document.getElementById('video-watch');
let currentId = null;
const errors = {
  setup_required: 'Cloudflare에 YOUTUBE_API_KEY가 등록되어 있지 않습니다. (YT-01)',
  api_key_invalid: '유튜브 API 키가 올바르지 않습니다. Cloudflare에 등록한 값을 확인해 주세요. (YT-02)',
  api_not_enabled: 'API 키를 발급한 구글 프로젝트에서 YouTube Data API v3를 활성화해 주세요. (YT-03)',
  api_key_restricted: 'API 키 제한 설정이 서버 요청을 차단하고 있습니다. (YT-04)',
  quota_exceeded: '유튜브 API의 일일 요청 한도를 초과했습니다. (YT-05)',
  youtube_forbidden: '구글에서 영상 조회 요청을 거부했습니다. API 사용 설정과 키 제한을 확인해 주세요. (YT-06)',
  youtube_timeout: '유튜브 연결 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요. (YT-07)',
  youtube_connection_failed: '유튜브 서버에 연결하지 못했습니다. (YT-08)',
  no_video: '최근 7일의 조건에 맞는 공개 영상을 찾지 못했습니다. (YT-09)',
  storage_unavailable: '영상 캐시에 연결하지 못했습니다. 서버 설정 확인이 필요합니다. (YT-10)',
  refresh_pending: '영상을 갱신하고 있습니다. 잠시 후 새로고침해 주세요.',
  youtube_response_invalid: '유튜브 응답을 처리하지 못했습니다. 서버 응답 확인이 필요합니다. (YT-12)',
  youtube_redirect_blocked: '유튜브 API 주소에서 예상하지 못한 이동 응답을 받았습니다. (YT-13)',
  youtube_internal_error: '영상 정보 처리 중 오류가 발생했습니다. (YT-14)',
  youtube_unavailable: '유튜브에서 영상 정보를 가져오지 못했습니다. (YT-11)'
};
const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', second: '2-digit', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
async function update() {
  try {
    const response = await fetch('/api/trend-video', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok && !data.reason) throw new Error('unavailable');
    if (!data.available || !/^[A-Za-z0-9_-]{11}$/.test(data.video?.id || '')) {
      if (!currentId) document.getElementById('video-loading').textContent = data.reason === 'setup_required' ? '최신 영상 연결을 준비하고 있습니다.' : '영상 연결을 확인해 주세요.';
      status.textContent = errors[data.reason] || '영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
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
    status.textContent = '최근 7일 · 최신 발행순 · 매일 오전 9시·오후 9시 자동 갱신\n접속 기준: ' + date(data.requestedAt || data.checkedAt) + ' (한국 시간)\n실제 수집: ' + date(data.checkedAt) + ' (한국 시간)' + (data.stale ? ' · 갱신 지연으로 이전 결과를 표시합니다.' : '');
    watch.href = 'https://www.youtube.com/watch?v=' + video.id;
  } catch {
    if (!currentId) document.getElementById('video-loading').textContent = '영상을 불러오지 못했습니다.';
    status.textContent = currentId ? '갱신이 지연되어 이전 영상을 표시합니다.' : '잠시 후 다시 방문하거나 유튜브에서 살펴보세요.';
  }
}
update();
globalThis.window?.addEventListener('pageshow', event => { if (event.persisted) update(); });

// Refresh already-open homepages as scheduled content becomes available.
setInterval(() => { if (!document.hidden) update(); }, 5 * 60 * 1000);
