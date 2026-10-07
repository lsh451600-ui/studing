import { currentSession, settings } from '../src/member-auth.js';

const protectedPages = new Set([
  '/recipes', '/recipes.html',
  '/board', '/board.html',
  '/startup', '/startup.html',
  '/private', '/private.html',
]);

function withCookies(response, cookies = []) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private');
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (!protectedPages.has(pathname)) return next();
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('지원하지 않는 요청입니다.', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (!settings(env).ready) {
    return new Response('로그인 서비스를 준비 중입니다. 잠시 후 다시 시도해 주세요.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const session = await currentSession(request, env);
    if (!session.user) {
      const login = new URL('/', url.origin);
      login.searchParams.set('login_required', '1');
      login.searchParams.set('next', url.pathname + url.search);
      return withCookies(Response.redirect(login.href, 302), session.cookies);
    }
    return withCookies(await next(), session.cookies);
  } catch {
    return new Response('로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
