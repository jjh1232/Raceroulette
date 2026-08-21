import * as THREE from '../vendor/three.module.min.js';
import { makeRunner, COLORS, HEAD_NAMES, BUILD_NAMES, UNIT_H } from './runner.js';
import { GAIT_NAMES } from './gaits.js';
import { RaceCamera, VIEWS } from './camera.js';
import { makeBoostFx } from './fx.js';
import { MOODS, buildScenery } from './scenery.js';
import { makeLabels } from './labels.js';
import { makeHud } from './hud.js';
import { makeEntry } from './entry.js';
import { createRace, TRACK, TUNE, MAX_LAPS, setLaps } from './race.js';
import * as T from './track.js';

// 달리기 전 제자리 달리기의 기준 속도 — 실제 레이스와 비슷한 걸음 수가 나오도록
// 「한 바퀴를 이만큼 걸려 도는 속도」로 준다. 제자리라 실제 이동은 없다.
const IDLE_SECONDS = 24;

// 몇 바퀴를 도나. race.js 가 판 길이를, track.js 의 place() 가 위치를 맡는다.
let laps = 1;

// 모션 값. 슬라이더로 눈으로 골라서 확정한 값이고, 이제 여기 한 곳에만 있다.
// 슬라이더가 있던 동안 HTML 에도 같은 값이 적혀 있어서 옛 값(키 110)이 이 값을 덮어쓴 적이 있다.
// 다시 만질 일이 생기면 슬라이더를 되살리지 말고 여기 숫자를 고칠 것.
//   h 키 · stride 보폭 · knee 무릎 · arm 팔 · bounce 상하 튐 · lean 기울기 · trim 발맞춤 보정(%)
const opt = { h: 170, stride: 58, knee: 52, arm: 34, bounce: 7, lean: 9, trim: 100 };

// 처음에 채워 두는 값. 사용자가 「참가자」 칸에서 바꾸면 여기는 더 안 쓰인다.
// 넷으로 시작한다 — 여덟은 처음 보는 사람에게 「이만큼 넣어야 하나」로 읽힌다.
// 가중치를 하나만 2 로 둔 건 부스터가 뭔지 한 판만 봐도 알게 하려는 것이다.
//
// 이름은 HTML 에서 읽는다. 언어판마다 다른 글자는 이미 전부 거기(data-ph, data-fallback,
// data-running, data-word)에 있으므로, 여기에 한국어 이름을 박아 두면 영어판에서 튄다.
const entriesEl = document.getElementById('entries');
const DEFAULTS = (entriesEl?.dataset.names || 'A,B,C,D')
  .split(',')
  .map(n => n.trim())
  .filter(Boolean)
  .map((name, i) => ({ name, w: i === 0 ? 2 : 1 }));
let cands = [];

