// 레이스 규칙. 화면과 아무 관계가 없으므로 따로 둔다 —
// 확률이 맞는지는 브라우저 없이 수천 번 돌려서 확인해야 하기 때문이다.
//
// ── 왜 이렇게 뒤집었나 (2026-08-21) ─────────────────────────────
// 예전에는 「부스터를 굴려서 먼저 들어온 사람이 승자」였다. 뽑기 도구로는 틀린 구조다.
// 부스터가 곱연산이라 개수가 복리로 불어나 가중치 3 인 사람이 세 배가 아니라
// 여덟 배 이겼고(4000회 실측 67.4% vs 기대 25.0%), 게다가 발동 확률식
// `boostChance * rerollEvery * urgency` 가 0.012×700×0.3 = 2.52 로 **1을 넘어서**
// 부스터를 가진 사람은 리롤마다 무조건 켰다. 숫자를 손보는 걸로는 못 고친다.
//
// 그래서 순서를 뒤집었다. **결과를 먼저 뽑고, 그 결과가 나오도록 달리기를 연출한다.**
//   1. 가중치대로 순위 전체를 추첨한다 (Plackett–Luce). 1등 확률이 정확히 w/Σw 가 된다.
//   2. 등수대로 도착 시각을 준다. 간격은 0.2~0.6초라 육안으로는 접전이다.
//   3. 각자 제멋대로 흔들리는 속도 곡선을 만들고, **자기 도착 시각에 딱 1이 되도록**
//      나눠서 정규화한다. 곡선이 단조 증가라 중간에는 순위가 뒤집히고 역전이 나지만
//      끝에는 반드시 추첨 결과대로 들어온다.
//
// 부스터는 이제 확률이 아니라 연출이다. 가중치가 높으면 부스터를 더 많이 쓰는 그림은
// 그대로 남지만, 그게 승부를 바꾸지는 않는다. 정규화가 흡수한다.
//
// 속도 곡선을 사인파의 합으로 잡은 덕에 적분이 닫힌 형태로 나온다. 그래서 진행률이
// **프레임 시간과 무관하게** 결정된다 — 예전 수치적분은 4배속으로 돌리면 결과가 달라졌다.

export const TUNE = {
  // 1등이 결승선을 끊기까지. 모션(보폭·걸음 수)이 여기에 물려 있으니 바꾸면 같이 봐야 한다.
  // README 가 적어둔 값이 24.5 다. 예전 코드는 부스터가 확률 1 을 넘겨 늘 켜지는 바람에
  // 문서와 달리 실제로는 18초에 끝나고 있었다 — 화면에서 본 속도는 그쪽이다.
  seconds: 24.5,
  gap: [0.18, 0.60],    // 등수 사이 도착 간격(초). 좁을수록 접전으로 보인다
  wobble: 0.36,         // 속도가 흔들리는 폭. 0.85 를 넘으면 뒷걸음질친다
  hz: [0.10, 0.34],     // 흔들림 주기(Hz). 느려야 「치고 나간다」로 읽힌다
  boostS: 1.5,          // 부스터 한 번의 길이(초)
  boostE: 0.85,         // 부스터가 얹는 속도
  dipS: 1.2,            // 발을 헛디디는 시간(초)
  dipE: 0.75,           // 그때 깎이는 속도. 실제로는 아래에서 여유만큼만 깎는다
  boostMax: 6,          // 화면에 보여줄 부스터 개수 상한 (확률과는 무관)
};

export const TRACK = 1000;   // 가상 단위. 화면 길이와는 별개다. 몇 바퀴든 이 값이 「완주」다

