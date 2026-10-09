// Canonical Korean names, English visual labels, and spelling aliases.
export const INGREDIENTS = [
 ['달걀','eggs',['계란']],['두부','tofu',[]],['대파','green onions',['쪽파','실파']],['양파','onions',[]],['마늘','garlic',[]],['감자','potatoes',[]],['고구마','sweet potatoes',[]],['당근','carrots',[]],['토마토','tomatoes',['방울토마토']],['오이','cucumbers',[]],['애호박','zucchini',['주키니']],['가지','eggplants',[]],['배추','napa cabbage',[]],['양배추','cabbage',[]],['상추','lettuce',[]],['깻잎','perilla leaves',[]],['시금치','spinach',[]],['브로콜리','broccoli',[]],['파프리카','bell peppers',['피망']],['고추','chili peppers',['청양고추','홍고추','풋고추']],['무','white radish',[]],['콩나물','soybean sprouts',[]],['숙주','mung bean sprouts',['숙주나물']],['버섯','mushrooms',['표고버섯','팽이버섯','새송이버섯','양송이']],['옥수수','corn',[]],['완두콩','peas',[]],['아보카도','avocados',[]],['레몬','lemons',[]],['사과','apples',[]],['바나나','bananas',[]],['딸기','strawberries',[]],['닭고기','chicken meat',['닭가슴살','닭다리','닭안심']],['돼지고기','pork meat',['삼겹살','목살','돼지앞다리']],['소고기','beef meat',['쇠고기','우삼겹','차돌박이']],['베이컨','bacon',[]],['햄','ham',[]],['소시지','sausages',['소세지']],['연어','salmon',[]],['고등어','mackerel',[]],['참치','tuna',[]],['새우','shrimp',[]],['오징어','squid',[]],['조개','clams',['바지락']],['홍합','mussels',[]],['게','crab',['꽃게']],['김치','kimchi',[]],['김','dried seaweed',[]],['미역','wakame seaweed',[]],['쌀','rice grains',[]],['밥','cooked rice',['공깃밥','찬밥']],['떡','rice cakes',['떡볶이떡','떡국떡']],['파스타면','pasta noodles',['스파게티면']],['우동면','udon noodles',[]],['소면','thin wheat noodles',[]],['빵','bread',['식빵','바게트']],['치즈','cheese',[]],['우유','milk',[]],['버터','butter',[]],['밀가루','wheat flour',[]],['부침가루','Korean pancake flour',[]],['전분','starch',['감자전분','옥수수전분']],['간장','soy sauce',[]],['고추장','gochujang paste',[]],['된장','soybean paste',[]],['고춧가루','chili powder',[]],['설탕','sugar',[]],['소금','salt',[]],['후추','black pepper',[]],['식용유','cooking oil',['올리브유','카놀라유']],['참기름','sesame oil',[]],['식초','vinegar',[]],['깨','sesame seeds',['참깨','통깨']],['맛술','cooking wine',['미림']],['마요네즈','mayonnaise',[]],['케첩','ketchup',['케찹']]
];
const compact = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const aliases = INGREDIENTS.flatMap(([name, , variants]) => [name, ...variants].map(alias => [compact(alias), name])).sort((a,b) => b[0].length-a[0].length);
export function normalizeIngredients(values) {
  const list = typeof values === 'string' ? values.split(/[,，、;\n]+/) : values;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean).map(v => aliases.find(([alias]) => alias === compact(v))?.[1] || v))];
}
export function extractIngredients(text) {
  // Prefer a labelled ingredient section. Do not invent amounts or optional substitutions.
  const section = text.match(/(?:^|\n)\s*(?:\[|【|#|\*|재료\s*[:：])*(?:주재료|준비\s*재료|재료|ingredients)\s*[\]】:*：]*\s*([\s\S]*?)(?=\n\s*(?:조리|만드는|만들기|요리\s*순서|조리\s*순서|방법|과정|steps)|$)/i);
  if (section) {
    // Preserve unlisted ingredients too: otherwise they disappear from both
    // the missing list and the coverage denominator.
    const items = section[1].split(/[,，、;\n·]+/).map(item => item
      .replace(/^\s*[-*•]\s*/, '').replace(/\([^)]*\)/g, '')
      .replace(/\s*[:：]?\s*(?:\d[\d./\s~–-]*|[½¼¾]|반\s*(?=모|개|컵|큰술|작은술)|약간|조금|적당량|취향껏).*$/, '')
      .replace(/\s*[:：]\s*$/, '').trim()).filter(Boolean);
    if (items.length) return normalizeIngredients(items);
  }
  let source = compact(section ? section[1] : text);
  const found = [];
  for (const [alias, name] of aliases) {
    if (alias.length === 1) {
      const words = (section ? section[1] : text).split(/[\s,，、:：()\[\]·]+/);
      if (words.some(word => new RegExp('^'+alias+'(?:$|[0-9]|약간|조금|적당량)').test(word))) found.push(name);
    } else if (source.includes(alias)) {
      found.push(name); source = source.split(alias).join(' ');
    }
  }
  return normalizeIngredients(found);
}
export function recipeIngredients(post) {
  let saved = post.ingredients;
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch { saved = []; } }
  const explicit = normalizeIngredients(saved);
  return { ingredients: explicit.length ? explicit : extractIngredients(post.body || ''), estimated: typeof post.estimated === 'boolean' ? post.estimated : !explicit.length };
}
export function rankRecipes(posts, available) {
  const pantry = new Set(normalizeIngredients(available));
  return posts.map(post => {
    const { ingredients, estimated } = recipeIngredients(post);
    const matched = ingredients.filter(name => pantry.has(name)), missing = ingredients.filter(name => !pantry.has(name));
    const ratio = ingredients.length ? matched.length / ingredients.length : 0;
    return { ...post, ingredients, estimated, matched, missing, ratio, score: missing.length ? Math.min(99, Math.round(100 * ratio)) : Math.round(100 * ratio) };
  }).filter(post => post.matched.length > 0).sort((a,b) => b.ratio-a.ratio || b.matched.length-a.matched.length || a.missing.length-b.missing.length || Number(b.id)-Number(a.id)).slice(0,3);
}
