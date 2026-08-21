// 주법 — 위상 p 를 받아 관절 각도를 돌려준다.
//
// 각도의 뜻은 prototype/run-preview.html 에서 그대로 가져왔다. 부호 규칙도 같다:
//   hip/knee/sh/elb  + 는 뒤로, − 는 앞으로
//   bob              + 가 아래
//   rot, pivot       몸통 전체 회전과 그 중심
// SVG 는 y 가 아래로 자라고 three.js 는 위로 자란다. 그 뒤집기는 runner.js 가 한 곳에서
// 처리하므로 이 파일의 숫자는 프로토타입과 1:1 로 같다 — 눈으로 맞춰본 값을 버리지 않으려고.
//
// rate 는 없앴다. 다리 속도를 따로 정하면 몸이 움직이는 속도와 어긋나 발이 미끄러진다.
// 대신 주법마다 「한 걸음에 얼마나 나아가는가」(step)만 적고, 다리 속도는 실제 이동 속도에서
// 역산한다. 성큼성큼 걷는 주법은 step 이 크고 걸음 수가 적어진다.
//
//   lock 'feet'  발이 땅을 밀어 나아간다 (기본)
//        'roll'  굴러간다 — 회전이 이동 거리 ÷ r. r 은 「굴러가는 반지름」으로,
//                몸 중심에서 바닥에 닿는 데까지의 거리다. 안 맞으면 미끄러진다.
//        'free'  발이 땅에 안 닿는다 — 이동 속도와 무관하게 일정하게 움직인다
//
// N = 오른쪽(카메라에서 가까운 쪽), F = 왼쪽.
const sin = Math.sin, cos = Math.cos, PI = Math.PI, max = Math.max;

export const GAITS = {
  // 옆으로돌기 — 팔다리를 벌린 별 모양으로 굴러간다.
  // 이 리그는 팔다리가 Z축 한 방향으로만 접혀서, 진짜 옆돌기처럼 몸을 옆으로 돌려세우면
  // 팔다리가 굴러가는 평면과 어긋난다. 그래서 정면을 보게 두고 별 모양으로 돌린다 —
  // 옆에서 보면 어차피 같은 그림이고, 이쪽이 팔다리가 제 평면에서 움직인다.
  // 굴러가려면 별이 둥글어야 한다. 네 끝점까지의 거리가 회전 내내 같아야 안 미끄러지는데,
  // 눈으로는 못 맞춘다. 다리·팔 벌림과 pivot 을 훑어서 가장 둥근 조합을 골랐다 —
  // **머리를 빼고 세면 안 된다.** 팔다리만 보고 맞췄더니 안 접히는 머리가 가장 바깥(47)이라
  // 회전할 때마다 바닥을 5 씩 파고들었다. 구르기가 r 45 인 이유도 같다 — 머리가 반지름을 정한다.
  // 머리까지 넣고 훑은 결과가 다리 ±56°, 팔 ±10°, pivot 44.5 이고, 반지름 40.9~44.5 다.
  // 처음에 눈대중으로 넣은 r 40 은 실제 48 이라 4% 미끄러지고 있었다.
  옆으로돌기: { step: 1.0, lock: 'roll', r: 43, pose: (p) => ({
    hipN: 56 + sin(p) * 5, hipF: -56 + sin(p) * 5,   // 다리를 크게 벌린 채 가위질
    kneeN: 6, kneeF: 6,
    shN: 170, shF: 190,                              // 180 이 머리 위로 곧게. 살짝만 벌린다
    elbN: 0, elbF: 0,
    bob: 0, rot: p * 57.3, pivot: 44.5,
  })},

  전력질주: { step: 1.35, pose: (p, o) => ({
    hipN: sin(p) * o.stride * 1.35,       hipF: sin(p + PI) * o.stride * 1.35,
    kneeN: o.knee * 1.15 * max(0, sin(p + 1.5)), kneeF: o.knee * 1.15 * max(0, sin(p + 1.5 + PI)),
    shN: sin(p + PI) * o.arm * 1.2,       shF: sin(p) * o.arm * 1.2,
    elbN: -70 - sin(p + PI) * o.arm * 0.3, elbF: -70 - sin(p) * o.arm * 0.3,
    bob: -o.bounce * 0.8 * (0.5 - 0.5 * cos(p * 2)), rot: o.lean * 2.2, pivot: 32,
  })},

  // 골반을 17 까지 낮추면 허벅지(17)가 바닥에 정확히 닿는다 → 무릎으로 긴다.
  // 그 자세에서 어깨가 31 높이라 팔(25)로 손이 바닥 근처까지 내려온다.
  // bob 15 는 그래서 나온 숫자다. 몸통 각도(58°)를 바꾸면 같이 조정해야 한다.
  기어가기: { step: 0.55, pose: (p, o) => ({
    hipN: -58 + sin(p) * o.stride * 0.28,  hipF: -58 + sin(p + PI) * o.stride * 0.28,
    kneeN: 80 + sin(p) * 18,               kneeF: 80 + sin(p + PI) * 18,
    shN: -50 + sin(p + PI) * o.arm * 0.75, shF: -50 + sin(p) * o.arm * 0.75,
    elbN: -15, elbF: -15,
    bob: 15 - o.bounce * 0.25 * (0.5 - 0.5 * cos(p * 2)), rot: 58, pivot: 32,
  })},

  // 물구나무서기 — 몸을 뒤집고(rot 180) 팔을 머리 위로 곧게(sh 180) 올리면
  // 손끝이 몸 좌표에서 58+25 = 83 에 오는데, 머리는 반지름까지 쳐서 89 다.
  // 머리가 늘 손보다 6 더 멀어서 「손만 딱 짚고 머리는 뜬다」가 이 몸으로는 불가능하다.
  // 그래서 머리가 바닥을 스치는 값(pivot 44.5 → 2×44.5 − 89 = 0)으로 맞췄다.
  // 손은 그보다 6 위에 오는데 손 반지름이 3 이라 거의 닿아 보인다 — 삼점 물구나무다.
  물구나무서기: { step: 0.7, pose: (p, o) => ({
    hipN: -18 + sin(p) * 24, hipF: -18 + sin(p + PI) * 24,      // 다리는 허공에서 젓는다
    kneeN: 22 + sin(p + 1.2) * 22, kneeF: 22 + sin(p + 1.2 + PI) * 22,
    shN: 180 + sin(p) * 13, shF: 180 + sin(p + PI) * 13,        // 손을 번갈아 짚는다
    // 한쪽 팔은 곧게 펴서 짚고, 다른 쪽은 크게 접어 든다 — 이게 손으로 걷는 동작이다.
    // 팔꿈치를 30°만 접으면 손이 0.9 밖에 안 올라와서 안 보인다. 90° 는 되어야 7 올라온다.
    elbN: -90 * max(0, sin(p)), elbF: -90 * max(0, sin(p + PI)),
    bob: -o.bounce * 0.45 * max(0, sin(p * 2)), rot: 180, pivot: 44.5,
  })},

  둥둥: { step: 1.0, lock: 'free', pose: (p, o) => ({
    hipN: sin(p * 0.6) * 10, hipF: sin(p * 0.6 + 0.7) * 10,
    kneeN: 18, kneeF: 12,
    shN: -14 + sin(p * 0.6 + 1) * 14, shF: -14 + sin(p * 0.6 + 1.7) * 14,
    elbN: -25, elbF: -25,
    bob: -o.bounce * 1.8 * sin(p * 0.7) - o.bounce, rot: 0, pivot: 32,
  })},

  // 팔을 크게 앞뒤로 젓는다 — 무릎도 같이 높이 든다.
  행진: { step: 1.15, pose: (p, o) => ({
    hipN: sin(p) * o.stride * 1.1,        hipF: sin(p + PI) * o.stride * 1.1,
    kneeN: o.knee * 1.3 * max(0, sin(p + 2.4)), kneeF: o.knee * 1.3 * max(0, sin(p + 2.4 + PI)),
    shN: sin(p + PI) * o.arm * 2.0,       shF: sin(p) * o.arm * 2.0,
    elbN: -8, elbF: -8,                   // 팔을 쭉 편 채로 흔든다
    bob: -o.bounce * 1.2 * (0.5 - 0.5 * cos(p * 2)), rot: o.lean * 0.3, pivot: 32,
  })},

  미끄럼: { step: 2.2, pose: (p, o) => ({
    hipN: sin(p) * o.stride * 1.5,        hipF: sin(p + PI) * o.stride * 1.5,
    kneeN: o.knee * 0.3, kneeF: o.knee * 0.3,
    shN: 130 + sin(p) * 12, shF: 130 + sin(p + PI) * 12,   // 팔은 뒤로 붙이고
    elbN: -20, elbF: -20,
    bob: -o.bounce * 0.4 * (0.5 - 0.5 * cos(p * 2)) + 4, rot: o.lean * 2.6, pivot: 32,
  })},

  // 접을 수 없는 건 머리다 — 중심에서 머리 바깥까지 45 라 이게 곧 굴러가는 반지름이다.
  // 팔다리는 그 안(27, 17)으로 말아 넣는다. pivot 44 는 몸통 한가운데.
  구르기: { step: 1.0, lock: 'roll', r: 45, pose: (p) => ({
    hipN: -115, hipF: -105, kneeN: 135, kneeF: 140,
    shN: -25, shF: -15, elbN: -115, elbF: -105,
    bob: 0, rot: p * 57.3, pivot: 44,
  })},
};

