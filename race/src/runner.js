import * as THREE from '../vendor/three.module.min.js';
import { GAITS, REST, STUMBLE } from './gaits.js';

// 캐릭터는 기본 도형을 조립해서 만든다. 모델 파일이 없으니 저장소가 가볍고,
// 체형·머리 모양을 숫자로 바꿔가며 고를 수 있다 (프로토타입에서 그렇게 골랐다).
//
// 좌표 약속 — 트랙은 +X 로 뻗고, 레인은 Z 로 늘어서고, Y 가 위다. 캐릭터는 +X 를 본다.
// 뼈대 치수는 SVG 프로토타입과 같은 숫자를 쓰되 y 부호만 뒤집었다.
// 그래야 눈으로 맞춰둔 주법 각도를 그대로 쓸 수 있다.
const HIP_Y = 32, SHOULDER_Y = 58, HEAD_Y = 76;
const THIGH = 17, CALF = 15, UARM = 13, FARM = 12;
export const UNIT_H = 90;          // 발끝에서 머리 위까지
const LEG_Z = 5, ARM_Z = 11;       // 좌우로 벌어진 정도

const D2R = Math.PI / 180;
const LEG = THIGH + CALF;
// 다리 각도만으로 보폭을 계산하면 실제보다 짧게 나온다 — 달리기에는 두 발이 다 떠 있는
// 체공 구간이 있어서 그동안에도 몸이 나아가기 때문이다. 그 몫을 이 배수로 얹는다.
const FLIGHT = 1.8;
const ROLL_R = 45;   // 구르기 반지름. 미끄러지지 않으려면 회전 = 이동거리 ÷ 이 값

// 열두 명까지 서로 구분되어야 한다. 색상환을 고르게 돌면서 밝기를 번갈아 줬다 —
// 같은 밝기로 열둘을 놓으면 이웃한 색끼리 헷갈린다.
export const COLORS = [
  0xe05c5c, 0xe0a13c, 0xd9d24a, 0x5fbf5f,
  0x4ab8c4, 0x5a86e0, 0x9a6fe0, 0xe06fae,
  0xb5533a, 0x7fbf3f, 0x3f9e8c, 0xc06fd8,
];

export const BUILDS = {
  보통: { rx: 12, ry: 17, leg: 4.2, arm: 3.2, head: 13 },
  통통: { rx: 15, ry: 15, leg: 4.8, arm: 3.7, head: 14 },
  날씬: { rx: 9,  ry: 19, leg: 3.2, arm: 2.6, head: 11 },
  땅딸: { rx: 15, ry: 12, leg: 5.2, arm: 4.0, head: 15 },
};
export const BUILD_NAMES = Object.keys(BUILDS);

// 머리 — 3D 에서는 윤곽선 대신 형상 자체가 개성이 된다.
// 면이 적은 도형일수록 각이 살아서 멀리서도 구분된다.
export const HEADS = {
  원:     R => new THREE.SphereGeometry(R, 20, 14),
  별:     R => new THREE.OctahedronGeometry(R * 1.25),
  사각:   R => new THREE.BoxGeometry(R * 1.7, R * 1.7, R * 1.7),
  삼각:   R => new THREE.ConeGeometry(R * 1.25, R * 2.2, 4),
  육각:   R => new THREE.CylinderGeometry(R * 1.05, R * 1.05, R * 1.5, 6),
  구름:   R => new THREE.DodecahedronGeometry(R * 1.1),
  물방울: R => new THREE.ConeGeometry(R, R * 2.6, 16),
  가시:   R => new THREE.IcosahedronGeometry(R * 1.15),
};
export const HEAD_NAMES = Object.keys(HEADS);

