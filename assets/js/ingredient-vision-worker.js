import { INGREDIENTS } from './ingredient-matching.js';
let classifier;
self.onmessage = async ({ data }) => {
  try {
    const { pipeline, env, RawImage } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    const progress = update => { if (update.status === 'progress') self.postMessage({ type: 'progress', message: '무료 분석 모델 내려받는 중… ' + Math.round(update.progress || 0) + '%' }); };
    if (!classifier) {
      self.postMessage({ type: 'progress', message: '무료 분석 모델을 준비하고 있습니다. 처음에는 다운로드에 시간이 걸립니다.' });
      classifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { device: 'wasm', dtype: 'q8', progress_callback: progress });
    }
    const image = await RawImage.fromBlob(data.blob);
    const foods = INGREDIENTS.filter(([, english]) => !['soy sauce','gochujang paste','soybean paste','chili powder','sugar','salt','black pepper','cooking oil','sesame oil','vinegar','cooking wine','mayonnaise','ketchup'].includes(english));
    const labels = foods.map(([, english]) => english);
    labels.push('a cooked meal', 'a non-food object');
    const regions = [image];
    if (image.width >= 224 && image.height >= 224) {
      const w = image.width, h = image.height;
      for (const [x,y] of [[0,0],[.4,0],[0,.4],[.4,.4]]) regions.push(await image.crop([Math.floor(x*w),Math.floor(y*h),Math.min(w-1,Math.floor((x+.6)*w)),Math.min(h-1,Math.floor((y+.6)*h))]));
    }
    const scores = new Map();
    for (let i = 0; i < regions.length; i++) {
      self.postMessage({ type: 'progress', message: '사진 속 재료를 찾고 있습니다… ' + (i+1) + '/' + regions.length });
      const result = await classifier(regions[i], labels, { hypothesis_template: 'A photo of {}.' });
      const top = result[0]?.score || 0;
      if (result[0]?.label === 'a non-food object' || result[0]?.label === 'a cooked meal' || top < .15) continue;
      for (const item of result.slice(0,3)) {
        if (item.score < .12 || item.score < top*.4) continue;
        const ingredient = foods.find(([,english]) => english === item.label)?.[0];
        if (ingredient) scores.set(ingredient, Math.max(scores.get(ingredient)||0, item.score));
      }
    }
    self.postMessage({ type: 'result', ingredients: [...scores].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name])=>name) });
  } catch { self.postMessage({ type: 'error', message: '이 기기에서 사진 분석을 완료하지 못했습니다. 다른 사진이나 다른 브라우저에서 다시 시도해 주세요.' }); }
};
