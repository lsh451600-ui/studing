import { authorized, ensurePosts, reply } from '../../src/recipe-server.js';
import { normalizeIngredients, rankRecipes } from '../../assets/js/ingredient-matching.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, { message: '지원하지 않는 요청입니다.' });
  try {
    if (!await authorized(request, env)) return reply(403, { message: '특별회원 인증과 열람 비밀번호가 필요합니다.' });
    if (!env.MEMBERS_DB) return reply(503, { message: '레시피 저장소에 연결하지 못했습니다.' });
    const params = new URL(request.url).searchParams;
    const raw = params.get('ingredients') || '', category = params.get('category') || '';
    if (category && !['한식', '중식', '일식', '양식', '베이커리'].includes(category)) return reply(400, { message: '분류를 확인해 주세요.' });
    const ingredients = normalizeIngredients(raw);
    if (!raw || raw.length > 1000 || ingredients.length > 50 || ingredients.some(name => name.length > 40)) return reply(400, { message: '재료를 쉼표로 구분해 1~50개 입력해 주세요.' });
    if (!ingredients.length) return reply(400, { message: '재료를 입력해 주세요.' });
    const db = env.MEMBERS_DB; await ensurePosts(db);
    // Scan every recipe in bounded pages rather than just the visible board page.
    let cursor = 0, best = [];
    while (true) {
      const { results } = await db.prepare('SELECT id, title, body, category, ingredients FROM recipe_posts WHERE id > ? ORDER BY id ASC LIMIT 100').bind(cursor).all();
      if (!results.length) break;
      best = rankRecipes([...best, ...results.filter(post => !category || post.category === category)], ingredients); cursor = results.at(-1).id;
      if (results.length < 100) break;
    }
    return reply(200, { ingredients, recommendations: best.map(({ ratio, ...post }) => post) });
  } catch { return reply(503, { message: '추천 레시피를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
}