// 피셔–예이츠. `sort(() => Math.random() - 0.5)` 은 고르게 안 섞인다 —
// 20만 번 돌려보니 어떤 자리는 기대값보다 77% 치우쳐 있었다. 뽑기 도구에서
// 「대충 섞이는 것」을 쓰기 시작하면 어디까지가 대충인지 알 수 없어진다.
function shuffled(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// 종류가 인원보다 적으면 돌려 쓴다. 먼저 섞은 뒤 늘려야 어떤 게 겹칠지도 매번 달라진다.
const deal = (a, n) => {
  const base = shuffled(a);
  return shuffled(Array.from({ length: n }, (_, i) => base[i % base.length]));
};

// 생김새는 여기서 한 번 나눠 준다. 머리 모양·체형·주법이 인원 안에서 고르게 퍼진다.
function makeCands(entries) {
  const n = T.setLanes(entries.length);
  const heads = deal(HEAD_NAMES, n);
  const builds = deal(BUILD_NAMES, n);
  const gaits = deal(GAIT_NAMES, n);
  // lane 은 「몇 번째 레인에서 달리나」다. 배열 순서와 떼어 놓아야 레인만 따로 섞을 수 있다.
  // 색·순위판 자리는 배열 순서를 따르고, 트랙 위 자리만 lane 을 따른다.
  cands = entries.slice(0, n).map((e, i) => ({
    name: e.name, w: e.w, color: COLORS[i % COLORS.length],
    gait: gaits[i], head: heads[i], build: builds[i], lane: i,
  }));
}

// 섞는 건 둘 다 생김새를 건드리지 않는다. 색·머리·체형까지 바뀌면
// 누가 누구였는지 매번 다시 익혀야 한다.
//
// 캐릭터가 spec 객체를 그대로 들고 있고 주법과 레인을 매 프레임 거기서 읽으므로,
// 값만 갈아 끼우면 다음 프레임부터 적용된다 — 다시 만들 필요가 없다.
function shuffleGaits() {
  const g = deal(GAIT_NAMES, cands.length);
  cands.forEach((c, i) => (c.gait = g[i]));   // 다음 프레임부터 그 자세로 달린다
}

// 레인 섞기는 달리는 중에는 막는다. 레인이 바뀌면 주자가 옆으로 순간이동하는데,
// 경기 중에 그러면 고장으로 보인다.
function shuffleLanes() {
  const l = shuffled(cands.map((_, i) => i));
  cands.forEach((c, i) => (c.lane = l[i]));
  placeHazards();          // 웅덩이는 레인 위에 있으므로 같이 옮겨야 한다
}

// ── 무대 ────────────────────────────────────────────
const holder = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // 4K 에서 픽셀 4배를 그리면 팬이 돈다
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
holder.appendChild(renderer.domElement);

// 분위기는 여기 한 줄이 정한다. MOODS.sunset 으로 바꾸면 노을이 된다.
const M = MOODS.day;

const scene = new THREE.Scene();
scene.background = new THREE.Color(M.fog);
// 안개는 원근감을 만드는 가장 싼 수단이다. 다만 「전체」 시점은 카메라가 9000쯤 물러나므로
// 그때 경기장이 통째로 지워지지 않게 far 를 넉넉히 잡는다.
scene.fog = new THREE.Fog(M.fog, 3000, M.fogSpan);

scene.add(new THREE.HemisphereLight(M.hemiSky, M.hemiGround, M.hemiInt));
const sun = new THREE.DirectionalLight(M.sun, M.sunInt);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
// 그림자 카메라는 좁을수록 선명하다. 선두 주변만 덮고 매 프레임 따라 옮긴다.
const SH = 600;
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 100; sun.shadow.camera.far = 2800;
scene.add(sun); scene.add(sun.target);

const half = T.STRAIGHT / 2;
let outR = 0;
const inR = T.LANE_R0 - T.LANE_GAP / 2;      // 안쪽은 레인 수와 무관하다

// 바깥 바닥은 레인 수와 상관없으니 한 번만 만든다.
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000),
    new THREE.MeshLambertMaterial({ color: M.floor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  scene.add(floor);
}

// 오벌 트랙 바닥. 바깥 윤곽에 안쪽 윤곽을 구멍으로 뚫어 만든다.
// 도형이 z 에 대칭이라 XZ 로 눕힐 때 뒤집혀도 모양이 같다.
function ovalPath(r) {
  const p = new THREE.Path();
  p.moveTo(-half, -r);
  p.lineTo(half, -r);
  p.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(-half, r);
  p.absarc(-half, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  return p;
}

// 레인 수가 바뀌면 트랙을 통째로 다시 만든다. 참가 인원이 바뀔 때만 불리므로
// 매 프레임 비용은 없다. 옛 도형은 반드시 버려야 한다 — 안 버리면 인원을 몇 번
// 바꾸는 사이에 GPU 메모리에 트랙이 열 장 쌓인다.
const trackGroup = new THREE.Group();
scene.add(trackGroup);

function buildTrack() {
  outR = T.laneRadius(T.LANES - 1) + T.LANE_GAP / 2;
  for (const m of trackGroup.children) {
    m.geometry.dispose();
    m.material.dispose();
  }
  trackGroup.clear();

  const shape = new THREE.Shape(ovalPath(outR).getPoints(120));
  shape.holes.push(new THREE.Path(ovalPath(inR).getPoints(120)));
  const surf = new THREE.Mesh(new THREE.ShapeGeometry(shape),
    new THREE.MeshLambertMaterial({ color: M.track }));
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.5;
  surf.receiveShadow = true;
  trackGroup.add(surf);

  const infield = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(ovalPath(inR).getPoints(120))),
    new THREE.MeshLambertMaterial({ color: M.infield }));
  infield.rotation.x = -Math.PI / 2;
  infield.receiveShadow = true;
  trackGroup.add(infield);

  // 레인 경계선 — 여러 줄을 선 하나로 묶는다. 도형 수를 늘리지 않으려고.
  {
    const pts = [];
    for (let i = 0; i <= T.LANES; i++) {
      const r = T.LANE_R0 + (i - 0.5) * T.LANE_GAP;
      const path = T.samplePath(r, 60);
      for (let k = 0; k < path.length - 1; k++) {
        pts.push(path[k].x, 1.2, path[k].z, path[k + 1].x, 1.2, path[k + 1].z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    trackGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: M.laneLine })));
  }

  // 거리 눈금 — 트랙을 가로지르는 짧은 도막들. 곁을 스쳐 지나가는 게 보여야 속도가 느껴진다.
  // 레인 선은 진행 방향과 나란해서 아무리 빨라도 가만히 있는 것처럼 보인다.
  {
    const pts = [];
    for (let k = 0; k < 48; k++) {
      const f = k / 48;
      const a = T.pointAt(inR, f * T.perimeter(inR));
      const b = T.pointAt(outR, f * T.perimeter(outR));
      pts.push(a.x, 1.2, a.z, b.x, 1.2, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    trackGroup.add(new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: M.tick, transparent: true, opacity: 0.5 })));
  }

  // 결승선과 기둥. 재질을 하나로 묶어 쓰면 위에서 버릴 때 같은 걸 여러 번 버리게 되어
  // 헷갈린다. 도형이 넷뿐이라 각자 갖게 두었다.
  const gold = () => new THREE.MeshLambertMaterial({ color: 0xd9a441 });
  const line = new THREE.Mesh(new THREE.BoxGeometry(14, 2, outR - inR), gold());
  line.position.set(0, 1.6, -(outR + inR) / 2);
  trackGroup.add(line);
  for (const r of [inR, outR]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 220, 8), gold());
    post.position.set(0, 110, -r);
    post.castShadow = true;
    trackGroup.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(10, 16, outR - inR), gold());
  bar.position.set(0, 220, -(outR + inR) / 2);
  trackGroup.add(bar);

  ground.layout(outR);            // 트랙 둘레 색 띠와 결승선 체크무늬도 같이
}