function limb(len, r, mat) {
  // 캡슐의 원점은 한가운데다. 관절에서 아래로 뻗게 하려면 절반만큼 내린다.
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  const m = new THREE.Mesh(g, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  return m;
}

function joint(parent, y, z) {
  const o = new THREE.Object3D();
  o.position.set(0, y, z);
  parent.add(o);
  return o;
}

// 캐릭터 한 명. 반환한 객체의 setPose() 에 주법이 준 각도를 그대로 넣으면 된다.
export function makeRunner(spec) {
  const b = BUILDS[spec.build], color = spec.color;
  const skin = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.68) });
  const ink = new THREE.MeshLambertMaterial({ color: 0x15181d });
  const white = new THREE.MeshLambertMaterial({ color: 0xfdfdfd });

  // root  — 트랙 위 자리와 크기. 바깥에서 옮긴다.
  // rig   — 상하 튐(bob). root 안에 있어야 캐릭터 크기에 같이 비례한다.
  //         root 에 직접 걸면 키를 키워도 튐 폭이 그대로라 어색해진다.
  // pivot — 몸통 회전축. 주법마다 중심이 달라서(구르기는 몸 한가운데) 매 프레임 옮긴다.
  const root = new THREE.Object3D();
  const rig = new THREE.Object3D();
  root.add(rig);
  const pivot = new THREE.Object3D();
  rig.add(pivot);
  const body = new THREE.Object3D();     // pivot 을 상쇄해 캐릭터 좌표를 원래대로 돌려놓는다
  pivot.add(body);

  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), skin);
  torso.scale.set(b.rx, b.ry, b.rx * 0.85);
  torso.position.y = 44;
  torso.castShadow = true;
  body.add(torso);

  const head = new THREE.Mesh(HEADS[spec.head](b.head), skin);
  head.position.y = HEAD_Y;
  head.castShadow = true;
  body.add(head);

  // 눈은 머리 앞면(+X)에 붙인다. 어느 각도에서 봐도 방향이 읽히는 유일한 단서다.
  const eyeR = b.head * 0.18;
  [-1, 1].forEach(s => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 10, 8), white);
    e.position.set(b.head * 0.78, HEAD_Y + b.head * 0.16, s * b.head * 0.36);
    body.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.55, 8, 6), ink);
    p.position.set(b.head * 0.92, HEAD_Y + b.head * 0.14, s * b.head * 0.36);
    body.add(p);
  });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(b.head * 0.2, 10, 8), ink);
  mouth.position.set(b.head * 0.86, HEAD_Y - b.head * 0.38, 0);
  mouth.scale.set(0.5, 0.6, 1.5);
  body.add(mouth);

  // 다리 — 허벅지 관절 안에 무릎 관절. 중첩이 곧 관절이다.
  const legs = {}, arms = {};
  for (const [key, z, mat] of [['N', LEG_Z, skin], ['F', -LEG_Z, dark]]) {
    const hip = joint(body, HIP_Y, z);
    hip.add(limb(THIGH, b.leg, mat));
    const knee = joint(hip, -THIGH, 0);
    knee.add(limb(CALF, b.leg, mat));
    const foot = new THREE.Mesh(new THREE.SphereGeometry(b.leg * 1.1, 10, 8), mat);
    foot.position.set(b.leg * 0.8, -CALF, 0);
    foot.scale.set(1.5, 0.7, 1);
    knee.add(foot);
    legs[key] = { hip, knee };
  }
  for (const [key, z, mat] of [['N', ARM_Z, skin], ['F', -ARM_Z, dark]]) {
    const sh = joint(body, SHOULDER_Y, z);
    sh.add(limb(UARM, b.arm, mat));
    const elb = joint(sh, -UARM, 0);
    elb.add(limb(FARM, b.arm, mat));
    arms[key] = { sh, elb };
  }

  // 부스터 표시 — 켜질 때만 보이는 고리.
  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(b.ry + 12, 1.6, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
  aura.rotation.x = Math.PI / 2;
  aura.position.y = 44;
  aura.visible = false;
  body.add(aura);

  let phase = Math.random() * 6.283;

  return {
    root, spec, aura,
    // 잔상은 몸통과 머리만 복제한다 (fx.js). 팔다리까지 뜨면 도형이 여덟 배가 되고,
    // 빠르게 지나가는 반투명 실루엣에서는 어차피 안 읽힌다.
    ghost: { torso, head },
    get phase() { return phase; },
    // 다리 속도를 실제 이동 속도에서 역산한다 — 이게 「달리는 느낌」의 거의 전부다.
    // 따로 정하면 반드시 어긋나고, 어긋나면 발이 땅 위를 미끄러진다.
    // (직선 트랙판에서 11.4 배 미끄러지고 있었다. 문워크로 보였을 것이다.)
    // scale = 이 캐릭터가 월드에서 몇 배로 커져 있는가.
    // 뼈대 치수는 로컬 단위라 이걸 안 곱하면 키를 키울수록 다시 미끄러진다.
    advance(dt, speed, o, scale) {
      const g = GAITS[spec.gait];
      if (g.lock === 'free') {                 // 발이 땅에 안 닿으니 맞출 것도 없다
        phase += dt / 1000 * 2.4;
        return;
      }
      const dist = speed * dt / 1000;
      if (g.lock === 'roll') {                 // 굴러가기 — 미끄러지지 않는 조건
        // 반지름은 주법마다 다르다. 공처럼 만 구르기(45)와 팔다리를 벌린 옆으로돌기(40)는
        // 바닥에 닿는 거리가 달라서, 하나로 묶으면 한쪽이 미끄러진다.
        phase += dist / ((g.r ?? ROLL_R) * scale);
        return;
      }
      // 한 걸음에 나아가는 거리. 한 바퀴(2π)에 두 걸음.
      const step = Math.max(4,
        2 * LEG * scale * Math.sin(o.stride * D2R) * FLIGHT * g.step * (o.trim / 100));
      phase += (dist / (2 * step)) * Math.PI * 2;
    },
    setPose(o, moving, boosting, stumbling) {
      // 헛디디는 동안에는 주법을 덮어쓴다. 위상은 그대로 두어 다리가 이어져 보이게 한다.
      const g = stumbling ? STUMBLE : GAITS[spec.gait];
      const q = moving ? g.pose(phase, o) : REST;
      // SVG 는 y 가 아래로 자란다. three.js 로 옮기며 뒤집는 곳은 여기 한 군데뿐이다.
      pivot.position.y = q.pivot;
      body.position.y = -q.pivot;
      pivot.rotation.z = -q.rot * D2R;
      rig.position.y = -q.bob;               // bob 은 + 가 아래였다
      legs.N.hip.rotation.z = -q.hipN * D2R;
      legs.F.hip.rotation.z = -q.hipF * D2R;
      legs.N.knee.rotation.z = -q.kneeN * D2R;
      legs.F.knee.rotation.z = -q.kneeF * D2R;
      arms.N.sh.rotation.z = -q.shN * D2R;
      arms.F.sh.rotation.z = -q.shF * D2R;
      arms.N.elb.rotation.z = -q.elbN * D2R;
      arms.F.elb.rotation.z = -q.elbF * D2R;
      mouth.scale.y = stumbling ? 2.1 : boosting ? 1.6 : 0.6;   // 헛디디면 더 놀란다
      // 고리를 켜고 끄기만 하면 눈에 안 띈다. 걸음에 맞춰 뛰게 해야 「켜졌다」가 읽힌다.
      aura.visible = !!boosting;
      if (boosting) {
        // 고리의 로컬 x·y 가 고리 평면이다 (rotation.x 로 눕혀 놓았으므로).
        // z 는 굵기라 건드리지 않는다. 도넛은 축 대칭이라 돌려봐야 안 보인다 — 크기만 뛴다.
        const beat = 1 + Math.sin(phase * 2) * 0.16;
        aura.scale.set(beat, beat, 1);
      }
    },
  };
}