// 발을 헛디뎠을 때 잠깐 덮어쓰는 자세. **GAITS 바깥에 둔다** —
// 안에 넣으면 GAIT_NAMES 에 섞여 들어가 주자에게 배정되어 버린다.
// 몸을 앞으로 고꾸라뜨리고(rot 30, 평소 기울기 9 보다 크다) 팔을 앞으로 휘젓는다.
// 위상은 원래 주법 것을 그대로 쓰므로 ×3 으로 빠르게 흔든다 — 허둥대는 것처럼 보이라고.
export const STUMBLE = {
  step: 0.9,
  pose: (p, o) => ({
    // 두 다리가 앞으로 쏠린다 — 발이 앞으로 빠지는 미끄러짐이다.
    hipN: -62 + sin(p * 3) * 12,   hipF: -38 + sin(p * 3 + PI) * 12,
    kneeN: 8, kneeF: 30,
    // 팔은 위로 벌려 허우적댄다. 둘 다 앞으로 뻗으면 「미는」 동작으로 읽힌다 —
    // 처음에 그렇게 만들었다가 밀치기처럼 보인다는 말을 듣고 고쳤다.
    shN: -150 + sin(p * 4) * 22,   shF: 132 + sin(p * 4 + PI) * 22,
    elbN: -35, elbF: -30,
    // 뒤로 넘어간다. 다른 주자는 전부 앞으로 기울어 있어서(lean 9, 전력질주 20) 이게 제일 눈에 띈다.
    bob: o.bounce * 1.4, rot: -26, pivot: 30,     // bob 은 + 가 아래다
  }),
};
// 서 있는 자세. 어떤 주법이든 멈추면 이 모습이다.
export const REST = {
  hipN: 0, hipF: 0, kneeN: 0, kneeF: 0, shN: 0, shF: 0,
  elbN: -20, elbF: -20, bob: 0, rot: 0, pivot: 32,
};

export const GAIT_NAMES = Object.keys(GAITS);
