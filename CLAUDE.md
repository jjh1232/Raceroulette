# prelaps.com 도메인 공통 규칙

이 파일은 **`prelaps.com` 에 속한 저장소**에 적용된다.

```
Main/prelaps-home     허브 · 다국어 랜딩        Astro → Cloudflare Pages
Main/prelaps-router   도메인 교통정리            Cloudflare Worker
breakkorean           깨진 글자 복구기 (mojibake) Worker + Static Assets
```

`imageviewer` 처럼 이 도메인 밖의 프로젝트에는 **적용되지 않는다.**

**헌법은 `Main/prelaps-home/docs/prelaps-architecture.md` 다.**
아래는 그중 **어겼을 때 실제로 조용히 망가진 적이 있는 것**만 추린 요약이다.
판단이 필요한 작업이면 헌법을 먼저 읽을 것. 둘이 어긋나면 헌법이 맞다.

여러 저장소를 함께 고칠 때는 이 폴더(`D:\SUBsite`)에서 작업할 것 —
세 저장소가 한 번에 보인다.

---

## 배포

- **push 는 배포가 아니다.** `prelaps-home` 은 GitHub 연동이 걸려 있는데도
  커밋 세 개가 자동 빌드를 만들지 못하고 프로덕션이 12시간 전에 멈춰 있던 적이 있다.
  ```
  prelaps-home    npm run build && npx wrangler pages deploy dist --project-name prelaps-home
  prelaps-router  npx wrangler deploy
  breakkorean     npm run check:links && npx wrangler deploy
  ```
- **무엇이 올라가 있는지는 status code 가 아니라 `deployments list` 로 확인한다.**
  `404.html` 이 없는 동안에는 없는 파일도 200 을 돌려주므로, 200 을 보고
  "배포됐다" 고 읽으면 틀린다. 실제로 이렇게 며칠을 헤맸다.
- **라이브를 진단하기 전에 무엇이 올라가 있는지부터 본다.** 낡은 배포를 찔러보고
  내린 결론으로 코드를 고쳤다가 `/ko` 를 리다이렉트 루프에 빠뜨린 적이 있다.
- **여러 개를 동시에 바꿀 때는 받는 쪽을 먼저 올린다.** 도구 → 라우터,
  라우터 → DNS 순. 거꾸로 하면 그 사이 갈 곳 없는 주소가 생긴다.

## 주소

- **모든 도구는 `prelaps.com/<도구>/` 하위 경로다.** 서브도메인을 쓰지 않는다 —
  애드센스가 도메인 단위 인증이고, SEO 신호가 한 곳에 쌓여야 뒤에 오는 도구가
  앞선 도구의 신뢰도를 물려받는다.
- **어느 프로젝트에도 커스텀 도메인을 붙이지 않는다.** 붙이면 같은 내용이
  `.pages.dev` 와 `prelaps.com` 두 주소로 열려 중복 콘텐츠가 된다.
  예외는 구 주소 301 용으로 남겨둔 `mojibake.prelaps.com` 하나뿐이다.
- **허브는 `trailingSlash: 'never'` 와 `build.format: 'file'` 이 세트다.**
  한쪽만 바꾸면 canonical 이 가리키는 주소가 리다이렉트되는 주소가 된다.
- **언어판은 `/<도구>/<언어>/` 아래에 두고, 도구 루트는 비워 통로로 쓴다.**
  루트에 한 언어를 놓으면 그 주소가 그 언어의 canonical 이 되어, 나중에 언어 분기를
  붙이려면 canonical 주소를 리다이렉트로 만들어야 한다 — 하면 안 되는 일이다.
  `mojibake` 가 한국어를 루트에 둔 상태라 지금 누가 오든 한국어다. 새 도구는 따라하지 말 것.
- **언어 없는 루트는 `Accept-Language` 로 302 한다.** 허브 `/` 는 라우터가 처리한다.
  `301` 이면 브라우저가 영구 캐시해 방문자가 언어를 되돌릴 수 없고,
  `Cache-Control: no-store` 가 없으면 Cloudflare 가 첫 방문자의 언어를 전원에게 준다
  (엣지는 `Accept-Encoding` 외의 `Vary` 를 무시한다). 폴백은 `x-default` 와 같은 영어.
  언어판 주소(`/ko` 등) 자체는 절대 건드리지 않는다 — 언어 전환 UI 가 죽는다.
- **도구의 내부 링크는 전부 상대 경로.** 절대 경로(`/styles.css`)는 도메인 루트
  기준으로 풀려 전부 깨진다. 도구는 루트에 있지 않다.

## Worker 에서 경로 접두사를 다룰 때

도구 Worker 는 URL 의 `/<도구>` 를 떼어 자산 루트에 맞춘다. 두 가지를 반드시 같이 한다.

- **자산 층 리다이렉트의 `Location` 에 접두사를 다시 붙인다.** 안 붙이면
  `/mojibake/index.html` 의 Location 이 `/` 로 나가 도구 밖으로 튕긴다.
  내부 링크가 `href="index.html"` 이라 홈 버튼 한 번에 터진다.
- **접두사로 시작하지 않는 경로는 손대지 않는다.** 앞 N글자를 무조건 자르면
  구 도메인 요청에서 `/styles.css` → `"ss"` 가 되어 404 가 나고,
  `/en/` 은 한국어 루트를 200 으로 돌려준다(404 보다 나쁘다).

## SEO

- **`canonical` · `hreflang` · `og:url` · `sitemap` 은 `https://prelaps.com/...` 절대 URL.**
  `.pages.dev` 나 `.workers.dev` 를 가리키면 안 된다.
- **`hreflang x-default` 는 영어다.** 언어를 특정하지 못한 방문자를 보낼 곳이라
  영어가 맞다. 루트(`/`)가 한국어로 가는 것과는 **다른 질문에 답하는 값**이다 —
  한 값으로 묶었다가 허브와 도구의 신호가 엇갈린 적이 있다.
- **모든 언어판이 hreflang 전체 목록을 동일하게 갖는다.** 하나라도 빠지면 구글이 무시한다.
- **`404.html` 은 모든 프로젝트에 필수.** 없으면 없는 주소가 전부 정상 페이지로
  색인되는 soft 404 가 되고, 화면상 아무 표시가 없어 눈으로는 못 잡는다.
- **`robots.txt` 는 허브의 것 하나만 유효하다.** 도메인 루트에서만 읽히므로
  `/mojibake/robots.txt` 는 아무도 안 본다. 새 도구의 사이트맵은 허브
  `public/robots.txt` 에 한 줄 추가한다.
- **검색엔진 재등록은 필요 없다.** 하위 경로는 전부 같은 사이트다.

## 정책 페이지

- **개인정보처리방침·이용약관·문의는 허브에 하나씩.** 도구별로 파일을 만들지 않는다.
  도구별 안내는 privacy 의 "서비스별 안내" 절에 블록으로 넣고,
  도구 푸터에서 `/{lang}/privacy#<도구>` 앵커로 링크한다.
- **도구 소개는 도구에 남긴다.** 정책이 아니라 콘텐츠다.
- 관리 지점이 갈리면 광고 정책이 바뀔 때 동기화를 빠뜨리게 되고,
  애드센스는 **도메인 단위 심사**라 한 곳의 누락이 전체에 영향을 준다.

## 새 도구를 추가할 때

헌법 §7 「도구 추가 체크리스트」를 그대로 따를 것. 대부분 복사이고
새로 판단할 일은 거의 없다. 배포 전 과정 요약은
`breakkorean/docs/배포.md` 가 실제 사례다.