// 하늘·구름·나무. 트랙 바깥은 전부 여기서 만든다.
// 하늘·구름·숲은 한 번만 만들고, 레인 수에 따라 달라지는 부분만 layout() 이 다시 만든다.
const ground = buildScenery(scene, M);

// ── 주자 ────────────────────────────────────────────
const camera = new RaceCamera(1);
// 속도선은 배경색 쪽으로 섞여서 사라지고, 머리 쪽은 M.streak 로 물든다 —
// 밝은 배경에서는 흰색으로 밝히면 안 보여서 반대로 어둡게 간다.
const fx = makeBoostFx(scene, M.fog, M.streak);
const labels = makeLabels(scene);
// 순위판·결과창은 3D 가 아니라 무대 위에 겹치는 HTML 이다 — 글자가 또렷하고 드로우콜이 안 는다.
const hud = makeHud(holder, () => newRace());
let runners = [], race = null, running = false, speed = 1;
const group = new THREE.Group();
scene.add(group);

function buildRunners() {
  group.clear();
  fx.reset();                      // 옛 주자의 잔상이 씬에 남지 않게
  runners = cands.map(c => {
    const r = makeRunner(c);
    group.add(r.root);
    fx.register(r);
    return r;
  });
  labels.build(cands);
  hud.build(cands);
}

