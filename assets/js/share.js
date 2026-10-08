const triggers = document.querySelectorAll('[data-share-page]');
if (triggers.length) {
  const canonical = document.querySelector('link[rel="canonical"]')?.href || `${location.origin}${location.pathname}`;
  const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
  const description = document.querySelector('meta[property="og:description"]')?.content || document.querySelector('meta[name="description"]')?.content || '';
  const encodedUrl = encodeURIComponent(canonical);
  const encodedTitle = encodeURIComponent(title);
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'share-dialog-title');
  dialog.innerHTML = `
    <div class="share-dialog-heading"><h2 id="share-dialog-title">이 페이지 공유하기</h2><button type="button" class="share-close" aria-label="공유 창 닫기">닫기 ✕</button></div>
    <p class="share-dialog-description"></p>
    <div class="share-actions">
      <button type="button" class="share-native">카카오톡 등 앱으로 공유</button>
      <a class="share-network" target="_blank" rel="noopener noreferrer">Facebook</a>
      <a class="share-network" target="_blank" rel="noopener noreferrer">X에 공유</a>
      <a class="share-network" target="_blank" rel="noopener noreferrer">네이버로 공유</a>
    </div>
    <button type="button" class="share-copy">페이지 주소 복사</button>
    <p class="share-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  dialog.querySelector('.share-dialog-description').textContent = description;
  const facebook = dialog.querySelectorAll('.share-network')[0];
  facebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const x = dialog.querySelectorAll('.share-network')[1];
  x.href = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
  const naver = dialog.querySelectorAll('.share-network')[2];
  naver.href = `https://share.naver.com/web/shareView?url=${encodedUrl}&title=${encodedTitle}`;
  const nativeButton = dialog.querySelector('.share-native');
  if (!navigator.share) nativeButton.hidden = true;
  const status = dialog.querySelector('.share-status');

  for (const trigger of triggers) trigger.addEventListener('click', () => {
    status.textContent = '';
    dialog.showModal();
  });
  dialog.querySelector('.share-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  nativeButton.addEventListener('click', async () => {
    try {
      await navigator.share({ title, text: description, url: canonical });
    } catch (error) {
      if (error?.name !== 'AbortError') status.textContent = '공유 메뉴를 열지 못했습니다. 다른 공유 방법을 이용해 주세요.';
    }
  });
  dialog.querySelector('.share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(canonical);
      status.textContent = '페이지 주소를 복사했습니다.';
    } catch {
      const input = document.createElement('textarea');
      input.value = canonical;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      status.textContent = copied ? '페이지 주소를 복사했습니다.' : '주소를 복사하지 못했습니다. 주소창에서 복사해 주세요.';
    }
  });
}
