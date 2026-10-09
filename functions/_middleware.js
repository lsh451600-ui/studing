import { currentSession, settings } from '../src/member-auth.js';

const canonicalHost = 'dining.win';
const legacyHosts = new Set(['studing.pages.dev', 'www.dining.win']);
const publicPages = new Set([
  '/', '/about', '/guides', '/editorial', '/privacy', '/terms',
  '/sitemap.xml', '/feed.xml', '/robots.txt',
]);
function isPublicPage(path) {
  return publicPages.has(path) || path.startsWith('/guides/');
}
const publicAliases = new Map([
  ['/index.html', '/'], ['/about.html', '/about'], ['/guides.html', '/guides'],
  ['/editorial.html', '/editorial'], ['/privacy.html', '/privacy'], ['/terms.html', '/terms'],
]);
function canonicalPublicPath(path) {
  const cleanPath = path.replace(/\/+$/, '') || '/';
  return publicAliases.get(cleanPath) || cleanPath;
}

const protectedPages = new Set([
  '/recipes', '/recipes.html',
  '/board', '/board.html',
  '/startup', '/startup.html',
  '/mypage', '/mypage.html',
]);

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withCookies(response, cookies = []) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
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
  const canonicalPath = canonicalPublicPath(pathname);
  const legacyHost = legacyHosts.has(url.hostname);
  const duplicatePublicPath = isPublicPage(pathname) && pathname !== canonicalPath;
  if ((legacyHost && isPublicPage(pathname)) || (!legacyHost && duplicatePublicPath)) {
    // Keep the root OAuth fallback on its original host so its HttpOnly PKCE
    // verifier stays available to the callback. API routes are never redirected.
    const rootAuthFlow = (pathname === '/' || pathname === '/index.html') && [
      'code', 'error', 'error_code', 'error_description', 'flow',
      'access_token', 'refresh_token', 'token_hash', 'type',
    ].some(key => url.searchParams.has(key));
    if (!rootAuthFlow) {
      url.hostname = canonicalHost;
      url.pathname = canonicalPath;
      return withSecurityHeaders(Response.redirect(url.href, 301));
    }
  }
  if (!protectedPages.has(pathname)) return withSecurityHeaders(await next());
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