function newRace() {
  race = createRace(cands);
  setRunning(false);
  fx.clear();
  placeHazards();
  hud.hideResult();
  camera.shot = null;              // 다음 프레임에 출발 샷으로 컷
  setStatus('');
  document.getElementById('start').disabled = false;
}

// ── 함정 표시 ────────────────────────────────────────
// 미끄러지는 데 이유가 안 보이면 그냥 고장으로 보인다. 그래서 **미끄러질 자리에**
// 바나나 껍질을 깔아 둔다. 언제 걸리는지 이미 아니까(추첨이 끝나 있다) 그때 어디쯤일지도
// 계산할 수 있다 — race.progressAt() 이 그 진행률을 돌려준다.
//
// 껍질은 처음부터 보인다. 각자 자기 레인의 것만 밟으므로 남의 껍질을 지나가는 일은 없다.
// 바나나 껍질. 진흙 웅덩이로 먼저 만들었는데, 납작하고 어두워서 주황 트랙 위에서
// 그림자처럼 보일 위험이 있었다. 껍질은 미끄러짐의 만국 공통 기호이고 밝아서 눈에 띈다.
//
// 도형 파일은 여전히 안 쓴다 — 가운데 꼭지(눌러 놓은 구) 하나와 벌어진 껍질 세 장(원뿔)로
// 조립한다. 둘 다 InstancedMesh 라 **몇 개가 깔리든 드로우콜은 둘**이다.
const HAZ_MAX = T.MAX_LANES * 2;   // 주자당 최대 두 개 (배역 하나 + 가끔 하나 더)
const PEEL_R = 34;                 // 껍질이 벌어진 반지름. 레인 폭(85)의 절반쯤
const STRIPS = 3;

const peelCore = new THREE.InstancedMesh(
  new THREE.SphereGeometry(11, 8, 6),
  new THREE.MeshLambertMaterial({ color: M.peelIn }), HAZ_MAX);
const peelStrip = new THREE.InstancedMesh(
  new THREE.ConeGeometry(9, PEEL_R * 1.5, 6),
  new THREE.MeshLambertMaterial({ color: M.peel }), HAZ_MAX * STRIPS);
for (const m of [peelCore, peelStrip]) { m.frustumCulled = false; scene.add(m); }

function placeHazards() {
  const o = new THREE.Object3D();
  const list = race.hazards();
  const hide = () => { o.scale.setScalar(0); o.updateMatrix(); return o.matrix; };
  for (let i = 0; i < HAZ_MAX; i++) {
    const h = list[i];
    if (!h) {
      peelCore.setMatrixAt(i, hide());
      for (let k = 0; k < STRIPS; k++) peelStrip.setMatrixAt(i * STRIPS + k, hide());
      continue;
    }
    // **미끄러짐이 시작되는 바로 그 지점**에 깐다. 처음엔 조금 뒤(25% 지점)에 깔았는데,
    // 그러면 주자가 껍질에 닿기 181 앞에서 이미 미끄러지기 시작해 순서가 거꾸로 보인다.
    const f = race.progressAt(h.r, h.t) * laps;
    const p = T.place(h.r.c.lane, f);
    const spin = (h.t * 7) % 6.283;                 // 껍질마다 놓인 방향이 다르게

    o.position.set(p.x, 8, p.z);
    o.rotation.set(0, spin, 0);
    o.scale.set(1, 0.55, 1);                        // 눌러 놓아야 바닥에 붙어 보인다
    o.updateMatrix();
    peelCore.setMatrixAt(i, o.matrix);

    for (let k = 0; k < STRIPS; k++) {
      const a = spin + k * (6.283 / STRIPS);
      // y 11.5 는 눕힌 원뿔의 아랫면이 트랙 표면(0.5) 바로 위에 오는 값이다.
      // 6 으로 뒀더니 4.2 만큼 파묻혀 있었다.
      o.position.set(p.x + Math.cos(a) * PEEL_R * 0.5, 11.5, p.z + Math.sin(a) * PEEL_R * 0.5);
      // 원뿔을 눕혀서 바깥으로 뻗게 한다. 끝을 살짝 들어야 말린 껍질처럼 보인다.
      o.rotation.set(Math.PI / 2 - 0.25, 0, 0);
      o.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      o.scale.set(1, 1, 0.45);
      o.updateMatrix();
      peelStrip.setMatrixAt(i * STRIPS + k, o.matrix);
    }
  }
  peelCore.instanceMatrix.needsUpdate = true;
  peelStrip.instanceMatrix.needsUpdate = true;
}

