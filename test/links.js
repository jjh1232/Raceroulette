'use strict';
/*
 * 링크·hreflang·사이트맵 전수 검사.
 *
 * 왜 필요한가 — 이 도구는 페이지가 세 장이고 링크가 전부 상대 경로다.
 * 링크가 깨져도 화면에는 아무 표시가 없고, 더 나쁜 것은 「살아 있지만 다른 언어를
 * 가리키는」 링크다. 영어 페이지 푸터가 한국어 약관으로 가도 브라우저는 멀쩡히 연다.
 *
 * 사이트맵도 같이 본다. 2026-08-22 에 mojibake 에서 사이트맵의 </urlset> 이 사라진 적이
 * 있는데, 화면은 멀쩡했고 구글 서치콘솔이 「오류 1개 · 발견된 페이지 0」 으로 알려줄
 * 때까지 몰랐다. 배포 전에 잡을 수 있는 것은 배포 전에 잡는다.
 *
 * 쓰기:  npm run check:links     (배포 전에 반드시)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'race');
const ORIGIN = 'https://prelaps.com/race';
const LANGS = ['ko', 'en', 'ja'];
const XDEFAULT = 'en';

let fails = 0;
const bad = (file, msg) => { fails++; console.log('  ✗ ' + file + ' — ' + msg); };

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ── 언어판 ────────────────────────────────────────────────────
for (const lang of LANGS) {
  const rel = `${lang}/index.html`;
  if (!exists(rel)) { bad(rel, '언어판이 없다'); continue; }
  const src = read(rel);

  // 1. <html lang>
  if (!new RegExp(`<html lang="${lang}"`).test(src)) bad(rel, `<html lang="${lang}"> 이 아니다`);

  // 2. canonical 은 자기 자신. 다른 언어를 가리키면 그 언어가 색인에서 사라진다.
  const canon = (src.match(/rel="canonical" href="([^"]+)"/) || [])[1];
  if (canon !== `${ORIGIN}/${lang}/`) bad(rel, `canonical 이 자기 자신이 아니다 (${canon})`);

  // 3. hreflang 은 **전체 목록을 모든 언어판이 동일하게** 가져야 한다.
  //    하나라도 빠지면 구글이 hreflang 을 통째로 무시한다.
  const alts = [...src.matchAll(/rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
    .map((m) => [m[1], m[2]]);
  const want = [...LANGS.map((l) => [l, `${ORIGIN}/${l}/`]), ['x-default', `${ORIGIN}/${XDEFAULT}/`]];
  for (const [h, href] of want) {
    const got = alts.find((a) => a[0] === h);
    if (!got) bad(rel, `hreflang="${h}" 이 없다`);
    else if (got[1] !== href) bad(rel, `hreflang="${h}" 이 ${got[1]} 를 가리킨다 (${href} 여야 한다)`);
  }
  if (alts.length !== want.length) bad(rel, `hreflang 이 ${alts.length}개다 (${want.length}개여야 한다)`);

  // 4. og:url 도 자기 자신. og:image 는 절대 URL 이어야 카톡·슬랙이 읽는다.
  const og = (src.match(/property="og:url" content="([^"]+)"/) || [])[1];
  if (og !== `${ORIGIN}/${lang}/`) bad(rel, `og:url 이 자기 자신이 아니다 (${og})`);
  const img = (src.match(/property="og:image" content="([^"]+)"/) || [])[1];
  if (!img) bad(rel, 'og:image 가 없다 — 공유해도 썸네일이 안 뜬다');
  else if (!img.startsWith('https://')) bad(rel, `og:image 가 절대 URL 이 아니다 (${img})`);
  else if (!exists(img.replace(ORIGIN + '/', ''))) bad(rel, `og:image 파일이 없다 (${img})`);

  // 5. 제목·설명은 언어마다 달라야 한다. 같으면 중복 페이지로 판정된다.
  for (const [what, re] of [['title', /<title>(.*?)<\/title>/s],
                            ['description', /name="description" content="([^"]*)"/]]) {
    const v = (src.match(re) || [])[1];
    if (!v || !v.trim()) bad(rel, `${what} 가 비어 있다`);
  }

  // 6. 자산은 전부 상대 경로여야 한다. 절대 경로(/styles.css)는 도메인 루트 기준으로
  //    풀려서 전부 깨진다 — 이 도구는 루트에 있지 않다.
  for (const m of src.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
    const href = m[1];
    if (/^\/(ko|en|ja)(\/|$)/.test(href)) continue;      // 허브로 나가는 링크는 절대 경로가 맞다
    bad(rel, `자산을 절대 경로로 부른다 ${href}`);
  }

  // 7. 상대 경로 링크가 실제로 있는 파일인지
  for (const m of src.matchAll(/(?:href|src)="(\.\.?\/[^"#?]*)"/g)) {
    const p = path.posix.normalize(path.posix.join(lang, m[1]));
    const file = p.endsWith('/') ? p + 'index.html' : p;
    if (!exists(file)) bad(rel, `깨진 링크 ${m[1]}`);
  }

  // 8. 언어 전환 UI 는 세 언어를 모두 갖고, 자기 자신을 현재로 표시해야 한다.
  const sw = (src.match(/<nav class="langs">[\s\S]*?<\/nav>/) || [])[0] || '';
  for (const l of LANGS) {
    if (!sw.includes(`href="../${l}/"`)) bad(rel, `언어 전환에 ${l} 이 없다`);
  }
  if (!new RegExp(`href="\\.\\./${lang}/" aria-current="true"`).test(sw)) {
    bad(rel, '언어 전환이 자기 자신을 현재로 표시하지 않는다');
  }

  // 9. 푸터의 정책 링크는 **자기 언어의 허브**를 가리켜야 한다 (헌법 §8).
  //    도구별 정책 파일을 만들지 않는 것이 규칙이므로, 도구 안을 가리키면 안 된다.
  const foot = (src.match(/<footer>[\s\S]*?<\/footer>/) || [])[0] || '';
  for (const [name, href] of [['privacy', `/${lang}/privacy#race`],
                              ['terms', `/${lang}/terms`],
                              ['contact', `/${lang}/contact`]]) {
    if (!foot.includes(`href="${href}"`)) bad(rel, `푸터의 ${name} 가 ${href} 를 안 가리킨다 (언어 섞임?)`);
  }
}

// ── 사이트맵 ──────────────────────────────────────────────────
{
  const rel = 'sitemap.xml';
  if (!exists(rel)) {
    bad(rel, '사이트맵이 없다 — 허브 robots.txt 가 이 파일을 가리킨다');
  } else {
    const src = read(rel);
    if (!/<urlset[\s>]/.test(src)) bad(rel, '<urlset> 이 없다');
    if (!/<\/urlset>/.test(src)) bad(rel, '</urlset> 이 닫히지 않았다 — 구글이 통째로 못 읽는다');
    const opens = (src.match(/<url>/g) || []).length;
    const closes = (src.match(/<\/url>/g) || []).length;
    if (opens !== closes) bad(rel, `<url> ${opens}개 / </url> ${closes}개 — 짝이 안 맞는다`);

    const locs = [...src.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const lang of LANGS) {
      if (!locs.includes(`${ORIGIN}/${lang}/`)) bad(rel, `${lang} 언어판이 사이트맵에 없다`);
    }
    // 루트(/race/)는 Accept-Language 로 302 하는 통로다. canonical 도 없고
    // hreflang 도 안 가리키므로 색인 대상이 아니다 (헌법 §5).
    if (locs.includes(`${ORIGIN}/`)) bad(rel, '루트(/race/)가 사이트맵에 있다 — 통로는 빼야 한다');
    for (const loc of locs) {
      const p = loc.replace(ORIGIN + '/', '');
      const file = p.endsWith('/') || p === '' ? p + 'index.html' : p;
      if (!exists(file)) bad(rel, `없는 페이지를 가리킨다 ${loc}`);
    }
  }
}

// ── 404 ───────────────────────────────────────────────────────
// 없으면 없는 주소가 정상 페이지로 색인되는 soft 404 가 된다.
// 화면상 아무 표시가 없어서 눈으로는 절대 못 잡는다.
{
  const rel = '404.html';
  if (!exists(rel)) {
    bad(rel, '404 페이지가 없다 — wrangler 의 not_found_handling 이 이 파일을 쓴다');
  } else {
    const src = read(rel);
    if (!/name="robots"[^>]*noindex/.test(src)) bad(rel, 'noindex 가 없다');
    if (/rel="canonical"/.test(src)) bad(rel, 'canonical 이 있다 — 없는 주소를 자기 자신이라고 선언하는 셈이다');
  }
}

// ── 결과 ──────────────────────────────────────────────────────
console.log('');
console.log(`페이지 ${LANGS.length}장 검사`);
console.log('');
if (fails) {
  console.log(`실패 ${fails}건`);
  process.exit(1);
}
console.log('링크 검사 통과 — 0건');
