import * as THREE from '../vendor/three.module.min.js';

// 캐릭터 머리 위에 뜨는 이름표.
//
// Sprite 를 쓴다 — 늘 카메라를 마주보기 때문에 트랙을 돌아도 글자가 눕지 않는다.
// 글자는 CanvasTexture 로 코드에서 그린다. 이미지 파일이 아니라 다운로드가 0바이트다.
//
// 색은 테두리로만 쓰고 바탕은 어둡게 깐다. 주자 색을 바탕에 깔면 노랑·주황 주자에서
// 흰 글자가 안 읽힌다 — 여덟 색 중 셋이 밝은 색이라 그렇게 하면 절반이 안 보인다.
//
// 크기는 매 프레임 카메라 거리에 비례해 키운다. 월드 크기를 고정하면 멀리 있는 주자의
// 이름이 점이 되고, 우승자 클로즈업에서는 화면을 덮는다. 거리에 비례시키면
// 원근 투영에서 화면상 크기가 일정해진다.
const SIZE = 0.042;          // 화면 높이 대비 이름표 높이
const HEIGHT = 1.28;         // 캐릭터 키의 몇 배 위에 띄우나

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function tag(name, color) {
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  const font = '600 46px system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(name).width);
  cv.width = Math.max(96, w + 52);
  cv.height = 82;
  // 캔버스 크기를 바꾸면 컨텍스트 설정이 초기화된다. 글꼴을 다시 넣어야 한다.
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(18, 22, 30, 0.86)';
  roundRect(g, 5, 5, cv.width - 10, cv.height - 10, 26);
  g.fill();
  g.strokeStyle = '#' + color.toString(16).padStart(6, '0');
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#f4f7fb';
  g.fillText(name, cv.width / 2, cv.height / 2 + 2);
  return cv;
}

export function makeLabels(scene) {
  let sprites = [];
  let on = true;

  function clear() {
    for (const s of sprites) {
      scene.remove(s);
      s.material.map.dispose();
      s.material.dispose();
    }
    sprites = [];
  }

  // 이름이나 색이 바뀌면 다시 그린다.
  function build(cands) {
    clear();
    sprites = cands.map(c => {
      const cv = tag(c.name, c.color);
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 4;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true,
        depthTest: false, depthWrite: false,   // 다른 주자 뒤에 숨지 않게 늘 위에 그린다
        fog: false,
      }));
      s.renderOrder = 10;
      s.userData.ratio = cv.width / cv.height;
      s.visible = on;
      scene.add(s);
      return s;
    });
  }

  // list = [{ x, z, scale }] — main.js 가 매 프레임 넘겨주는 주자 위치
  function update(cam, list, height) {
    if (!on) return;
    const k = 2 * Math.tan(cam.fov * Math.PI / 360) * SIZE;
    for (let i = 0; i < sprites.length && i < list.length; i++) {
      const s = sprites[i], it = list[i];
      s.position.set(it.x, height * HEIGHT, it.z);
      const d = s.position.distanceTo(cam.position);
      const h = k * d;
      s.scale.set(h * s.userData.ratio, h, 1);
    }
  }

  function setVisible(v) {
    on = v;
    for (const s of sprites) s.visible = v;
  }

  return { build, update, setVisible, get on() { return on; } };
}