// 몇 바퀴를 도나. 위치 계산은 진행률을 나머지 연산으로 감으므로(track.js 의 place)
// 여기서는 판 길이만 늘리면 된다.
//
// 상한이 5 인 이유: 위치가 나머지로 정해지므로 선두와 꼴찌의 진행률 차이가 한 바퀴를
// 넘으면 뒤진 사람이 앞선 사람과 같은 자리에 겹쳐 보인다. 실측으로 그 차이가 최대
// 0.157 이라 5바퀴면 0.79 — 아직 여유가 있지만 6바퀴면 0.94 로 아슬아슬하다.
export const MAX_LAPS = 5;
export let LAPS = 1;
export function setLaps(n) {
  LAPS = Math.max(1, Math.min(MAX_LAPS, Math.round(n)));
  return LAPS;
}

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// 가중치대로 순위 전체를 뽑는다. 남은 후보에서 가중 추첨을 반복하는 방식이라
// 1등 확률이 정확히 w/Σw 이고, 2등·3등도 같은 논리로 이어진다.
function drawOrder(cands, rng) {
  const pool = cands.map((c, i) => ({ i, w: Math.max(0.0001, c.w) }));
  const out = [];
  while (pool.length) {
    let sum = 0;
    for (const p of pool) sum += p.w;
    let r = rng() * sum, k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    out.push(pool[k].i);
    pool.splice(k, 1);
  }
  return out;                       // out[0] 이 우승자
}

// 한 명의 속도 곡선. speed(t) = 1 + Σ 사인파 + Σ 봉우리.
// 봉우리는 부호가 있다 — 양수면 부스터, 음수면 발을 헛디디는 것(함정)이다.
// 적분식이 부호를 가리지 않으므로 같은 배열에 담아 두면 area() 는 그대로 쓸 수 있다.
//
// **속도가 0 밑으로 가면 주자가 뒷걸음질친다.** 그래서 함정은 아무 데나 못 판다 —
// 지금 곡선이 이미 0.23 까지 내려가므로, 거기에 깊이 0.4 만 얹어도 음수가 된다.
// 대신 **속도가 높은 순간**을 찾아 그때 판다. 2400명분을 재보니 그런 자리에서는
// 깊이 1.26 이상을 팔 수 있었다 (중앙 1.86). 잘 나가다 걸리는 편이 더 극적이기도 하다.
function profile(rng, boosts, tEnd) {
  const waves = [];
  let amp = 0;
  for (let k = 0; k < 2; k++) {
    const a = TUNE.wobble * (k ? 0.55 : 1) * (0.6 + rng() * 0.8);
    amp += Math.abs(a);
    waves.push({ a, w: TAU * lerp(TUNE.hz[0], TUNE.hz[1], rng()), p: rng() * TAU });
  }
  // 합이 1 을 넘으면 속도가 음수가 된다. 넘칠 일은 없지만 값을 바꿀 사람을 위해 막아둔다.
  if (amp > 0.85) for (const v of waves) v.a *= 0.85 / amp;

  // 부스터를 아무 데나 뿌리면 겹친다. 그냥 뽑았더니 6.7% 가 앞엣것과 겹쳐서
  // 두 번이 한 번으로 보였다 (최소 간격 0초). 가중치 = 부스터 개수인데 눈에 두 개만
  // 보이면 도구가 거짓말을 하는 셈이다. 그래서 구간을 개수만큼 쪼개 한 칸에 하나씩 둔다.
  //   앞뒤 여백을 두는 이유 — 출발 직후와 결승 직전은 어차피 카메라가 다른 걸 보고 있다.
  const lo = tEnd * 0.12, hi = tEnd * 0.92;
  const slot = (hi - lo) / Math.max(1, boosts);
  const room = Math.max(0, slot - TUNE.boostS - 0.4);   // 칸 안에서 흔들 수 있는 폭
  const bumps = [];
  for (let k = 0; k < boosts; k++) {
    bumps.push({ s: lo + slot * k + rng() * room, d: TUNE.boostS, e: TUNE.boostE });
  }
  return { waves, bumps };                               // 만들 때부터 시간순이다
}

// 사인파만 더한 속도 (봉우리 빼고). 함정을 팔 자리를 고를 때 쓴다.
function baseSpeed(waves, t) {
  let v = 1;
  for (const w of waves) v += w.a * Math.sin(w.w * t + w.p);
  return v;
}