// ── 화면 갱신 ────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 60) * speed; last = now;
  if (running && race) race.step(dt);

  const scale = opt.h / UNIT_H;
  let leadPose = null;
  const fxList = [];

  runners.forEach((r, i) => {
    const st = race.runners[i];
    // 진행률 0~1 이 「완주」다. 바퀴 수를 곱하면 place() 가 나머지로 감아서 여러 바퀴가 된다.
    const done = st.pos / TRACK;
    const f = done * laps;
    const ln = st.c.lane;                     // 배열 순서가 아니라 배정된 레인
    const p = T.place(ln, f);
    // 달리지 않는 동안에도 제자리 달리기를 계속한다. 멈춰 서 있으면 화면이 죽는다.
    // 결승선을 넘은 사람만 선다 — 다 뛴 사람이 계속 뛰면 끝난 게 안 읽힌다.
    const moving = !st.done;
    const boosting = race.boosting(st);
    const stumbling = race.stumbling(st);

    // 몸이 실제로 나아간 거리에서 속도를 뽑아 다리에 넘긴다.
    // **좌표에서 직접 잰다.** 「진행률 차이 × 레인 길이」로 계산하면 안 된다 —
    // 트랙을 구간별로 나눈 뒤로는 진행률당 거리가 일정하지 않다. 바깥 레인은
    // 직선에서 느리고 곡선에서 빨라서, 한 바퀴 평균을 곱하면 레인 7 기준
    // -22% ~ +13% 만큼 발이 미끄러진다.
    // 제자리 달리기일 때는 진짜로 안 움직이므로 레이스 평균 속도를 대신 준다.
    const moved = Math.hypot(p.x - (st.px ?? p.x), p.z - (st.pz ?? p.z));
    st.px = p.x; st.pz = p.z;
    const speed = running ? (dt > 0 ? moved / (dt / 1000) : 0)
                          : T.laneLength(ln) / IDLE_SECONDS;

    if (moving) r.advance(dt, speed, opt, scale);
    r.setPose(opt, moving, boosting, stumbling);
    r.root.position.set(p.x, 0, p.z);
    r.root.rotation.y = p.heading;
    r.root.scale.setScalar(scale);

    fxList.push({
      runner: r, x: p.x, z: p.z, heading: p.heading,
      scale, color: r.spec.color,
      boosting: boosting && moving, stumbling: stumbling && moving,
      dust: M.dust,             // 미끄러질 때 이는 먼지
    });
    if (st.rank === 1) leadPose = p;
  });

  if (leadPose) {
    sun.position.set(leadPose.x + 500, 1100, leadPose.z + 400);
    sun.target.position.set(leadPose.x, 0, leadPose.z);
    sun.target.updateMatrixWorld();
  }

  // 카메라에는 순위가 아니라 진행률을 넘긴다. 순위는 한 판에 예닐곱 번 뒤집히고
  // 그때마다 목표가 다른 레인으로 튀기 때문이다 — camera.js 의 설명 참고.
  const order = [...race.runners].sort((a, b) => b.pos - a.pos);
  const f1 = order[0].pos / TRACK;
  const third = order[Math.min(2, order.length - 1)];
  const pa = T.place(order[0].c.lane, f1);
  const pb = T.place(third.c.lane, third.pos / TRACK);
  camera.setField({
    f1, f3: third.pos / TRACK, laps,
    spread: Math.hypot(pa.x - pb.x, pa.z - pb.z),     // 선두 무리가 얼마나 벌어졌나 → 줌
    boost: order.slice(0, 3).some(st => race.boosting(st)),
    over: race.finished.length > 0,
  });

  fx.update(dt, fxList);
  camera.update(dt);
  labels.update(camera.cam, fxList, opt.h);
  // 안개를 「보는 거리」에 맞춰 따라 옮긴다. 고정값으로 두면 「전체」 시점에서
  // 카메라가 9000쯤 물러날 때 경기장이 통째로 안개에 지워진다.
  const r = camera.range;
  scene.fog.near = r * 1.2;
  scene.fog.far = r * 1.2 + M.fogSpan;
  renderer.render(scene, camera.cam);
  // 매 프레임 부르지만 바뀐 값만 DOM 에 쓴다 (hud.js 참고).
  hud.update(race);
  // 결과창과 같은 말을 쓴다. 트로피 이모지는 기기마다 모양이 달라 안 쓰기로 했다.
  if (race.finished.length) setStatus('WINNER  ' + race.finished[0].c.name);
  else if (running && laps > 1) setStatus(Math.min(laps, Math.floor(f1 * laps) + 1) + ' / ' + laps + LAP_WORD);
  if (race.over) { hud.showResult(race); setRunning(false); }
  requestAnimationFrame(frame);
}

