import * as THREE from '../vendor/three.module.min.js';
import { LANES, LANE_R0, LANE_GAP, STRAIGHT, laneRadius, perimeter, pointAt } from './track.js';

// 배경. 트랙 자체(바닥·레인선·결승선·눈금)는 main.js 가 그대로 그리고, 여기서는 그 바깥만 채운다.
//
// ── 나무를 어디에 심을 수 있나 ────────────────────────────────
// 아무 데나 심으면 카메라와 주자 사이에 들어와 경기를 가린다. 그래서 먼저 쟀다 —
// 「전체」 시점을 빼면 카메라는 **트랙 중심선 기준 반지름 628 ~ 3009** 안에만 머문다
// (옆에서 2864, 자동 연출 최대 3009).
//
// 그래서 나무는 **바깥에만** 심는다. 인필드 한가운데에도 심어 봤는데, 「골대에서」 시점이
// 결승선에 낮게(높이 322) 붙어 반대편을 건너다보기 때문에 1600프레임 중 1031프레임을
// 가렸다. 인필드는 비워 두는 게 맞다 — 대신 바닥 색을 나눠서 허전함을 던다.
//
// 바깥 숲의 안쪽 끝은 3900 이다. 추격 카메라가 가장 멀어지는 경우가
// 「옆에서」 샷이 최대로 줌아웃했을 때로 1597 + 1300×1.6×cos13° = 3623 이라,
// 거기에 여유를 조금 더 준 값이다. 손으로 더 끌어내면 숲으로 들어갈 수 있는데,
// 그건 사용자가 일부러 한 것이라 그대로 둔다.
//
// ── 비용 기준 ────────────────────────────────────────────────
// 정적 파일이라 서버 연산은 0 이고, 실제로 드는 건 다운로드 용량과 드로우콜 둘뿐이다.
// 그래서 **이미지 파일을 한 장도 쓰지 않고**(체크무늬는 CanvasTexture 로 코드에서 그린다),
// 같은 도형은 전부 InstancedMesh 로 찍는다 — 나무 900그루가 드로우콜 세 개다.
// 배경에는 그림자를 켜지 않는다. 그림자를 던지는 물체는 한 프레임에 두 번 그려진다.

const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];

// 분위기는 숫자 묶음 하나로 정해진다. main.js 에서 MOODS.sunset 으로 바꾸면 전부 따라간다.
// fogSpan — 안개가 완전히 먹기까지의 거리. 숲이 3900 밖에 있어서 좁게 잡으면
// 나무가 통째로 하늘색에 묻힌다. 밤은 좁게(가까이서 어둠에 잠기는 게 맞다), 낮은 넓게.
export const MOODS = {
  day: {
    skyTop: 0x3d8fd8, skyBottom: 0xbfe4f5, fog: 0xc8e6f2, fogSpan: 26000,
    hemiSky: 0xeaf6ff, hemiGround: 0x7a8f5a, hemiInt: 1.25,
    sun: 0xfff4d8, sunInt: 1.5,
    track: 0xe0714a, infield: 0x62b552, floor: 0x7cc45f,   // 화사한 벽돌빛 트랙 + 밝은 잔디
    laneLine: 0xfbfdff, tick: 0xffffff,
    streak: 0x27384a,                                       // 밝은 배경에서는 속도선이 어두워야 보인다
    patch: [0x8ccd6a, 0x6dbb58, 0x9ed67c],                  // 바닥 색 띠
    bark: 0x7a5638, leaf: [0x4e9e42, 0x63b355, 0x3d8a3a, 0x7cc266, 0x2f7a35],
    cloud: 0xffffff,
    peel: 0xf7e878, peelIn: 0xe8c94a, dust: 0xfff4cf,   // 바나나 껍질
  },
  sunset: {
    skyTop: 0x2c3f77, skyBottom: 0xf0a86a, fog: 0xe9b98a, fogSpan: 17000,
    hemiSky: 0xffd9b0, hemiGround: 0x6a5340, hemiInt: 1.1,
    sun: 0xffc98a, sunInt: 1.35,
    track: 0xc95f3f, infield: 0x4e8f4a, floor: 0x679a52,
    laneLine: 0xfff0e0, tick: 0xffe8d0,
    streak: 0x3a2436,
    patch: [0x76a95c, 0x5d9150, 0x87b86a],
    bark: 0x5f4230, leaf: [0x3f7d3a, 0x53914a, 0x35682f, 0x6a9d55, 0x2a5f2c],
    cloud: 0xffd9b8,
    peel: 0xe8d06a, peelIn: 0xd0ae44, dust: 0xffe6b8,
  },
};

