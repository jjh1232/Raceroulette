import * as THREE from '../vendor/three.module.min.js';
import { LANES, laneRadius, perimeter, place, pointAt } from './track.js';

// 카메라. three.js 의 OrbitControls 를 안 쓴 이유:
//   1. 목표가 가만있지 않는다 — 무리를 쫓아 트랙을 따라 돈다.
//   2. 「추격」은 진행 방향을 기준으로 붙어야 한다. 트랙이 오벌이라
//      월드 축 기준으로 각도를 잡으면 곡선 구간에서 엉뚱한 데를 본다.
//   3. 「골대」처럼 한자리에 못 박는 모드도 필요하다.
//
// ── 각도 규약 (2026-08-21 에 node 로 실측한 값) ────────────────────
//   yaw   0 = 주자 옆(트랙 바깥쪽)   90 = 바로 뒤   180 = 옆(인필드쪽)   270 = 정면에서 마주봄
//   pitch 0 = 지면 높이   90 = 바로 위
//
//   예전 주석은 0 과 90 이 서로 바뀌어 있었다. 그래서 이름이 `side`(yaw 90)인 프리셋이
//   실제로는 바로 뒤통수만 보는 샷이었다. 값을 믿기 전에
//   「카메라→주자」 벡터와 주자 정면이 이루는 각을 재볼 것.
const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 결승선은 앞 직선 한가운데. 골대 카메라가 설 자리의 기준점이다.
const FINISH = pointAt(laneRadius(0), 0);

const AUTO_RESUME = 3000;   // ms. 손을 뗀 뒤 이만큼 지나면 자동 연출로 돌아온다

// ── 무엇을 볼 것인가 ──────────────────────────────────────
// 1등의 위치를 그대로 쫓으면 안 된다. 순위는 한 판에 예닐곱 번 바뀌고 그중 41% 는
// 1초도 못 버티는데, 바뀔 때마다 목표가 다른 레인으로 넘어가 캐릭터 두세 명 폭만큼
// 홱 튄다 (실측 평균 339, 상위 10% 는 543, 최대 666).
//
// 그래서 「누구」가 아니라 「어디까지 왔나」를 본다. 진행률을 가운데 레인 위에
// 올려놓으면 1등이 바뀌어도 목표가 연속적이다 — 같은 조건에서 프레임당 최대 이동이
// 666 → 27 로 떨어졌다. 27 은 그냥 정상 주행 속도다.
// 레인 수가 바뀌면 한가운데도 바뀌므로 미리 계산해 두지 않는다.
const focusLane = () => (LANES - 1) / 2;
const focusP = () => perimeter(laneRadius(focusLane()));
const PULL = 0.7;        // 선두에서 무리 쪽으로 당기는 비율. 접전이면 무리가, 벌어지면 선두가 잡힌다
const PULL_CAP = 320;    // 아무리 벌어져도 이 이상은 안 당긴다. 안 막으면 1등이 화면 밖으로 나간다

// 크리티컬 댐프 스프링. lerp 과 달리 속도를 들고 있어서 방향이 바뀔 때 관성이 생기고,
// 그러면서도 오버슛 없이 멈춘다. 프레임 길이가 흔들려도 결과가 같다.
// (예전엔 시간상수 72ms 짜리 지수감쇠 lerp 이라 관성이 아예 없었다.)
function damp(cur, tgt, vel, dt, T) {
  const w = 2 / Math.max(T, 1e-4);
  const x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const d = cur - tgt;
  const tmp = (vel + w * d) * dt;
  return { x: tgt + (d + tmp) * e, v: (vel - w * tmp) * e };
}

const T_ANGLE = 0.18;    // 초. 각도는 짧게 — 끌었을 때 손에 붙어 있어야 한다
const T_FOCUS = 0.25;    // 초점은 조금 길게
const T_FOV = 0.30;

