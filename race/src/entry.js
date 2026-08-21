// 참가자 입력 — 이름과 부스터 개수.
//
// **「적용」 버튼이 없다. 고치는 즉시 반영된다.** 비용을 재보고 그렇게 했다:
//
//   인원이 바뀔 때   12명을 통째로 다시 만들어도 14.1ms — 60fps 한 프레임(16.7ms) 안이다
//   가중치가 바뀔 때  추첨만 다시 하면 되므로 0.01ms
//   이름이 바뀔 때   이름표와 순위판 글자만. 레이스는 건드리지 않는다
//
// 그래서 **바뀐 것에 따라 필요한 만큼만** 다시 만든다. 이름을 고쳤다고 트랙까지
// 새로 만들면 글자 하나 칠 때마다 프레임이 끊긴다.
//
// 이름은 조금 미뤄서(160ms) 반영한다. 글자마다 캔버스에 이름표를 다시 그릴 이유가 없다.
//
// 아무것도 저장하지 않는다. 페이지 설명에 「새로 고치면 사라집니다」라고 적어 두었으므로
// localStorage 를 쓰면 그 문장이 거짓말이 된다.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NAME_DELAY = 160;

export function makeEntry(o) {
  const { list, addBtn, count, max, min = 2, onName, onWeight, onCount } = o;
  const fallback = list.dataset.fallback || 'Runner';
  const rows = [];
  let timer = 0;

  const nameOf = (r, i) => r.en.value.trim() || (fallback + ' ' + (i + 1));
  // 빈 칸이나 잘못된 값은 1 로 본다. 음수는 확률을 뒤집으므로 0 에서 자른다.
  const weightOf = r => {
    const w = parseFloat(r.ew.value);
    return Number.isFinite(w) ? clamp(w, 0, 99) : 1;
  };

  function make(name, w) {
    const el = document.createElement('div');
    el.className = 'ent';
    el.innerHTML = '<input class="en" type="text" maxlength="10" autocomplete="off">'
      + '<input class="ew" type="number" min="0" max="99" step="1">'
      + '<button class="del" type="button">×</button>';
    const r = { el, en: el.querySelector('.en'), ew: el.querySelector('.ew') };
    r.en.value = name;
    r.en.placeholder = list.dataset.ph || '';
    r.ew.value = w;

    r.en.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const i = rows.indexOf(r);
        if (i >= 0) onName(i, nameOf(r, i));
      }, NAME_DELAY);
    };
    r.ew.oninput = () => {
      const i = rows.indexOf(r);
      if (i >= 0) onWeight(i, weightOf(r));
    };
    // 칸을 떠날 때 정리한 값을 되돌려 쓴다. 「뭐가 들어간 건지」가 보여야 한다.
    r.en.onblur = () => {
      const i = rows.indexOf(r);
      r.en.value = nameOf(r, i);
      if (i >= 0) { clearTimeout(timer); onName(i, r.en.value); }
    };
    r.ew.onblur = () => { r.ew.value = weightOf(r); };
    for (const inp of [r.en, r.ew]) {
      inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    }

    el.querySelector('.del').onclick = () => {
      if (rows.length <= min) return;
      rows.splice(rows.indexOf(r), 1);
      el.remove();
      refresh();
      onCount(read());
    };
    rows.push(r);
    list.appendChild(el);
    return r;
  }

  function refresh() {
    count.textContent = rows.length + ' / ' + max;
    addBtn.disabled = rows.length >= max;
    // 최소 인원 아래로는 못 지운다. 지울 수 없는 상태를 버튼으로 보여준다.
    for (const r of rows) r.el.querySelector('.del').disabled = rows.length <= min;
  }

  function read() {
    return rows.map((r, i) => ({ name: nameOf(r, i), w: weightOf(r) }));
  }

  function set(entries) {
    for (const r of rows) r.el.remove();
    rows.length = 0;
    for (const e of entries.slice(0, max)) make(e.name, e.w);
    refresh();
  }

  addBtn.onclick = () => {
    if (rows.length >= max) return;
    const r = make('', 1);
    refresh();
    onCount(read());
    r.en.focus();
  };

  return { set, read };
}