// 안쪽 반지름은 레인 수와 무관하지만 바깥은 아니다. 바깥을 쓰는 것들은
// 레인이 바뀔 때마다 다시 만들어야 해서 layout() 안에 있다.
const IN_R = LANE_R0 - LANE_GAP / 2;

const FOREST_R = [3900, 8400];     // 바깥 숲. 안쪽 끝 근거는 위 주석 참고
const SEG = 160;

const ringPts = (r, n) => {
  const P = perimeter(r), out = [];
  for (let k = 0; k <= n; k++) out.push(pointAt(r, (k / n) * P));
  return out;
};

// 두 고리 사이를 띠로 잇는다. 납작하게 쓰면 바닥 색 띠, 높이를 주면 벽이 된다.
function band(r0, y0, r1, y1, color, n = SEG) {
  const a = ringPts(r0, n), b = ringPts(r1, n);
  const pos = [];
  for (let k = 0; k < n; k++) {
    const p0 = a[k], p1 = a[k + 1], q0 = b[k], q1 = b[k + 1];
    pos.push(p0.x, y0, p0.z, q0.x, y1, q0.z, q1.x, y1, q1.z);
    pos.push(p0.x, y0, p0.z, q1.x, y1, q1.z, p1.x, y0, p1.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

// 하늘 — 큰 구 하나에 위아래로 색을 섞는다. 셰이더도 이미지도 없이 그라디언트가 나온다.
function skyDome(mood) {
  const R = 26000;
  const g = new THREE.SphereGeometry(R, 32, 20);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(mood.skyTop), bot = new THREE.Color(mood.skyBottom);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(bot).lerp(top, THREE.MathUtils.smoothstep(pos.getY(i) / R, -0.15, 0.65));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // fog: false — 하늘까지 안개에 먹으면 지평선이 사라진다.
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
}

// 나무 — 기둥 하나, 잎 두 종류(원뿔 침엽수 · 덩어리 활엽수). 셋 다 InstancedMesh 라
// 몇 백 그루를 심어도 드로우콜은 세 개다. 개별 메시로 만들면 여기서만 1800개가 된다.
function forest(mood) {
  const spots = [];
  const put = (rr, scale, n) => {
    for (let i = 0; i < n; i++) {
      // 안쪽에 촘촘하고 바깥으로 갈수록 성글게 — 지수를 씌우면 그렇게 된다.
      const r = lerp(rr[0], rr[1], Math.pow(Math.random(), 1.7));
      const p = pointAt(r, Math.random() * perimeter(r));
      spots.push({ x: p.x, z: p.z, s: rnd(scale[0], scale[1]), cone: Math.random() < 0.45 });
    }
  };
  put(FOREST_R, [0.85, 1.9], 900);   // 멀리 있으니 조금 크고 촘촘해야 숲으로 읽힌다

  const cones = spots.filter(s => s.cone), blobs = spots.filter(s => !s.cone);
  const trunkG = new THREE.CylinderGeometry(11, 17, 140, 5);
  const coneG = new THREE.ConeGeometry(115, 330, 7);
  const blobG = new THREE.IcosahedronGeometry(125, 0);

  const trunks = new THREE.InstancedMesh(trunkG,
    new THREE.MeshLambertMaterial({ color: mood.bark }), spots.length);
  const coneM = new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial(), cones.length);
  const blobM = new THREE.InstancedMesh(blobG, new THREE.MeshLambertMaterial(), blobs.length);

  const o = new THREE.Object3D(), c = new THREE.Color();
  spots.forEach((t, i) => {
    o.position.set(t.x, 70 * t.s, t.z);
    o.rotation.set(0, Math.random() * 6.283, 0);
    o.scale.setScalar(t.s);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
  });
  const fill = (mesh, list, y) => list.forEach((t, i) => {
    o.position.set(t.x, y * t.s, t.z);
    o.rotation.set(0, Math.random() * 6.283, 0);
    // 잎은 조금 눌러 놓아야 나무처럼 보인다. 정확한 구는 사탕처럼 보인다.
    o.scale.set(t.s * rnd(0.85, 1.15), t.s * rnd(0.8, 1.1), t.s * rnd(0.85, 1.15));
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c.set(pick(mood.leaf)).multiplyScalar(rnd(0.82, 1.12)));
  });
  fill(coneM, cones, 290);
  fill(blobM, blobs, 235);

  for (const m of [trunks, coneM, blobM]) {
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
  }
  return [trunks, coneM, blobM];
}

// 구름 — 덩어리 몇 개를 높이 띄운다. 안개를 안 먹여야 하늘에 붙어 있는 것처럼 보인다.
function clouds(mood) {
  const N = 46;
  const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: mood.cloud, fog: false, transparent: true, opacity: 0.92 }), N);
  const o = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.283, r = rnd(3000, 15000);
    o.position.set(Math.cos(a) * r, rnd(3200, 6400), Math.sin(a) * r);
    o.rotation.set(0, Math.random() * 6.283, 0);
    o.scale.set(rnd(420, 1100), rnd(150, 300), rnd(380, 900));
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  }
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}