// 자동 연출이 쓰는 샷. yaw 는 위의 실측 규약 기준이다.
const SHOTS = {
  launch: { mode: 'chase', yaw: 268, pitch:  7, dist:  900 },  // 정면에서 낮게 — 달려오는 걸 본다
  inside: { mode: 'chase', yaw: 172, pitch: 30, dist: 1150 },  // 곡선은 인필드 쪽에서
  arc:    { mode: 'chase', yaw: 215, pitch: 16, dist:  980 },  // 같은 곡선 후반 — 앞쪽 사선으로 낮게
  side:   { mode: 'chase', yaw:   4, pitch: 13, dist: 1300 },  // 직선은 트랙 바깥에서 나란히
  sweep:  { mode: 'chase', yaw: 140, pitch: 46, dist: 1450 },  // 둘째 곡선은 높이 잡아 판을 보여준다
  press:  { mode: 'chase', yaw:  90, pitch: 10, dist:  820 },  // 마지막 직선 직전 — 뒤에 바짝 붙는다
  goal:   { mode: 'goal',  yaw:  35, pitch: 15, dist: 1150 },
  winner: { mode: 'chase', yaw: 285, pitch: 11, dist:  520 },  // 우승자 클로즈업
};

// 샷마다 최소 몇 ms 는 유지한다. 출발 샷을 길게 잡은 건, 지금 레이스가
// 초반에 부스터가 한꺼번에 터져 진행률이 두 배로 빨리 오르기 때문이다 (race.js 참고).
const HOLD = {
  launch: 2600, inside: 1600, arc: 1600, side: 1600, sweep: 1600, press: 1300, goal: 1200, winner: 0,
};

export class RaceCamera {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(40, aspect, 5, 60000);

    // 목표값 — 프리셋·자동연출·조작이 여기에 쓴다.
    this.mode = 'chase';
    this.yaw = 40; this.pitch = 26; this.dist = 1050; this.fov = 40;
    this.height = 95;                    // 발밑이 아니라 가슴께를 본다 (캐릭터 키의 절반쯤)

    // 실제값 — 스프링이 목표를 쫓아간다.
    this._yaw = this.yaw; this._pitch = this.pitch;
    this._dist = this.dist; this._fov = this.fov;
    this._vYaw = 0; this._vPitch = 0; this._vDist = 0; this._vFov = 0;
    this._at = new THREE.Vector3(0, this.height, -laneRadius(focusLane()));
    this._atV = new THREE.Vector3();
    this._lag = new THREE.Vector3();