// ── 상태 줄 ────────────────────────────────────────
// 매 프레임 불릴 수 있으므로 같은 글자면 DOM 을 건드리지 않는다.
let lastStatus = null;
function setStatus(s) {
  if (s === lastStatus) return;
  lastStatus = s;
  document.getElementById('status').textContent = s;
}

// ── 조작 ────────────────────────────────────────────
function fit() {
  const w = holder.clientWidth, h = holder.clientHeight;
  renderer.setSize(w, h, false);
  camera.resize(w / h);
}
addEventListener('resize', fit);

// 달리는 중에는 레인을 못 섞는다. 상태를 한 곳에서 바꿔야 버튼과 어긋나지 않는다.
const laneBtn = document.getElementById('lanes');
function setRunning(v) {
  running = v;
  if (laneBtn) laneBtn.disabled = v;
}
const startBtn = document.getElementById('start');
const LAP_WORD = document.getElementById('lapRow')?.dataset.word || ' laps';
document.getElementById('start').onclick = e => {
  setRunning(true); e.target.disabled = true;
  setStatus(laps > 1 ? '1 / ' + laps + LAP_WORD : startBtn.dataset.running || '');
};

// 바퀴 수. 바꾸면 판 길이가 달라지므로 레이스를 다시 뽑는다.
const durEl = document.getElementById('dur');
function showDur() {
  if (durEl) durEl.textContent = (TUNE.seconds * laps).toFixed(0) + (durEl.dataset.unit || 's');
}
// 바퀴 수는 숫자로 직접 넣는다. 값이 바뀌면 판 길이가 달라지므로 레이스를 다시 뽑는다.
const lapIn = document.getElementById('lapn');
if (lapIn) {
  lapIn.max = MAX_LAPS;
  lapIn.value = laps;
  lapIn.oninput = () => {
    const v = parseInt(lapIn.value, 10);
    if (!Number.isFinite(v)) return;        // 지우는 중일 수 있다. 빈 칸은 blur 에서 정리한다
    laps = setLaps(v);
    showDur();
    newRace();
  };
  lapIn.onblur = () => { lapIn.value = laps; };
}
showDur();
document.getElementById('again').onclick = newRace;
document.getElementById('shuffle').onclick = shuffleGaits;
laneBtn.onclick = () => { if (!running) shuffleLanes(); };
const nameBtn = document.getElementById('names');
if (nameBtn) nameBtn.onclick = e => {
  labels.setVisible(!labels.on);
  e.target.classList.toggle('on', labels.on);
};
document.querySelectorAll('.sp').forEach(b => b.onclick = () => {
  speed = +b.dataset.sp;
  document.querySelectorAll('.sp').forEach(x => x.classList.toggle('on', x === b));
});
// 자동 연출과 손으로 고른 시점은 서로 배타적이다.
// 다만 「끌기」는 자동을 끄지 않는다 — 잠깐 들여다보고 손 떼면 3초 뒤 알아서 돌아온다.
const autoBtn = document.getElementById('auto');
function setAuto(on) {
  camera.auto = on;
  if (autoBtn) autoBtn.classList.toggle('on', on);
  document.querySelectorAll('.vw').forEach(x => x.classList.remove('on'));
  if (on) { camera.shot = null; camera.idle = 1e9; }   // 다음 프레임에 바로 연출 시작
}
if (autoBtn) autoBtn.onclick = () => setAuto(!camera.auto);
document.querySelectorAll('.vw').forEach(b => b.onclick = () => {
  setAuto(false);
  b.classList.add('on');
  camera.apply(VIEWS[b.dataset.view]);
});