// 결승선 바닥의 체크무늬. 이미지 파일이 아니라 코드로 그린다 — 다운로드 0바이트.
function finishChecker(OUT_R) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = ((x + y) & 1) ? '#ffffff' : '#2b3340';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 12);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(120, OUT_R - IN_R),
    new THREE.MeshBasicMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.9, -(OUT_R + IN_R) / 2);   // 트랙 표면(0.5)과 레인선(1.2) 사이
  return m;
}

export function buildScenery(scene, mood) {
  const g = new THREE.Group();
  // 하늘·구름·숲은 레인 수와 무관하다. 한 번만 만든다 —
  // 인원을 바꿀 때마다 나무 900그루를 다시 심으면 그때마다 화면이 걸린다.
  g.add(skyDome(mood));
  g.add(clouds(mood));
  g.add(...forest(mood));
  g.add(band(60, 0.3, IN_R - 40, 0.3, mood.patch[2]));   // 인필드 색 띠도 안쪽이라 고정

  const ground = new THREE.Group();
  g.add(ground);
  scene.add(g);

  // 레인 수가 바뀌면 트랙 바깥 색 띠와 결승선 체크무늬만 다시 만든다 (도형 세 개).
  function layout(outR) {
    for (const m of ground.children) { m.geometry.dispose(); m.material.dispose(); }
    ground.clear();
    // 트랙과 숲 사이는 카메라가 지나다니는 곳이라 납작한 색 띠만 깐다. 잔디가 한 가지 색이면
    // 넓은 데가 죄다 단색이 되어 평평해 보인다.
    ground.add(band(outR + 30, 0.3, outR + 520, 0.3, mood.patch[0]));
    ground.add(band(outR + 520, 0.2, FOREST_R[0], 0.2, mood.patch[1]));
    if (typeof document !== 'undefined') ground.add(finishChecker(outR));
  }

  return { group: g, layout };
}
