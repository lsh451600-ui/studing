const byId = id => document.getElementById(id);
const fileInput = byId('ingredient-photo'), detected = byId('ingredient-detected'), results = byId('ingredient-results');
const analyze = byId('ingredient-analyze');
const cameraOpen = byId('ingredient-camera-open'), cameraPhoto = byId('ingredient-camera-photo');
const cameraPanel = byId('ingredient-camera'), cameraVideo = byId('ingredient-camera-video');
let cameraStream = null, cameraVersion = 0;
function closeCamera() {
  cameraVersion++;
  cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
  cameraVideo.srcObject = null; cameraPanel.hidden = true; cameraOpen.disabled = false;
}
function hasPhotoSpace() {
  if (selectedFiles.length < 3) return true;
  byId('ingredient-photo-status').textContent = '사진은 최대 3장까지 추가할 수 있습니다.';
  return false;
}
cameraOpen.addEventListener('click', async () => {
  if (!hasPhotoSpace()) return;
  if (!navigator.mediaDevices?.getUserMedia) { cameraPhoto.click(); return; }
  closeCamera(); const current = cameraVersion; cameraOpen.disabled = true;
  byId('ingredient-photo-status').textContent = '카메라를 준비하고 있습니다…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (current !== cameraVersion) { stream.getTracks().forEach(track => track.stop()); return; }
    cameraStream = stream; cameraVideo.srcObject = stream; cameraPanel.hidden = false;
    await cameraVideo.play();
    if (current === cameraVersion) byId('ingredient-photo-status').textContent = '식재료가 보이도록 맞춘 뒤 사진 촬영을 눌러 주세요.';
  } catch (error) {
    if (current !== cameraVersion) return;
    closeCamera();
    byId('ingredient-photo-status').textContent = error.name === 'NotAllowedError' ? '브라우저 설정에서 카메라 사용을 허용한 뒤 다시 눌러 주세요.' : '카메라를 켜지 못했습니다. 다른 앱에서 카메라를 사용 중인지 확인하거나 사진을 추가해 주세요.';
  }
});
byId('ingredient-camera-close').addEventListener('click', closeCamera);
byId('ingredient-camera-capture').addEventListener('click', () => {
  if (!hasPhotoSpace()) { closeCamera(); return; }
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    byId('ingredient-photo-status').textContent = '카메라 영상이 준비되면 다시 촬영해 주세요.'; return;
  }
  const current = cameraVersion;
  const canvas = document.createElement('canvas'); canvas.width = cameraVideo.videoWidth; canvas.height = cameraVideo.videoHeight;
  canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
  canvas.toBlob(blob => {
    if (current !== cameraVersion) return;
    if (!blob) { byId('ingredient-photo-status').textContent = '사진을 촬영하지 못했습니다. 다시 시도해 주세요.'; return; }
    closeCamera(); addPhotos([new File([blob], 'ingredient-camera.jpg', { type: 'image/jpeg' })]);
  }, 'image/jpeg', .9);
});
cameraPhoto.addEventListener('change', () => { const incoming = Array.from(cameraPhoto.files); cameraPhoto.value = ''; addPhotos(incoming); });
let analysisTimeout = null, lastIngredients = [];
let selectedFiles = [], previewUrls = [];
let worker = null, version = 0, searching = false, requestController = null;
function stopAnalysis() { clearTimeout(analysisTimeout); analysisTimeout = null; worker?.terminate(); worker = null; analyze.disabled = searching || !selectedFiles.length; }
function clear() {
  closeCamera(); cameraPhoto.value = '';
  version++; lastIngredients = []; stopAnalysis(); requestController?.abort(); requestController = null;
  selectedFiles = []; fileInput.value = ''; analyze.disabled = true; detected.textContent = ''; detected.hidden = true; results.replaceChildren();
  previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = [];
  byId('ingredient-preview').hidden = true; byId('ingredient-preview').replaceChildren();
  byId('ingredient-photo-status').textContent = ''; byId('ingredient-match-status').textContent = '';
  searching = false; analyze.disabled = !selectedFiles.length;
}
fileInput.addEventListener('change', () => {
  const incoming = Array.from(fileInput.files); fileInput.value = '';
  addPhotos(incoming);
});
function addPhotos(incoming) {
  if (!incoming.length) return;
  if (selectedFiles.length + incoming.length > 3) {
    byId('ingredient-photo-status').textContent = '사진은 최대 3장까지 추가할 수 있습니다.'; return;
  }
  if (incoming.some(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024)) {
    byId('ingredient-photo-status').textContent = 'JPG, PNG, WebP 사진을 한 장당 10MB 이하로 선택해 주세요.'; return;
  }
  version++; lastIngredients = []; stopAnalysis(); requestController?.abort(); requestController = null; searching = false;
  selectedFiles.push(...incoming); analyze.disabled = false;
  detected.textContent = ''; detected.hidden = true; results.replaceChildren(); byId('ingredient-match-status').textContent = '';
  const preview = byId('ingredient-preview'); preview.hidden = false;
  for (const file of incoming) {
    const url = URL.createObjectURL(file); previewUrls.push(url);
    const image = document.createElement('img'); image.src = url; image.alt = '선택한 식재료 사진 ' + previewUrls.length; preview.append(image);
  }
  analyzePhoto();
}
async function analyzePhoto() {
  const files = [...selectedFiles]; if (!files.length || worker || searching) return;
  const current = ++version; lastIngredients = []; analyze.disabled = true; results.replaceChildren(); detected.textContent = ''; detected.hidden = true; byId('ingredient-match-status').textContent = '';
  byId('ingredient-photo-status').textContent = '사진을 준비하고 있습니다…';
  try {
    const blobs = [];
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1,768/Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.85));
      if (current !== version) return;
      if (!blob) throw new Error('image');
      blobs.push(blob);
    }
    let photoIndex = 0;
    const combined = new Set();
    worker = new Worker('/assets/js/ingredient-vision-worker.js?v=20261009-v3',{ type:'module' });
    worker.onmessage = ({ data }) => {
      if (current !== version) return;
      if (data.type === 'progress') byId('ingredient-photo-status').textContent = '사진 '+(photoIndex+1)+'/'+blobs.length+' · '+data.message;
      else {
        if (data.type === 'result') {
          data.ingredients.forEach(name => combined.add(name));
          photoIndex++;
          if (photoIndex < blobs.length) { worker.postMessage({ blob: blobs[photoIndex] }); return; }
          stopAnalysis(); data.ingredients = [...combined]; lastIngredients = data.ingredients;
          detected.textContent = '사진에서 찾은 재료: ' + data.ingredients.join(', ');
          detected.hidden = !data.ingredients.length;
          byId('ingredient-photo-status').textContent = data.ingredients.length ? files.length+'장 사진 분석을 완료했습니다.' : '재료를 찾지 못했습니다. 식재료가 잘 보이는 다른 사진을 선택해 주세요.';
          if (data.ingredients.length) searchRecipes(data.ingredients, current);
        } else { byId('ingredient-photo-status').textContent = data.message; stopAnalysis(); }
      }
    };
    worker.onerror = () => { if (current !== version) return; byId('ingredient-photo-status').textContent = '사진 분석을 실행하지 못했습니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); };
    analysisTimeout = setTimeout(() => { if (current !== version) return; byId('ingredient-photo-status').textContent = '사진 분석에 시간이 오래 걸립니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); }, 240000 * files.length);
    worker.postMessage({ blob: blobs[0] });
  } catch { if (current === version) { byId('ingredient-photo-status').textContent = '사진을 읽지 못했습니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); } }
}
analyze.addEventListener('click', analyzePhoto);
async function searchRecipes(ingredients, current) {
  searching = true; analyze.disabled = true; results.replaceChildren();
  byId('ingredient-match-status').textContent = '등록된 레시피의 재료를 비교하고 있습니다…';
  const controller = new AbortController(); requestController = controller;
  const timeout = setTimeout(()=>controller.abort(),30000);
  try {
    const response = await fetch('/api/recipe-recommendations?' + new URLSearchParams({ ingredients:ingredients.join(', '), category:byId('recipe-filter-category').value }),{ credentials:'same-origin',cache:'no-store',signal:controller.signal });
    const data = await response.json(); if (current !== version) return;
    if (!response.ok) throw new Error(data.message || '레시피를 불러오지 못했습니다.');
    for (const [index,recipe] of data.recommendations.entries()) {
      const card = document.createElement('article'); card.className = 'ingredient-result';
      const heading = document.createElement('h4');
      heading.textContent = (index+1)+'. '+recipe.title;
      const total = recipe.photoIngredientCount;
      const score = document.createElement('span'); score.textContent = ' · 사진 재료 포함률 '+recipe.score+'% ('+recipe.matched.length+'/'+total+'개)'; heading.append(score); card.append(heading);
      for (const text of ['사진과 일치하는 재료: '+recipe.matched.join(', ')]) {
        const line = document.createElement('p'); line.textContent = text; card.append(line);
      }
      if (recipe.estimated) {
        const note = document.createElement('p'); note.textContent = '본문에서 추정한 재료 기준입니다.'; card.append(note);
      }
      const link = document.createElement('a'); link.className = 'ingredient-recipe-link'; link.setAttribute('aria-label', recipe.title + ' 레시피 바로 보기'); link.href = '/recipes?recipe=' + recipe.id; link.dataset.recipeId = String(recipe.id); link.textContent = '레시피 바로 보기'; card.append(link);
      results.append(card);
    }
    byId('ingredient-match-status').textContent = data.recommendations.length ? '' : '일치하는 레시피가 없습니다. 다른 식재료 사진으로 다시 검색해 주세요.';
  } catch(error) { if (current === version) byId('ingredient-match-status').textContent = error.name === 'AbortError' ? '검색 시간이 초과됐습니다. 다시 시도해 주세요.' : error.message; }
  finally { clearTimeout(timeout); if (current === version) { searching = false; analyze.disabled = !selectedFiles.length; requestController = null; } }
}
function updateRecommendations() {
  if (!lastIngredients.length) return;
  requestController?.abort();
  searchRecipes(lastIngredients, ++version);
}
byId('recipe-filter-category').addEventListener('change', updateRecommendations);
window.addEventListener('recipe-filter-reset', updateRecommendations);
byId('ingredient-clear').addEventListener('click',clear);
window.addEventListener('recipe-access-locked',clear);
window.addEventListener('pagehide',clear);