// 마우스·터치 — 끌면 각도, 휠이나 두 손가락은 당기고 밀기.
const cv = renderer.domElement;
const pts = new Map();
let pinch = 0, lastMove = 0;
cv.style.cursor = 'grab';

const span = () => {
  const [a, b] = [...pts.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
cv.addEventListener('pointerdown', e => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cv.setPointerCapture(e.pointerId);
  cv.style.cursor = 'grabbing';
  if (pts.size === 2) pinch = span();
});
cv.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size >= 2) {                       // 핀치 줌 — 터치에는 휠이 없다
    const d = span();
    if (pinch > 0 && d > 0) camera.dolly(pinch / d);
    pinch = d;
  } else {
    camera.orbit(dx, dy, cv.clientWidth, cv.clientHeight);
    lastMove = performance.now();
  }
});
const lift = e => {
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = 0;
  if (pts.size === 0) {
    cv.style.cursor = 'grab';
    // 멈춘 채로 뗐으면 관성을 주지 않는다. 안 그러면 한참 전 움직임이 되살아난다.
    if (performance.now() - lastMove > 90) camera.spin = 0;
  }
};
cv.addEventListener('pointerup', lift);
cv.addEventListener('pointercancel', lift);
cv.addEventListener('wheel', e => {
  e.preventDefault();
  camera.dolly(Math.exp(e.deltaY * 0.0012));
}, { passive: false });
cv.addEventListener('dblclick', () => {
  const on = document.querySelector('.vw.on');
  if (on) camera.apply(VIEWS[on.dataset.view]);
  else setAuto(true);
});

// ── 시작 ────────────────────────────────────────────
// 참가자 칸. 「적용」 버튼은 없다 — 고치는 즉시, 그리고 **바뀐 것에 따라 필요한 만큼만**
// 다시 만든다. 비용은 entry.js 주석 참고 (인원 14.1ms / 가중치 0.01ms / 이름은 글자만).
const entry = makeEntry({
  list: entriesEl,
  addBtn: document.getElementById('add'),
  count: document.getElementById('count'),
  max: T.MAX_LANES,
  onName(i, name) {
    if (!cands[i]) return;
    cands[i].name = name;
    labels.build(cands);        // 이름표와 순위판 글자만. 레이스는 건드리지 않는다
    hud.build(cands);
  },
  onWeight(i, w) {
    if (!cands[i] || cands[i].w === w) return;
    cands[i].w = w;
    newRace();                  // 가중치가 바뀌면 승자를 다시 뽑아야 한다
  },
  onCount(v) {
    makeCands(v);
    buildTrack();               // 레인 수가 바뀌면 트랙 도형이 통째로 달라진다
    buildRunners();
    newRace();
  },
});
entry.set(DEFAULTS);

makeCands(DEFAULTS);
buildTrack();
buildRunners();
newRace();
setAuto(true);                     // 처음엔 자동 연출. 만지면 그때부터 손이 이긴다
fit();
requestAnimationFrame(frame);
