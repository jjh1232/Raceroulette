// 화면 위에 겹치는 순위판과 결과창.
//
// 3D 안에 그리지 않고 HTML 로 겹친다. 글자가 또렷하고(캔버스 텍스처는 확대하면 뭉갠다),
// 도형·드로우콜이 하나도 안 늘고, 글꼴·줄바꿈을 브라우저가 알아서 한다.
//
// **매 프레임 innerHTML 을 다시 쓰지 않는다.** 예전 곁판이 그러고 있었는데, 초당 60번
// 여덟 줄을 새로 파싱하는 짓이다. 여기서는 줄을 한 번 만들어 두고 바뀐 것만 건드린다.
//
// 순위가 바뀌면 줄을 옮기는 대신 `transform: translateY` 만 바꾼다. DOM 순서는 그대로라
// 브라우저가 레이아웃을 다시 계산하지 않고, CSS transition 이 붙어서 미끄러지듯 자리를 바꾼다.
const ROW = 23;   // 한 줄 높이(px). styles.css 의 .hud-row 와 같아야 한다

const hex = c => '#' + c.toString(16).padStart(6, '0');

export function makeHud(stage, onAgain) {
  const hud = document.createElement('div');
  hud.className = 'hud';
  const board = document.createElement('div');
  board.className = 'hud-board';
  hud.appendChild(board);

  // 바퀴 표시. 한 바퀴짜리 판에서는 「1 / 1」이 아무 정보도 아니라 아예 안 띄운다.
  const laps = document.createElement('div');
  laps.className = 'laps';
  laps.hidden = true;

  const result = document.createElement('div');
  result.className = 'result';
  result.hidden = true;

  stage.appendChild(hud);
  stage.appendChild(laps);
  stage.appendChild(result);

  let rows = [];
  let shown = false;
  let lapText = null;

  function build(cands) {
    board.textContent = '';
    rows = cands.map(c => {
      const el = document.createElement('div');
      el.className = 'hud-row';
      // 주법 이름은 안 쓴다. 어떻게 달리는지는 화면을 보면 알고, 순위판은 좁다.
      el.innerHTML = '<span class="rk"></span><span class="dot"></span>'
        + '<span class="nm"></span><span class="bs"></span>';
      el.querySelector('.dot').style.background = hex(c.color);
      el.querySelector('.nm').textContent = c.name;
      board.appendChild(el);
      return {
        c, el,
        rk: el.querySelector('.rk'), bs: el.querySelector('.bs'),
        rank: 0, boosts: -1, done: null,
      };
    });
    board.style.height = rows.length * ROW + 'px';
  }

  /**
   * 바퀴 표시를 갱신한다. **꼴찌 기준이다** — 선두가 2바퀴째에 들어섰다고 「2/2」라고 쓰면
   * 아직 1바퀴째인 사람이 있는데 마지막 바퀴라고 말하는 셈이 된다.
   * 꼴찌 기준이면 「모두가 최소 이 바퀴에는 들어와 있다」가 된다.
   */
  function setLaps(now, total) {
    if (total <= 1) { laps.hidden = true; return; }
    const t = now + ' / ' + total;
    if (t === lapText) return;          // 매 프레임 DOM 을 건드리지 않는다
    lapText = t;
    laps.innerHTML = '<b>' + now + '</b><span class="sep">/</span>' + total;
    laps.hidden = false;
  }

  // 매 프레임 불린다. 바뀐 것만 쓴다 — 안 그러면 여기가 제일 무거운 코드가 된다.
  function update(race) {
    for (const st of race.runners) {
      const r = rows[st.i];
      if (!r) continue;
      if (st.rank !== r.rank) {
        r.rank = st.rank;
        r.rk.textContent = st.rank;
        r.el.style.transform = 'translateY(' + (st.rank - 1) * ROW + 'px)';
      }
      if (st.boosts !== r.boosts) {
        r.boosts = st.boosts;
        r.bs.textContent = '⚡'.repeat(st.boosts);
      }
      if (st.done !== r.done) {
        r.done = st.done;
        r.el.classList.toggle('done', st.done);
      }
    }
  }

  function showResult(race) {
    if (shown) return;
    shown = true;
    const order = [...race.runners].sort((a, b) => a.place - b.place);
    const win = order[0];
    result.textContent = '';
    const card = document.createElement('div');
    card.className = 'result-card';
    // 트로피 그림 대신 글자로 간다. 이모지는 기기마다 모양이 달라서
    // 어디서는 납작한 컵, 어디서는 알록달록한 그림이 된다.
    card.innerHTML = '<div class="winlabel">WINNER</div>'
      + '<div class="win"></div><ol class="final"></ol>';
    const w = card.querySelector('.win');
    w.textContent = win.c.name;
    w.style.color = hex(win.c.color);
    const ol = card.querySelector('.final');
    for (const r of order) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rk"></span><span class="dot"></span><span class="nm"></span>';
      li.querySelector('.rk').textContent = r.place;
      li.querySelector('.dot').style.background = hex(r.c.color);
      li.querySelector('.nm').textContent = r.c.name;
      ol.appendChild(li);
    }
    const btn = document.createElement('button');
    // 버튼 글자는 이미 있는 「다시」 버튼에서 가져온다. 언어판마다 따로 관리하지 않으려고.
    const again = document.getElementById('again');
    btn.textContent = again ? again.textContent : '↻';
    btn.onclick = onAgain;
    card.appendChild(btn);
    result.appendChild(card);
    result.hidden = false;
    // 다음 프레임에 클래스를 붙여야 transition 이 걸린다 (붙자마자 바꾸면 브라우저가 합친다).
    requestAnimationFrame(() => result.classList.add('in'));
  }

  function hideResult() {
    shown = false;
    result.hidden = true;
    result.classList.remove('in');
  }

  return { build, update, setLaps, showResult, hideResult };
}
