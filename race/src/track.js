// 트랙 — 실제 육상 경기장처럼 직선 두 개와 반원 두 개로 된 오벌.
//
//   좌표는 XZ 평면. 앞 직선이 z = −r, 뒤 직선이 z = +r, 양 끝이 반지름 r 인 반원.
//   결승선은 앞 직선 한가운데(원점 근처), 거기서 +X 방향으로 달려나간다.
//
// 바깥 레인일수록 한 바퀴가 길다. 이걸 다루는 방법이 둘 있다.
//
//   출발선 어긋내기 — 실제 육상 방식. 모두 같은 거리를 달린다.
//                     대신 출발 그림이 흩어지고, 결승선 직전까지 바깥 레인이
//                     늘 물리적으로 앞서 있어서 누가 앞선 건지 눈으로 못 읽는다.
//   진행률로 재기   — 자기 레인의 몇 %를 왔는지로 순위를 매긴다.
//                     여덟 명이 한 줄로 출발하고, 같은 진행률이면 항상 같은 선 위에 있다.
//                     대신 바깥 레인이 물리적으로 더 빨리 움직인다.
//
// 뽑기 도구에서는 「누가 앞선 건지 한눈에 보이는 것」이 훨씬 중요해서 뒤쪽을 택했다.
// 속도 차이는 반지름 대비 레인 폭이 정한다. 폭을 좁히고 직선을 늘려 20% 안쪽으로 눌렀다.
const TAU = Math.PI * 2;

export const STRAIGHT = 2400;    // 직선 한 구간의 길이
export const LANE_R0 = 1300;     // 가장 안쪽 레인의 곡선 반지름
export const LANE_GAP = 85;      // 캐릭터 몸통 너비의 1.5 배쯤. 좁으면 붙어 보인다
// 레인 수는 참가 인원에 따라 바뀐다. ES 모듈은 바인딩이 살아 있어서
// `import { LANES }` 로 가져간 쪽도 바꾼 값을 그대로 본다.
//
// 상한이 12 인 이유는 바깥 레인이 안쪽보다 빨리 움직이는 정도(속도차) 때문이다.
// 8레인이 29%, 12레인이 45%, 16레인이면 62% 라 바깥 사람이 눈에 띄게 질주해 보인다.
// 더 늘리려면 트랙을 키워야 하는데(16레인을 29% 로 유지하려면 한 바퀴가 2.14배),
// 그러면 같은 시간에 두 배를 달려야 해서 모션을 다시 잡아야 한다.
export const MAX_LANES = 12;
export let LANES = 8;

export function setLanes(n) {
  LANES = Math.max(2, Math.min(MAX_LANES, Math.round(n)));
  return LANES;
}

export const laneRadius = i => LANE_R0 + i * LANE_GAP;
export const perimeter = r => 2 * STRAIGHT + TAU * r;

// 모두가 달리는 거리 = 가장 안쪽 레인의 한 바퀴.
export const LAP = perimeter(LANE_R0);

// 레인 r 의 경로 위에서 결승선으로부터 arc 만큼 간 지점.
// heading 은 그 지점에서의 진행 방향(라디안). three.js 의 rotation.y 에 바로 넣을 수 있다.
export function pointAt(r, arc) {
  const P = perimeter(r);
  let s = arc % P; if (s < 0) s += P;

  const half = STRAIGHT / 2, curve = Math.PI * r;
  const s1 = half, s2 = s1 + curve, s3 = s2 + STRAIGHT, s4 = s3 + curve;

  let x, z, dx, dz;
  if (s < s1) {                       // 결승선 → 앞 직선 끝
    x = s; z = -r; dx = 1; dz = 0;
  } else if (s < s2) {                // 오른쪽 반원
    const a = -Math.PI / 2 + (s - s1) / r;
    x = half + r * Math.cos(a); z = r * Math.sin(a);
    dx = -Math.sin(a); dz = Math.cos(a);
  } else if (s < s3) {                // 뒤 직선 (반대 방향)
    x = half - (s - s2); z = r; dx = -1; dz = 0;
  } else if (s < s4) {                // 왼쪽 반원
    const a = Math.PI / 2 + (s - s3) / r;
    x = -half + r * Math.cos(a); z = r * Math.sin(a);
    dx = -Math.sin(a); dz = Math.cos(a);
  } else {                            // 앞 직선 앞부분 → 결승선
    x = -half + (s - s4); z = -r; dx = 1; dz = 0;
  }
  // 캐릭터는 +X 를 보고 서 있다. 진행 방향(dx,dz)을 향하게 하는 Y축 회전값.
  return { x, z, heading: Math.atan2(-dz, dx) };
}

