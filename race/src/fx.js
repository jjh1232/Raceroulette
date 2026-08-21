import * as THREE from '../vendor/three.module.min.js';

// 부스터 효과. 두 가지를 같이 쓴다 — 하나만 쓰면 밋밋하다.
//
//   속도선  주자 뒤로 흘러나가 사라지는 짧은 선분들. 「빨라졌다」를 만드는 건
//           캐릭터가 아니라 곁을 스쳐 지나가는 것들이다 (트랙 눈금을 넣은 이유와 같다).
//   잔상    지나온 자리에 몸통·머리만 반투명으로 남긴다. 「막 이동한다」는 느낌은
//           여기서 나온다. 팔다리까지 복제하면 도형 수가 여덟 배가 되므로 몸통과 머리만 쓴다.
//
// 둘 다 도형을 미리 만들어 두고 돌려 쓴다. 매 프레임 new 하면 GC 가 튀어 프레임이 끊긴다.

const STREAKS = 420;        // 선분 풀 크기 (여덟 명이 동시에 부스터를 켜도 남는다)
const LIFE = 380;           // ms — 선분 하나가 사는 시간
const RATE = 0.075;         // ms 당 스폰 개수 (주자 1명 기준 → 프레임당 약 1.2개)
const DRIFT = 1100;         // 선분이 뒤로 흘러가는 속도 (월드 단위/초)
const LEN0 = 210;           // 태어날 때 길이

const GHOSTS = 3;           // 주자당 잔상 개수
const GHOST_MS = 70;        // 잔상 하나당 몇 ms 전의 자리인가
const GHOST_A = [0.30, 0.19, 0.10];
const HIST_MS = 30;         // 위치 기록 간격
const HIST = Math.ceil((GHOSTS + 1) * GHOST_MS / HIST_MS) + 2;

