/**
 * prelaps.com/race/* 를 race/ 에 잇는 얇은 층 + 루트의 언어 분기.
 *
 * Workers Assets 에는 "이 경로 아래에 자산을 붙인다" 는 설정이 없다.
 * 자산의 파일 경로가 곧 URL 경로라서, 그냥 두면
 * prelaps.com/race/styles.css 가 race/race/styles.css 를 찾는다.
 * 그래서 접두사를 여기서 떼어낸다. (breakkorean/src/index.js 와 같은 구조)
 *
 * 변환도 번들링도 없다 — 이 파일이 생겼다고 빌드 단계가 생긴 것은 아니다.
 */

/** 정식 호스트. */
const CANONICAL_HOST = 'prelaps.com';

/** prelaps.com 에서 이 도구가 사는 자리. */
const PREFIX = '/race';

/** 실제로 있는 언어판. 순서가 곧 우선순위다. */
const LANGS = ['ko', 'en', 'ja'];

/**
 * 언어를 특정하지 못했을 때 보낼 곳.
 * **`x-default` 와 같은 값이어야 한다** — 한국어가 주 방문자층인 것과는 다른 질문이다.
 * 둘을 한 값으로 묶었다가 허브와 도구의 신호가 엇갈린 적이 있다 (헌법 §5).
 */
const FALLBACK = 'en';

/** Accept-Language 헤더에서 우리가 가진 언어를 고른다. q 값 순서대로 본다. */
function pickLang(header) {
  if (!header) return FALLBACK;
  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q.split('=')[1]) : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of wanted) {
    const base = tag.split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return FALLBACK;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 접두사가 없는 요청은 손대지 않는다.
    // 라우트가 prelaps.com/race/* 라서 원래 여기 올 수 없지만, 라우트 설정이 바뀌었을 때
    // 조용히 경로를 망가뜨리지 않도록 막아둔다. 앞 N글자를 무조건 자르면
    // /styles.css 가 "es.css" 가 되어 404 가 난다.
    if (url.hostname !== CANONICAL_HOST || !url.pathname.startsWith(PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    // /race/en/ -> /en/   자산은 race/ 루트 기준이다.
    const path = url.pathname.slice(PREFIX.length) || '/';

    // ── 루트는 언어판으로 넘긴다 ────────────────────────────
    //
    // 301 이 아니라 **302** 다. 301 이면 브라우저가 영구 캐시해서 방문자가 언어를
    // 되돌릴 수 없다. 그리고 `Cache-Control: no-store` 가 없으면 Cloudflare 가
    // 첫 방문자의 언어를 뒤따라오는 전원에게 준다 — 엣지는 `Accept-Encoding` 외의
    // `Vary` 를 무시하기 때문이다. (헌법 §5)
    //
    // /race/ko/ 같은 언어판 주소 자체는 절대 건드리지 않는다. 건드리면 언어 전환 UI 가 죽는다.
    if (path === '/' || path === '') {
      const lang = pickLang(request.headers.get('accept-language'));
      return new Response(null, {
        status: 302,
        headers: {
          location: `${PREFIX}/${lang}/`,
          'cache-control': 'no-store',
          vary: 'Accept-Language',
        },
      });
    }

    url.pathname = path;
    const response = await env.ASSETS.fetch(new Request(url, request));

    // 자산 층이 돌려주는 리다이렉트의 Location 은 race/ 루트 기준이라 접두사가 빠져 있다.
    // 그대로 흘려보내면 도구 밖으로 튕긴다 — /race/ko/index.html 의 Location 이
    // /ko/ 로 나가서 허브의 한국어 페이지로 가버린다.
    const location = response.headers.get('location');
    if (!location) return response;

    const to = new URL(location, url);
    const headers = new Headers(response.headers);
    headers.set('location', PREFIX + to.pathname + to.search + to.hash);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