// 진행률 f(0~1)를 레인 i 의 경로 위 위치로.
//
// **길이 비율로 나누면 안 된다.** 직선은 어느 레인이나 4800 으로 같은데 곡선만 길어서,
// 한 바퀴 중 직선이 차지하는 비율이 레인마다 다르다 (레인 0 은 37.0%, 레인 7 은 28.7%).
// 그래서 `f * perimeter(r)` 로 재면 같은 진행률인데도 직선 위에서 바깥 레인이 앞서 있다.
// 실제로 재보니 **이웃한 등수의 16.7% 가 눈으로는 뒤집혀 보였고**, 심하면 캐릭터 키의
// 3.1 배까지 어긋났다. 「앞선 사람이 앞에 보인다」가 이 트랙을 이렇게 만든 이유인데
// 그게 안 되고 있었던 것이다.
//
// 그래서 **구간별로 나눈다.** 오벌을 직선·곡선 네 도막으로 쪼개고, 각 도막이 차지하는
// 진행률 범위를 모든 레인이 똑같이 쓴다. 도막 안에서는 기하 변수(직선은 x, 곡선은 각도)에
// 선형으로 맞춘다. 그러면 같은 진행률일 때 직선에서는 x 가 같고 곡선에서는 각도가 같다 —
// 즉 언제나 트랙을 가로지르는 한 줄 위에 선다.
//
// 경계값은 가장 안쪽 레인의 길이 비율로 잡았다. 그래서 레인 0 의 움직임은 예전과 똑같다.
// 대신 바깥 레인은 곡선에서 더 빨리 움직인다 — 실제 오벌 경기가 그렇다.
const HALF = STRAIGHT / 2;
const P0 = perimeter(LANE_R0);
const CURVE0 = Math.PI * LANE_R0;
const F1 = HALF / P0;
const F2 = (HALF + CURVE0) / P0;
const F3 = (HALF + CURVE0 + STRAIGHT) / P0;
const F4 = (HALF + 2 * CURVE0 + STRAIGHT) / P0;

// 「바깥 레인이 유리해 보인다」에 대해 — 레인은 승부에 아무 영향도 주지 않는다.
// 승자는 가중치 추첨으로 이미 정해지고 레이스는 그 결과를 보여줄 뿐이다 (race.js 참고).
// 가중치를 전부 같게 두고 8만 판을 돌려도 레인별 우승률이 12.4~12.6% 로 고르다.
//
// 실제로 육상식 「출발선 어긋내기」(모두 같은 거리를 달리게 하는 것)를 만들어 봤다가 지웠다.
// 승부가 이미 공정한데 물리적 거리를 맞춰 봐야 얻는 게 없고, 잃는 건 컸다 —
// 화면에 담기는 주자가 92% → 81% (3바퀴면 57%)로 줄고 출발이 트랙 전체에 흩어졌다.
//
// 그래도 그렇게 「보이는」 건 사실인데, 원인은 속도가 아니라 크기다. 바깥 레인이 카메라에
// 가까워서 「옆에서」 시점에 8명 기준 화면에 +57% 크게 보인다 (12명이면 +105%).
// 카메라를 높이면 준다 (pitch 45°에서 +34%, 62°에서 +20%).

// f 는 「진행률 × 바퀴 수」다 (0 ~ 바퀴 수).
export function place(i, f) {
  const r = laneRadius(i);
  let u = f % 1; if (u < 0) u += 1;
  let x, z, dx, dz;
  if (u < F1) {                          // 결승선 → 앞 직선 끝
    x = (u / F1) * HALF; z = -r; dx = 1; dz = 0;
  } else if (u < F2) {                   // 오른쪽 반원
    const a = -Math.PI / 2 + ((u - F1) / (F2 - F1)) * Math.PI;
    x = HALF + r * Math.cos(a); z = r * Math.sin(a);
    dx = -Math.sin(a); dz = Math.cos(a);
  } else if (u < F3) {                   // 뒤 직선 (반대 방향)
    x = HALF - ((u - F2) / (F3 - F2)) * STRAIGHT; z = r; dx = -1; dz = 0;
  } else if (u < F4) {                   // 왼쪽 반원
    const a = Math.PI / 2 + ((u - F3) / (F4 - F3)) * Math.PI;
    x = -HALF + r * Math.cos(a); z = r * Math.sin(a);
    dx = -Math.sin(a); dz = Math.cos(a);
  } else {                               // 앞 직선 앞부분 → 결승선
    x = -HALF + ((u - F4) / (1 - F4)) * HALF; z = -r; dx = 1; dz = 0;
  }
  return { x, z, heading: Math.atan2(-dz, dx) };
}

// 레인 i 가 실제로 달리는 거리. 발 속도를 맞출 때 쓴다.
export const laneLength = i => perimeter(laneRadius(i));

// 바깥 레인이 안쪽보다 몇 배 빨리 움직이는가. 클수록 어색해진다.
export const speedSpread = () => laneLength(LANES - 1) / laneLength(0);

// 경로를 일정 간격으로 찍어 선으로 그릴 때 쓴다.
export function samplePath(r, step = 40) {
  const P = perimeter(r), n = Math.max(24, Math.round(P / step));
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(pointAt(r, (k / n) * P));
  return pts;
}