// bg  선분이 사라질 때 섞여 들어갈 색 (배경색과 같아야 페이드로 보인다)
// hot 선분 머리 쪽 색. 어두운 배경에서는 흰색이지만, 밝은 배경에서는 어두워야 보인다.
export function makeBoostFx(scene, bg = 0x11141a, hot = 0xffffff) {
  const back = new THREE.Color(bg);
  const heat = new THREE.Color(hot);

  // ── 속도선 ────────────────────────────────────────
  const pos = new Float32Array(STREAKS * 6);
  const col = new Float32Array(STREAKS * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  lines.frustumCulled = false;      // 선분이 매 프레임 옮겨다녀서 경계상자가 의미 없다
  scene.add(lines);

  // 살아있는 것만 앞쪽에 모아 두고 drawRange 로 자른다.
  // dr·ln 은 선분마다 다르다. 부스터 속도선은 길고 빠르게 흐르고,
  // 헛디딜 때 이는 먼지는 짧고 느리게 퍼진다 — 같은 풀을 쓰되 성질만 바꾼다.
  const s = Array.from({ length: STREAKS }, () => ({
    x: 0, y: 0, z: 0, dx: 0, dz: 0, dr: DRIFT, ln: LEN0, age: 0, c: new THREE.Color(),
  }));
  let alive = 0, acc = 0;

  function spawn(x, z, heading, color, scale) {
    if (alive >= STREAKS) return;
    const k = s[alive++];
    // 뒤 = 주자가 보는 방향의 반대. runner.js 의 약속대로 정면은 (cos h, -sin h).
    const bx = -Math.cos(heading), bz = Math.sin(heading);
    const px = -bz, pz = bx;                       // 좌우로 흩뿌릴 축
    const side = (Math.random() - 0.5) * 90 * scale;
    k.x = x + px * side + bx * 20 * scale;
    k.y = (18 + Math.random() * 78) * scale;
    k.z = z + pz * side + bz * 20 * scale;
    k.dx = bx; k.dz = bz;
    k.dr = DRIFT; k.ln = LEN0;
    k.age = 0;
    k.c.set(color).lerp(heat, 0.45);
  }

  // 발을 헛디딘 자리에서 이는 먼지. 사방으로 짧게 퍼진다.
  function puff(x, z, scale, color) {
    for (let i = 0; i < 16; i++) {
      if (alive >= STREAKS) return;
      const k = s[alive++];
      const a = Math.random() * Math.PI * 2;
      k.dx = Math.cos(a); k.dz = Math.sin(a);
      k.x = x; k.y = (6 + Math.random() * 26) * scale; k.z = z;
      k.dr = 190 + Math.random() * 160;
      k.ln = 46 + Math.random() * 40;
      k.age = 0;
      k.c.set(color).lerp(heat, 0.25);
    }
  }

  // ── 잔상 ──────────────────────────────────────────
  // 주자마다 { 기록, 잔상 오브젝트 } 를 들고 있는다.
  const rig = new Map();

  function register(runner) {
    if (rig.has(runner) || !runner.ghost) return;
    const ghosts = [];
    for (let i = 0; i < GHOSTS; i++) {
      const o = new THREE.Object3D();
      for (const src of [runner.ghost.torso, runner.ghost.head]) {
        const m = new THREE.Mesh(src.geometry, new THREE.MeshBasicMaterial({
          color: runner.spec.color, transparent: true, opacity: GHOST_A[i], depthWrite: false,
        }));
        m.position.copy(src.position);
        m.scale.copy(src.scale);
        o.add(m);
      }
      o.visible = false;
      scene.add(o);
      ghosts.push(o);
    }
    rig.set(runner, { ghosts, hist: [], t: 0, wasDip: false });
  }

  // list = [{ runner, x, z, heading, scale, boosting }]
  function update(dt, list) {
    // 속도선 — 나이 먹이고 죽은 것은 뒤에서 당겨 메운다.
    for (let i = 0; i < alive; i++) {
      const k = s[i];
      k.age += dt;
      if (k.age >= LIFE) { s[i] = s[--alive]; s[alive] = k; i--; }
    }
    // 스폰은 「몇 개 낼 차례인가」를 누적해서 센다. 남은 소수점을 다음 프레임으로
    // 넘겨야 프레임 길이가 흔들려도 초당 개수가 같다.
    acc += dt * RATE;
    const born = Math.floor(acc);
    if (born > 0) acc -= born;

    for (const it of list) {
      const st = rig.get(it.runner);
      if (st) {
        st.t += dt;
        if (st.t >= HIST_MS) {
          st.t = 0;
          st.hist.unshift({ x: it.x, z: it.z, h: it.heading, s: it.scale });
          if (st.hist.length > HIST) st.hist.length = HIST;
        }
        st.ghosts.forEach((g, i) => {
          const n = Math.round((i + 1) * GHOST_MS / HIST_MS);
          const p = it.boosting ? st.hist[n] : null;
          g.visible = !!p;
          if (p) {
            g.position.set(p.x, 0, p.z);
            g.rotation.y = p.h;
            g.scale.setScalar(p.s);
          }
        });
      }
      // 헛디디기 시작하는 순간에 한 번만 먼지를 낸다.
      if (st && it.stumbling && !st.wasDip) puff(it.x, it.z, it.scale, it.dust ?? it.color);
      if (st) st.wasDip = !!it.stumbling;

      if (!it.boosting) continue;
      for (let n = 0; n < born; n++) spawn(it.x, it.z, it.heading, it.color, it.scale);
    }

    // 버퍼에 옮겨 담는다.
    for (let i = 0; i < alive; i++) {
      const k = s[i], a = k.age / LIFE;
      const trav = k.dr * (k.age / 1000);
      const len = k.ln * (1 - a * 0.65);
      const hx = k.x + k.dx * trav, hz = k.z + k.dz * trav;
      const o = i * 6;
      pos[o] = hx; pos[o + 1] = k.y; pos[o + 2] = hz;
      pos[o + 3] = hx + k.dx * len; pos[o + 4] = k.y; pos[o + 5] = hz + k.dz * len;
      // 알파를 못 쓰는 재질이라 배경색 쪽으로 섞어서 사라지게 한다.
      // 배경이 단색이라 눈에는 페이드로 보인다.
      const head = k.c.clone().lerp(back, a);
      const tail = k.c.clone().lerp(back, Math.min(1, a * 0.55 + 0.45));
      col[o] = head.r; col[o + 1] = head.g; col[o + 2] = head.b;
      col[o + 3] = tail.r; col[o + 4] = tail.g; col[o + 5] = tail.b;
    }
    geo.setDrawRange(0, alive * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  function clear() {
    alive = 0;
    geo.setDrawRange(0, 0);
    for (const st of rig.values()) st.ghosts.forEach(g => (g.visible = false));
  }

  // 주자를 다시 만들면(섞기) 옛 잔상은 버린다.
  function reset() {
    for (const st of rig.values()) st.ghosts.forEach(g => {
      scene.remove(g);
      g.children.forEach(m => m.material.dispose());   // 도형은 원본과 공유하니 재질만 버린다
    });
    rig.clear();
    clear();
  }

  return { register, update, clear, reset };
}