    this.auto = true;
    this.idle = AUTO_RESUME;   // 마지막 조작 이후 흐른 시간(ms)
    this.spin = 0;             // 드래그를 놓은 뒤 남는 관성
    this.manual = false;       // 손으로 각도를 바꿔 놓았나
    this.shot = null;          // 지금 자동 연출이 고른 샷 이름
    this.held = 0;             // 그 샷을 유지한 시간(ms)
    this.field = { f1: 0, f3: 0, laps: 1, spread: 0, boost: false, over: false };
  }

  // 매 프레임 레이스 상태를 받는다. 순위가 아니라 진행률을 받는 것이 핵심이다.
  setField(f) { Object.assign(this.field, f); }

  // 카메라가 보는 트랙 위의 한 점. 레인이 고정이라 1등이 바뀌어도 옆으로 안 튄다.
  //
  // **진행률에 바퀴 수를 곱해야 한다.** main.js 는 주자를 `place(레인, 진행률 × 바퀴)` 에
  // 놓는데 여기서 안 곱하면 세 바퀴짜리 판에서 카메라가 트랙의 엉뚱한 데를 본다
  // (실측 최대 4576 어긋남). 당기는 양도 마찬가지로 진행률 단위라 같이 환산한다.
  focus() {
    const { f1, f3, laps } = this.field;
    const pull = Math.min(Math.max(f1 - f3, 0) * PULL, PULL_CAP / (focusP() * laps));
    return place(focusLane(), Math.max(0, (f1 - pull) * laps));
  }

  update(dt) {
    this.idle += dt;
    if (this.auto && this.idle >= AUTO_RESUME) this.direct(dt);

    // 드래그 관성 — 놓은 뒤 몇 백 ms 더 돌다가 선다.
    if (Math.abs(this.spin) > 0.02) {
      this.yaw += this.spin * dt / 16;
      this.spin *= Math.pow(0.86, dt / 16);
    } else this.spin = 0;

    const s = dt / 1000;
    // yaw 는 각도라 최단 방향으로 감아야 한다. 안 그러면 359° → 1° 가 한 바퀴가 된다.
    const around = this._yaw + (((this.yaw - this._yaw) % 360 + 540) % 360 - 180);
    let r = damp(this._yaw, around, this._vYaw, s, T_ANGLE);
    this._yaw = r.x; this._vYaw = r.v;
    r = damp(this._pitch, clamp(this.pitch, 3, 88), this._vPitch, s, T_ANGLE);
    this._pitch = r.x; this._vPitch = r.v;
    r = damp(this._dist, this.dist, this._vDist, s, T_ANGLE);
    this._dist = r.x; this._vDist = r.v;
    r = damp(this._fov, this.fov, this._vFov, s, T_FOV);
    this._fov = r.x; this._vFov = r.v;
    if (Math.abs(this.cam.fov - this._fov) > 0.01) {
      this.cam.fov = this._fov; this.cam.updateProjectionMatrix();
    }

    const y = this._yaw * D2R, p = this._pitch * D2R;
    const c = this.focus();
    let want, look;

    if (this.mode === 'stadium') {
      // 경기장 전체. 목표가 한가운데라 아무도 화면 밖으로 안 나간다.
      look = new THREE.Vector3(0, 0, 0);
      want = new THREE.Vector3(
        Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p))
        .multiplyScalar(this._dist * 4).add(look);
    } else if (this.mode === 'goal') {
      // 결승선 바깥에 못 박혀 서서 달려오는 쪽을 본다.
      look = new THREE.Vector3(c.x, this.height, c.z);
      want = new THREE.Vector3(
        FINISH.x + this._dist * Math.cos(y) * Math.cos(p),
        this._dist * Math.sin(p),
        FINISH.z - this._dist * Math.sin(y) * Math.cos(p));
    } else {
      // 추격 — 오프셋을 진행 방향으로 돌려야 곡선에서도 늘 같은 쪽에서 보게 된다.
      look = new THREE.Vector3(c.x, this.height, c.z);
      want = new THREE.Vector3(
        -Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p))
        .multiplyScalar(this._dist)
        .applyAxisAngle(UP, c.heading)
        .add(look);
    }

    // 스프링은 「초점」에만 건다. 카메라 자리는 초점과 각도에서 바로 나온다 —
    // 자리에도 따로 스프링을 물리면 두 번 늦어져서 조작이 뭉개진다.
    for (const ax of ['x', 'y', 'z']) {
      const q = damp(this._at[ax], look[ax], this._atV[ax], s, T_FOCUS);
      this._at[ax] = q.x; this._atV[ax] = q.v;
    }
    if (this.mode === 'chase') {
      // 초점이 스프링에 밀린 만큼 카메라도 같이 밀어야 화면 안에서 위치가 안 흔들린다.
      this._lag.copy(this._at).sub(look);
      want.add(this._lag);
    }
    this.cam.position.copy(want);
    this.cam.lookAt(this._at);
  }

  // ── 자동 연출 ────────────────────────────────────────
  // 육상 중계와 마블런의 문법: 카메라를 부드럽게 옮기지 말고 컷으로 끊는다.
  // 구간이 바뀔 때만 자리를 바꾸고, 구간 안에서는 가만히 따라간다.
  //
  // 경계값은 트랙 기하에서 나온 것이다 (track.js 의 직선 2400 · 반지름 1300):
  // 앞 직선이 진행률 0~0.093, 곡선 0.093~0.408, 뒤 직선 0.408~0.593, 곡선 0.593~0.908.
  // 다만 출발 샷은 기하 경계(0.093)에 맞추면 1초 만에 끝나 버려서, 곡선 초입까지
  // 끌고 간다. 둘째 곡선은 반대로 6초나 되어 둘로 쪼갰다. 한 샷이 2.5~4초쯤 간다.
  direct(dt) {
    const f = this.field;
    // 트랙 구간으로 고르는 샷은 「이번 바퀴의 어디쯤인가」를 봐야 한다.
    // 전체 진행률을 그대로 쓰면 세 바퀴짜리 판에서 한 바퀴 내내 같은 샷이 나온다.
    const lap = (f.f1 * f.laps) % 1;
    this.held += dt;
    if (this.manual) {
      // 손을 뗀 지 3초가 지나 자동이 되찾은 순간이다. 샷의 각도를 다시 목표로 삼는다.
      // 이게 없으면 다음 컷이 올 때까지(최대 4초) 끌어 놓은 각도에 머물러서,
      // 「3초 지나면 자동으로 돌아온다」고 해 놓고 안 돌아오는 셈이 된다.
      // 컷하지 않고 스프링으로 되돌아간다 — 방금 보던 화면이 뚝 끊기면 빼앗긴 느낌이 든다.
      this.manual = false;
      Object.assign(this, SHOTS[this.shot]);   // shot 이 null 이면 Object.assign 이 무시한다
    }
    const want =
      f.over          ? 'winner'
      : f.f1 >= 0.88  ? 'goal'
      : f.f1 <  0.15 / f.laps ? 'launch'   // 출발 샷은 첫 바퀴 초반에만
      : lap <  0.28   ? 'inside'
      : lap <  0.408  ? 'arc'
      : lap <  0.593  ? 'side'
      : lap <  0.75   ? 'sweep'
      :                 'press';
    // 최소 유지 시간. 경계에서 진행률이 오르내리면 컷이 깜빡이고, 무엇보다
    // 레이스 속도가 바뀌면(가중치를 고치면 바뀐다) 짧은 구간이 순식간에 지나간다.
    // 우승 순간만은 기다리지 않는다.
    if (want !== this.shot && (want === 'winner' || this.held >= (HOLD[this.shot] || 0))) {
      this.shot = want;
      this.held = 0;
      Object.assign(this, SHOTS[want]);
      this.cut();
    }
    // 무리가 벌어지면 물러나고 붙으면 당긴다. 스팬에서 거리를 그대로 역산하면 발산하므로
    // 배율에 상·하한을 둔다 (README: 초점거리를 화면 채움으로 역산했다가 2310px 이 나온 적 있다).
    this.dist = SHOTS[this.shot].dist * clamp(0.78 + f.spread / 2600, 0.78, 1.6);
    // 부스터가 켜지면 화각을 밀어 속도감을 만든다. 레이싱 게임의 오래된 수법이다.
    this.fov = f.boost ? 48 : 40;
  }

  cut() {                                  // 컷 — 스프링을 건너뛰고 즉시 그 자리로
    this._yaw = this.yaw; this._pitch = this.pitch;
    this._dist = this.dist; this._fov = this.fov;
    this._vYaw = this._vPitch = this._vDist = this._vFov = 0;
    this._atV.set(0, 0, 0);
    const c = this.focus();
    if (this.mode !== 'stadium') this._at.set(c.x, this.height, c.z);
    else this._at.set(0, 0, 0);
  }
  snap() { this.cut(); this.update(0); }

  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }

  // 지금 얼마나 떨어져서 보고 있나. 안개를 이 값에 맞춰야 시점마다 다시 잡을 필요가 없다.
  get range() { return this.cam.position.distanceTo(this._at); }

  // ── 조작 ──────────────────────────────────────────────
  // 감도를 px 가 아니라 화면 크기에 맞춘다. 예전에는 px 당 0.3도 고정이라
  // 폰(390px)에서는 화면을 다 쓸어도 117도밖에 못 돌았다.
  touched() { this.idle = 0; this.manual = true; }
  orbit(dx, dy, w, h) {
    this.touched();
    const g = (360 * dx) / Math.max(w, 200) * 0.55;
    this.yaw += g;
    this.spin = g;                                   // 손을 뗐을 때 이어질 속도
    this.pitch = clamp(this.pitch - (180 * dy) / Math.max(h, 200) * 0.7, 3, 88);
  }
  dolly(f) { this.touched(); this.spin = 0; this.dist = clamp(this.dist * f, 200, 9000); }

  apply(v) { this.touched(); this.shot = null; Object.assign(this, v); this.cut(); }
}

// 손으로 고르는 시점은 셋뿐이다. 여섯 개를 두었더니 「뒤에서」와 「구석에서」가 서로 비슷하고,
// 「골대에서」는 자동 연출이 마지막 구간에 이미 잡아 준다. 남긴 셋은 하는 일이 다르다 —
// 따라붙기 · 판 읽기 · 전체 보기. 그 사이 각도는 끌어서 맞추면 된다.
// (예전 `side`(yaw 90)는 이름과 달리 뒤통수만 보고 있었다. 실제 옆으로 고친 값이다.)
export const VIEWS = {
  side:    { mode: 'chase',   yaw:   4, pitch: 13, dist: 1300 },
  top:     { mode: 'chase',   yaw:  60, pitch: 62, dist: 1500 },
  stadium: { mode: 'stadium', yaw:  25, pitch: 40, dist: 1450 },
};