// [lo, hi] 구간에서 함정을 가장 깊게 팔 수 있는 자리를 찾아 꽂는다.
// 조건은 함정 구간 내내 speed ≥ MIN 인 것 — 안 지키면 뒷걸음질친다.
const MIN_SPEED = 0.12;
function digDip(pf, rng, lo, hi, tEnd) {
  const d = TUNE.dipS;
  const enough = TUNE.dipE + 0.1;      // 이만큼만 나오면 더 안 찾는다
  let best = null;
  // 가장 좋은 자리를 끝까지 찾을 필요가 없다 — 필요한 깊이는 0.75 인데 실측으로
  // 쓸 만한 자리의 여유가 중앙 1.86 이라, 몇 번만 찔러봐도 충분한 데가 나온다.
  // 60군데를 24점씩 재던 걸 줄여서 추첨 한 번이 0.59ms → 0.13ms 가 되었다.
  for (let k = 0; k < 16; k++) {
    const s = tEnd * (lo + (hi - lo) * rng());
    if (s + d > tEnd * 0.94) continue;
    // 부스터와 겹치면 서로 상쇄되어 둘 다 안 보인다. 0.6초는 떼어 놓는다.
    if (pf.bumps.some(b => s < b.s + b.d + 0.6 && b.s < s + d + 0.6)) continue;
    let room = Infinity;
    for (let j = 1; j < 10; j++) {
      const t = s + d * j / 10;
      const m = Math.sin(Math.PI * (t - s) / d) ** 2;
      room = Math.min(room, (baseSpeed(pf.waves, t) - MIN_SPEED) / m);
    }
    if (!best || room > best.room) best = { s, room };
    if (room >= enough) break;
  }
  if (!best || best.room < 0.25) return;                 // 팔 자리가 없으면 그냥 넘어간다
  pf.bumps.push({ s: best.s, d, e: -Math.min(TUNE.dipE, best.room) });
  pf.bumps.sort((a, b) => a.s - b.s);
}

// 곡선 아래 넓이. 이게 「지금까지 나아간 정도」다.
function area(pf, t) {
  let s = t;
  for (const v of pf.waves) s += (v.a / v.w) * (Math.cos(v.p) - Math.cos(v.w * t + v.p));
  for (const b of pf.bumps) {
    if (t <= b.s) break;
    const u = Math.min(t - b.s, b.d);
    // ∫ sin²(πu/d) du = u/2 − (d/4π)·sin(2πu/d)
    s += b.e * (u / 2 - (b.d / (4 * Math.PI)) * Math.sin(TAU * u / b.d));
  }
  return s;
}

