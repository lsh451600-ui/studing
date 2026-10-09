const byId = id => document.getElementById(id);
const fileInput = byId('ingredient-photo'), detected = byId('ingredient-detected'), results = byId('ingredient-results');
const analyze = byId('ingredient-analyze');
let analysisTimeout = null;
let worker = null, url = null, version = 0, searching = false, requestController = null;
function stopAnalysis() { clearTimeout(analysisTimeout); analysisTimeout = null; worker?.terminate(); worker = null; analyze.disabled = searching || !fileInput.files[0]; }
function clear() {
  version++; stopAnalysis(); requestController?.abort(); requestController = null;
  fileInput.value = ''; analyze.disabled = true; detected.textContent = ''; detected.hidden = true; results.replaceChildren();
  if (url) URL.revokeObjectURL(url); url = null;
  byId('ingredient-preview').hidden = true; byId('ingredient-preview').removeAttribute('src');
  byId('ingredient-photo-status').textContent = ''; byId('ingredient-match-status').textContent = '';
  searching = false; analyze.disabled = !fileInput.files[0];
}
fileInput.addEventListener('change', () => {
  version++; stopAnalysis(); requestController?.abort(); requestController = null; searching = false; analyze.disabled = !fileInput.files[0];
  detected.textContent = ''; detected.hidden = true; results.replaceChildren(); byId('ingredient-match-status').textContent = '';
  if (url) URL.revokeObjectURL(url); url = null;
  byId('ingredient-preview').hidden = true; byId('ingredient-photo-status').textContent = '';
  const file = fileInput.files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) {
    fileInput.value = ''; analyze.disabled = true; byId('ingredient-photo-status').textContent = 'JPG, PNG, WebP 사진을 10MB 이하로 선택해 주세요.'; return;
  }
  url = URL.createObjectURL(file); byId('ingredient-preview').src = url; byId('ingredient-preview').hidden = false;
  analyzePhoto();
});
async function analyzePhoto() {
  const file = fileInput.files[0]; if (!file || worker || searching) return;
  const current = ++version; analyze.disabled = true; results.replaceChildren(); detected.textContent = ''; detected.hidden = true; byId('ingredient-match-status').textContent = '';
  byId('ingredient-photo-status').textContent = '사진을 준비하고 있습니다…';
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1,768/Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.85));
    if (current !== version) return;
    if (!blob) throw new Error('image');
    worker = new Worker('/assets/js/ingredient-vision-worker.js?v=20261009-v2',{ type:'module' });
    worker.onmessage = ({ data }) => {
      if (current !== version) return;
      if (data.type === 'progress') byId('ingredient-photo-status').textContent = data.message;
      else {
        if (data.type === 'result') {
          stopAnalysis();
          detected.textContent = '사진에서 찾은 재료: ' + data.ingredients.join(', ');
          detected.hidden = !data.ingredients.length;
          byId('ingredient-photo-status').textContent = data.ingredients.length ? '사진 분석을 완료했습니다.' : '재료를 찾지 못했습니다. 식재료가 잘 보이는 다른 사진을 선택해 주세요.';
          if (data.ingredients.length) searchRecipes(data.ingredients, current);
        } else { byId('ingredient-photo-status').textContent = data.message; stopAnalysis(); }
      }
    };
    worker.onerror = () => { if (current !== version) return; byId('ingredient-photo-status').textContent = '사진 분석을 실행하지 못했습니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); };
    analysisTimeout = setTimeout(() => { if (current !== version) return; byId('ingredient-photo-status').textContent = '사진 분석에 시간이 오래 걸립니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); }, 240000);
    worker.postMessage({ blob });
  } catch { if (current === version) { byId('ingredient-photo-status').textContent = '사진을 읽지 못했습니다. 다른 사진을 선택하거나 다시 시도해 주세요.'; stopAnalysis(); } }
}
analyze.addEventListener('click', analyzePhoto);
async function searchRecipes(ingredients, current) {
  searching = true; analyze.disabled = true; results.replaceChildren();
  byId('ingredient-match-status').textContent = '등록된 레시피의 재료를 비교하고 있습니다…';
  const controller = new AbortController(); requestController = controller;
  const timeout = setTimeout(()=>controller.abort(),30000);
  try {
    const response = await fetch('/api/recipe-recommendations?' + new URLSearchParams({ ingredients:ingredients.join(', ') }),{ credentials:'same-origin',cache:'no-store',signal:controller.signal });
    const data = await response.json(); if (current !== version) return;
    if (!response.ok) throw new Error(data.message || '레시피를 불러오지 못했습니다.');
    for (const [index,recipe] of data.recommendations.entries()) {
      const card = document.createElement('details'); card.className = 'ingredient-result';
      const heading = document.createElement('summary'); heading.textContent = (index+1)+'. '+recipe.title+' · 재료 일치도 '+recipe.score+'%'; card.append(heading);
      for (const text of ['일치 재료: '+recipe.matched.join(', '), '부족한 재료: '+(recipe.missing.join(', ')||'없음'), recipe.estimated?'본문 키워드로 추정한 재료 기준입니다.':'등록된 재료 기준입니다.']) {
        const line = document.createElement('p'); line.textContent = text; card.append(line);
      }
      const body = document.createElement('p'); body.className = 'recipe-post-body'; body.textContent = recipe.body; card.append(body); results.append(card);
    }
    byId('ingredient-match-status').textContent = data.recommendations.length ? '재료 일치도 = 일치 재료 수 ÷ 레시피 재료 수. 추천 제목을 누르면 조리법을 볼 수 있습니다.' : '일치하는 레시피가 없습니다. 다른 식재료 사진으로 다시 검색해 주세요.';
  } catch(error) { if (current === version) byId('ingredient-match-status').textContent = error.name === 'AbortError' ? '검색 시간이 초과됐습니다. 다시 시도해 주세요.' : error.message; }
  finally { clearTimeout(timeout); if (current === version) { searching = false; analyze.disabled = !fileInput.files[0]; requestController = null; } }
}
byId('ingredient-clear').addEventListener('click',clear);
window.addEventListener('recipe-access-locked',clear);
window.addEventListener('pagehide',clear);