export function createRace(cands, rng = Math.random) {
  const order = drawOrder(cands, rng);          // 추첨 결과 — 여기서 이미 승부가 났다

  // 부스터 개수는 「보여주는 값」이고 가중치는 「확률을 정하는 값」이다. 둘을 떼어 놓는다.
  // 가중치가 2.5 면 부스터는 3개로 반올림하고, 20 이면 6개에서 끊는다 —
  // 한 판이 24.5초인데 20개를 쑤셔 넣으면 칸이 1초도 안 되어 부스터가 계속 켜진 것처럼 보인다.
  // 확률은 어느 쪽도 건드리지 않는다. 정규화가 개수와 무관하게 도착 시각을 맞추기 때문이다.
  const shown = c => Math.min(TUNE.boostMax, Math.max(0, Math.round(c.w)));

  const runners = cands.map((c, i) => ({
    c, i, pos: 0, rank: i + 1, done: false,
    boosts: shown(c), place: 0, endT: 0, pf: null,
  }));

  let t = 0;
  order.forEach((idx, k) => {
    const r = runners[idx];
    r.place = k + 1;
    // 등수대로 도착 시각. 간격이 0.2~0.6초라 화면에서는 사진 판독감이 난다.
    t += k === 0 ? 0 : lerp(TUNE.gap[0], TUNE.gap[1], rng());
    r.endT = (TUNE.seconds * LAPS + t) * 1000;   // seconds 는 「한 바퀴」 기준이다
    r.pf = profile(rng, shown(r.c), r.endT / 1000);

    // ── 배역 배치 ────────────────────────────────────────────
    // 결과를 이미 아니까 사고를 이야기에 맞춰 놓을 수 있다. 물리로 굴리는 레이스에서는
    // 못 하는 일이다. 정규화가 모양만 바꾸고 도착 시각은 그대로 두므로 승부는 안 변한다.
    //
    // **다만 배역을 너무 곧이곧대로 따르면 결과가 새어나간다.** 함정 자리에 웅덩이가
    // 깔려서 출발 전부터 다 보이는데, 「우승자는 초반, 꼴찌는 막판」을 그대로 지키면
    // 가장 이른 웅덩이의 주인이 우승자일 확률이 72.9% 가 된다 (우연이면 12.5%).
    // 몇 판만 봐도 알아챈다. 그래서 배역은 4분의 3만 지키고, 나머지 주자에게도
    // 트랙 전 구간에 걸쳐 웅덩이를 흩뿌려 신호를 묻는다.
    const last = order.length, end = r.endT / 1000;
    if (k === 0 && rng() < 0.75) digDip(r.pf, rng, 0.15, 0.50, end);            // 우승자: 초반
    else if (k === last - 1 && rng() < 0.75) digDip(r.pf, rng, 0.55, 0.88, end); // 꼴찌: 막판
    else if (rng() < 0.85) digDip(r.pf, rng, 0.12, 0.88, end);                   // 그 밖: 아무 데나
    if (rng() < 0.25) digDip(r.pf, rng, 0.12, 0.88, end);                        // 가끔 하나 더

    r.total = area(r.pf, r.endT / 1000);        // 도착 시각의 넓이 = 1 로 삼을 기준
  });

  return {
    runners, t: 0, finished: [], over: false,
    winner: runners[order[0]],

    step(dt) {
      if (this.over) return;
      this.t += dt;
      const now = this.t / 1000;
      const justDone = [];
      for (const r of runners) {
        // 자기 도착 시각에 정확히 1 이 되도록 나눈다. 프레임 길이와 무관하다.
        const f = Math.min(1, area(r.pf, Math.min(now, r.endT / 1000)) / r.total);
        r.pos = f * TRACK;
        r.boosts = r.pf.bumps.filter(b => b.e > 0 && now < b.s).length;   // 아직 안 쓴 부스터
        if (!r.done && this.t >= r.endT) { r.done = true; justDone.push(r); }
      }
      // 한 프레임 안에 둘이 같이 들어올 수 있다. 4배속이면 한 스텝이 240ms 인데
      // 등수 간격은 0.18초부터라 흔히 겹친다. 배열 순서대로 밀어 넣으면 도착 순서가
      // 레인 번호 순이 되어 **추첨 결과와 어긋난다** — 300판 중 24판에서 실제로 그랬다.
      justDone.sort((a, b) => a.endT - b.endT);
      for (const r of justDone) this.finished.push(r);

      // 들어온 사람끼리는 pos 가 다 같으므로 도착 시각으로 가른다. 안 그러면 순위표가
      // 결승선 근처에서 레인 번호 순으로 나온다.
      [...runners].sort((a, b) => (b.pos - a.pos) || (a.endT - b.endT))
        .forEach((r, i) => (r.rank = i + 1));
      if (this.finished.length >= runners.length) this.over = true;
    },

    // 이 주자가 t초에 어디까지 왔을까. 함정 자리에 웅덩이를 놓으려면 필요하다.
    // 레인이나 좌표는 여기서 모른다 — 진행률만 돌려주고 자리 계산은 화면 쪽이 한다.
    progressAt(r, t) { return Math.min(1, area(r.pf, Math.min(t, r.endT / 1000)) / r.total); },

    // 함정 목록 — [{ r, t, deep }]. 시작 시각과 깊이를 준다.
    hazards() {
      const out = [];
      for (const r of runners) {
        for (const b of r.pf.bumps) if (b.e < 0) out.push({ r, t: b.s, d: b.d, deep: -b.e });
      }
      return out;
    },

    boosting(r) { return this.bump(r) > 0; },
    stumbling(r) { return this.bump(r) < 0; },
    // 지금 이 주자에게 걸려 있는 봉우리의 부호. 0 이면 아무 일도 없다.
    bump(r) {
      if (r.done) return 0;
      const now = this.t / 1000;
      for (const b of r.pf.bumps) if (now >= b.s && now < b.s + b.d) return b.e;
      return 0;
    },
    lead() { return Math.max(...runners.map(r => r.pos)); },
  };
}
