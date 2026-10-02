/* 불룩한배당 — 메인 스크립트 (의존성 없음) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const FREQ_KO = { daily: '매일', weekly: '매주', monthly: '매월', quarterly: '분기', semiannual: '반기', annual: '연 1회', irregular: '비정기', unknown: '미확인', none: '없음' };
  const PER_YEAR = { daily: 252, weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, annual: 1, irregular: 1, unknown: 4 };
  const TAX = { KR: 0.846, US: 0.85 };
  const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  const state = {
    mode: 'goal', freq: 'all', mkts: new Set(['KR', 'US']), types: new Set(['etf', 'stock']),
    ymin: 3, ymax: 12, tax: 'after', fx: 1400, picks: [], // 선택된 id 목록
    candidates: [], items: [], meta: null, finderPage: 1, calMonth: new Date().getMonth() + 1,
  };

  // ---------- 숫자 포맷 ----------
  const comma = (n) => Math.round(n).toLocaleString('ko-KR');
  function won(v) { return comma(v) + '원'; }
  function big(v) { // 억/만 단위
    v = Math.round(v);
    const neg = v < 0; v = Math.abs(v);
    if (v >= 1e12) { const jo = Math.floor(v / 1e12); const eok = Math.round((v % 1e12) / 1e8); return (neg ? '-' : '') + (eok ? `${comma(jo)}조 ${comma(eok)}억원` : `${comma(jo)}조원`); }
    if (v >= 1e8) { const eok = Math.floor(v / 1e8); const man = Math.round((v % 1e8) / 1e4); return (neg ? '-' : '') + (man ? `${comma(eok)}억 ${comma(man)}만원` : `${comma(eok)}억원`); }
    if (v >= 1e4) return (neg ? '-' : '') + `${comma(v / 1e4)}만원`;
    return (neg ? '-' : '') + won(v);
  }
  const pct = (v, d = 2) => (v == null ? '-' : `${Number(v).toFixed(d)}%`);
  const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 아이템 파생값 ----------
  const priceKRW = (it) => (it.cur === 'USD' ? it.p * state.fx : it.p);
  const dpsKRW = (it) => (it.cur === 'USD' ? it.dps * state.fx : it.dps);
  const taxF = (it) => (state.tax === 'after' ? TAX[it.m] : 1);
  const perYear = (it) => it.py || PER_YEAR[it.f] || 4;
  const sizeKRW = (it) => {
    if (it.m === 'KR' && it.t === 'etf') return (it.aum || 0) * 1e8;
    if (it.mcap) return it.mcap * state.fx;
    if (it.mc) { const n = parseFloat(String(it.mc).replace(/,/g, '')); if (/조/.test(it.mc)) { const m = it.mc.match(/([\d,]+)조(?:\s*([\d,]+)억)?/); if (m) return (parseFloat(m[1].replace(/,/g, '')) * 1e12) + (m[2] ? parseFloat(m[2].replace(/,/g, '')) * 1e8 : 0); } if (/억\s*USD/.test(it.mc)) return n * 1e8 * state.fx; if (/억/.test(it.mc)) return n * 1e8; if (/USD/.test(it.mc)) return n * state.fx; }
    return 0;
  };
  const freqMatch = (it, f) => f === 'all' || it.f === f || (f === 'annual' && ['semiannual', 'annual', 'irregular'].includes(it.f));
  const monthsOf = (it) => (it.pm && it.pm.length ? it.pm : []);
  const naverUrl = (it) => (it.m === 'KR' ? `https://m.stock.naver.com/domestic/${it.t === 'etf' ? 'etf' : 'stock'}/${it.c}/total` : `https://m.stock.naver.com/search?query=${encodeURIComponent(it.c)}`);

  // ---------- 데이터 로드 ----------
  async function load() {
    const [kr, us, meta] = await Promise.all([
      fetch('/data/kr.json').then((r) => r.json()).catch(() => []),
      fetch('/data/us.json').then((r) => r.json()).catch(() => []),
      fetch('/data/meta.json').then((r) => r.json()).catch(() => ({})),
    ]);
    state.items = [...kr, ...us].filter((x) => x.p > 0 && x.y > 0);
    state.meta = meta;
    if (meta.usdkrw) { state.fx = Math.round(meta.usdkrw); $('#fx').value = state.fx; $('#fx-hint').textContent = `최근 환율 ${comma(meta.usdkrw)}원 기준 (직접 바꿀 수 있어요)`; }
    if (meta.updated) $('#updated').textContent = `데이터 갱신: ${new Date(meta.updated).toLocaleDateString('ko-KR')}`;
    renderMonthChips();
    renderFinder(true);
    renderCalendar();
    if (!restoreFromHash()) { /* 첫 방문: 기본 플랜을 보여주지 않고 입력을 기다림 */ }
  }

  // ---------- 조건 UI ----------
  function bindChips(id, single, onChange) {
    const box = $(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      if (single) { $$('.chip', box).forEach((c) => c.setAttribute('aria-pressed', c === b ? 'true' : 'false')); }
      else {
        const pressed = b.getAttribute('aria-pressed') === 'true';
        const others = $$('.chip', box).filter((c) => c !== b && c.getAttribute('aria-pressed') === 'true');
        if (pressed && !others.length) return; // 최소 1개
        b.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      }
      onChange();
    });
  }
  const pressedVals = (id) => $$('.chip[aria-pressed="true"]', $(id)).map((c) => c.dataset.v);
  function readForm() {
    state.freq = pressedVals('#freq-chips')[0] || 'all';
    state.mkts = new Set(pressedVals('#mkt-chips'));
    state.types = new Set(pressedVals('#type-chips'));
    state.tax = pressedVals('#tax-chips')[0] || 'after';
    state.ymin = parseFloat($('#ymin').value); state.ymax = parseFloat($('#ymax').value);
    if (state.ymax <= state.ymin) { state.ymax = state.ymin + 1; $('#ymax').value = state.ymax; }
    $('#yrange-label').textContent = `${state.ymin}% ~ ${state.ymax}%`;
    state.fx = Math.max(500, parseFloat($('#fx').value) || 1400);
  }
  bindChips('#freq-chips', true, readForm);
  bindChips('#mkt-chips', false, readForm);
  bindChips('#type-chips', false, readForm);
  bindChips('#tax-chips', true, readForm);
  ['#ymin', '#ymax', '#fx'].forEach((s) => $(s).addEventListener('input', readForm));
  $$('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => {
    state.mode = t.dataset.mode;
    $$('.tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', x === t ? 'true' : 'false'));
    $('#mode-goal').hidden = state.mode !== 'goal'; $('#mode-budget').hidden = state.mode !== 'budget';
  }));
  $('#run').addEventListener('click', () => { readForm(); state.picks = []; runPlan(true); });
  ['#goal', '#budget1', '#budget2', '#years'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#run').click(); }));

  // ---------- 후보 선정 ----------
  function candidates() {
    return state.items.filter((it) => state.mkts.has(it.m) && state.types.has(it.t) && freqMatch(it, state.freq) && it.y >= state.ymin && it.y <= state.ymax);
  }
  function score(it) {
    // 수익률 + 규모 + 주기 확실성. 상한 근처 초고배당은 감점.
    const size = sizeKRW(it);
    const sizeScore = size >= 1e12 ? 1 : size >= 3e11 ? 0.8 : size >= 1e11 ? 0.6 : size >= 3e10 ? 0.4 : size > 0 ? 0.2 : 0.1;
    const yScore = Math.min(it.y, 8) / 8;
    const certain = it.est ? 0 : 1;
    const histScore = it.m === 'KR' && it.t === 'etf' ? Math.min((it.h || []).length, 12) / 12 : 0.6;
    return yScore * 0.45 + sizeScore * 0.3 + certain * 0.1 + histScore * 0.15;
  }
  function familyKey(it) {
    // 같은 지수를 따르는 ETF 중복 방지용 키
    return String(it.n).replace(/^(KODEX|TIGER|RISE|KBSTAR|ACE|SOL|PLUS|ARIRANG|HANARO|KIWOOM|KOSEF|TIMEFOLIO|WON|1Q|BNK|UNICORN|KoAct)\s*/i, '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').slice(0, 10).toLowerCase();
  }
  function autoPick(cands, n = 4) {
    const sorted = [...cands].sort((a, b) => score(b) - score(a));
    const picked = [], fams = new Set(), sectors = new Set();
    // 1단계: 가족·섹터 안 겹치게
    for (const it of sorted) {
      if (picked.length >= n) break;
      const fk = familyKey(it); const sk = (it.sec || it.is || '') + it.m;
      if (fams.has(fk)) continue;
      if (it.t === 'stock' && it.sec && sectors.has(sk)) continue;
      picked.push(it); fams.add(fk); if (it.sec) sectors.add(sk);
    }
    // 2단계: 모자라면 채움
    for (const it of sorted) { if (picked.length >= n) break; if (!picked.includes(it)) picked.push(it); }
    return picked;
  }

  // ---------- 플랜 계산 ----------
  function planFor(picks) {
    const G = (parseFloat($('#goal').value) || 0) * 1e4;
    const B = state.mode === 'goal' ? (parseFloat($('#budget1').value) || 0) * 1e4 : (parseFloat($('#budget2').value) || 0) * 1e4;
    const years = Math.max(1, parseInt($('#years').value, 10) || 10);
    const n = picks.length; if (!n) return null;
    const w = 1 / n;
    const rows = picks.map((it) => ({ it, price: priceKRW(it), dps: dpsKRW(it) * taxF(it), yAfter: it.y * taxF(it) }));
    const Yp = rows.reduce((s, r) => s + w * r.yAfter, 0) / 100; // 세후 연 수익률
    const out = { rows, Yp, n, G, B, years, mode: state.mode };

    if (state.mode === 'goal') {
      const C = G * 12 / Yp;
      rows.forEach((r) => { r.shares = Math.max(1, Math.round((C * w) / r.price)); r.amount = r.shares * r.price; r.monthly = (r.shares * r.dps) / 12; });
      out.capital = rows.reduce((s, r) => s + r.amount, 0);
      out.monthly = rows.reduce((s, r) => s + r.monthly, 0);
      out.targetCapital = C;
      if (B > 0) {
        let cap = 0, m = 0; while (cap < out.capital && m < 1200) { cap = cap * (1 + Yp / 12) + B; m++; }
        out.monthsDrip = m; out.monthsPlain = Math.ceil(out.capital / B);
      }
    } else {
      let cap = 0, invested = 0; const yearly = [];
      for (let m = 1; m <= years * 12; m++) { cap = cap * (1 + Yp / 12) + B; invested += B; if (m % 12 === 0) yearly.push({ year: m / 12, invested, cap, monthly: (cap * Yp) / 12 }); }
      out.yearly = yearly; out.capital = cap; out.monthly = (cap * Yp) / 12; out.invested = invested;
      rows.forEach((r) => { r.shares = Math.max(0, Math.round((cap * w) / r.price)); r.amount = r.shares * r.price; r.monthly = (r.shares * r.dps) / 12; });
    }
    // 매수 간격 추천
    if (B > 0) {
      const lot1 = rows.reduce((s, r) => s + r.price, 0); // 각 1주씩
      const cands = [
        { k: 'weekly', label: '매주', amt: B / 4.33 }, { k: 'biweekly', label: '격주', amt: B / 2.17 }, { k: 'monthly', label: '매월', amt: B },
        { k: 'bimonthly', label: '두 달에 한 번', amt: B * 2 }, { k: 'quarterly', label: '분기에 한 번', amt: B * 3 }, { k: 'half', label: '반년에 한 번', amt: B * 6 },
      ];
      const chosen = cands.find((c) => c.amt >= lot1) || cands[cands.length - 1];
      // 1회 장바구니: 1주씩 깔고 남은 금액을 비중대로
      const basket = rows.map((r) => ({ r, shares: chosen.amt >= lot1 ? 1 : 0 }));
      let left = chosen.amt - (chosen.amt >= lot1 ? lot1 : 0);
      basket.forEach((b) => { const add = Math.floor((left * w) / b.r.price); b.shares += add; });
      const spent = basket.reduce((s, b) => s + b.shares * b.r.price, 0);
      out.cadence = { ...chosen, lot1, basket, spent, left: chosen.amt - spent, feasible: chosen.amt >= lot1 };
    }
    return out;
  }

  // ---------- 렌더: 추천 + 명세서 ----------
  function runPlan(scroll) {
    state.candidates = candidates();
    const sec = $('#result-sec'); sec.hidden = false;
    if (!state.candidates.length) {
      $('#picks').innerHTML = `<div class="empty">조건에 맞는 종목이 없어요. 배당수익률 범위를 넓히거나 배당 주기를 '상관없음'으로 바꿔 보세요.</div>`;
      $('#slip').innerHTML = ''; if (scroll) sec.scrollIntoView({ behavior: 'smooth' }); return;
    }
    const top = [...state.candidates].sort((a, b) => score(b) - score(a)).slice(0, 12);
    if (!state.picks.length) state.picks = autoPick(state.candidates, Math.min(4, state.candidates.length)).map((x) => x.id);
    // 선택된 것 중 top에 없는 건 추가로 보여줌
    const shown = [...top]; state.picks.forEach((id) => { if (!shown.find((x) => x.id === id)) { const it = state.items.find((x) => x.id === id); if (it) shown.unshift(it); } });
    $('#result-title').textContent = `추천 종목 ${state.candidates.length.toLocaleString()}개 중 상위`;
    $('#picks').innerHTML = shown.map((it) => pickRow(it, state.picks.includes(it.id))).join('');
    renderSlip();
    writeHash();
    if (scroll) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function pickRow(it, checked) {
    return `<label class="pick"><input type="checkbox" data-id="${esc(it.id)}" ${checked ? 'checked' : ''} aria-label="${esc(it.n)} 선택">
      <span class="nm"><b>${esc(it.n)}</b><small>${esc(it.c)} · ${badge(it)} ${mktBadge(it)} · ${it.cur === 'USD' ? usd(it.p) : won(it.p)}</small></span>
      <span class="y"><b>${pct(it.y)}</b><small>${state.tax === 'after' ? '세후 ' + pct(it.y * TAX[it.m]) : '세전'}</small></span>
      <button type="button" class="info" data-info="${esc(it.id)}" aria-label="상세">i</button></label>`;
  }
  const badge = (it) => `<span class="badge ${it.f}">${FREQ_KO[it.f] || it.f}${it.est ? '<span title="추정">?</span>' : ''}</span>`;
  const mktBadge = (it) => `<span class="badge ${it.m.toLowerCase()}">${it.m === 'KR' ? '국내' : '미국'} ${it.t === 'etf' ? 'ETF' : '주식'}</span>`;
  $('#picks').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    const id = cb.dataset.id;
    if (cb.checked) { if (state.picks.length >= 8) { cb.checked = false; alert('최대 8개까지 담을 수 있어요.'); return; } state.picks.push(id); }
    else state.picks = state.picks.filter((x) => x !== id);
    renderSlip(); writeHash();
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-info]'); if (b) { e.preventDefault(); openSheet(b.dataset.info); } });

  function renderSlip() {
    const picks = state.picks.map((id) => state.items.find((x) => x.id === id)).filter(Boolean);
    const el = $('#slip');
    if (!picks.length) { el.innerHTML = `<div class="empty">위에서 종목을 1개 이상 골라 주세요.</div>`; return; }
    const P = planFor(picks);
    const taxLabel = state.tax === 'after' ? '세후' : '세전';
    const monthlyCal = calendarAmounts(P.rows);
    let head, kv;
    if (P.mode === 'goal') {
      head = `<div class="big">${big(P.capital)}</div><div class="cap">월 ${big(P.G)} (${taxLabel}) 받으려면 이만큼 필요해요 · 실제 월 배당 약 ${big(P.monthly)}</div>`;
      kv = `<div><b>포트폴리오 ${taxLabel} 수익률</b><span>${pct(P.Yp * 100)}</span></div><div><b>연 배당 합계</b><span>${big(P.monthly * 12)}</span></div>
        <div><b>종목 수</b><span>${P.n}개 (균등)</span></div><div><b>${P.B ? '목표 도달' : '월 투자금'}</b><span>${P.B ? fmtMonths(P.monthsDrip) : '미입력'}</span></div>`;
    } else {
      head = `<div class="big">월 ${big(P.monthly)}</div><div class="cap">매달 ${big(P.B)}씩 ${P.years}년 넣고 배당을 재투자하면 받게 되는 ${taxLabel} 월 배당</div>`;
      kv = `<div><b>포트폴리오 ${taxLabel} 수익률</b><span>${pct(P.Yp * 100)}</span></div><div><b>${P.years}년 뒤 평가금</b><span>${big(P.capital)}</span></div>
        <div><b>넣은 원금</b><span>${big(P.invested)}</span></div><div><b>배당으로 불어난 몫</b><span>${big(P.capital - P.invested)}</span></div>`;
    }
    const rowsHtml = P.rows.map((r) => `<tr><td class="nm">${esc(r.it.n)}<small>${esc(r.it.c)} · ${badge(r.it)} · ${r.it.cur === 'USD' ? usd(r.it.p) + ' ≈ ' : ''}${won(r.price)}</small></td>
      <td class="n"><b>${comma(r.shares)}주</b></td><td class="n">${big(r.amount)}</td><td class="n hm">${pct(r.yAfter)}</td><td class="n">${big(r.monthly)}</td></tr>`).join('');
    const steps = buildSteps(P);
    const yearly = P.yearly ? `<h3>해마다 이렇게 불어나요</h3><table class="t"><thead><tr><th>년차</th><th class="n">넣은 돈</th><th class="n">평가금</th><th class="n">월 배당</th></tr></thead><tbody>${P.yearly.filter((y, i, a) => a.length <= 12 || i % Math.ceil(a.length / 12) === 0 || i === a.length - 1).map((y) => `<tr><td>${y.year}년</td><td class="n">${big(y.invested)}</td><td class="n">${big(y.cap)}</td><td class="n"><b>${big(y.monthly)}</b></td></tr>`).join('')}</tbody></table>` : '';
    el.innerHTML = `<div class="slip">
      <div class="top">${head}</div>
      <div class="kv">${kv}</div>
      <div class="body">
        <h3>무엇을 몇 주</h3>
        <div class="tscroll"><table class="t"><thead><tr><th>종목</th><th class="n">보유 목표</th><th class="n">금액</th><th class="n hm">${taxLabel} 수익률</th><th class="n">월 배당</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
        <h3>어떤 간격으로</h3>
        <ol class="steps">${steps}</ol>
        <h3>달마다 들어오는 배당 (${taxLabel}, 목표 보유 기준)</h3>
        <div class="cal">${monthlyCal.map((v, i) => `<div class="${v > 0 ? 'on' : ''}"><b>${i + 1}</b>${v > 0 ? shortMoney(v) : '-'}</div>`).join('')}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">숫자는 월, 아래는 그 달 예상 배당(원)</div>
        ${yearly}
        <div class="note">배당수익률은 최근 12개월(ETF 분배금) 또는 최근 결산 배당금 기준이고, 주가·환율·배당금은 계속 변합니다. 미국 종목은 환율 ${comma(state.fx)}원으로 환산했고, 세후는 국내 15.4%·미국 15% 원천징수만 반영했어요(금융소득종합과세 제외). 주가 상승·하락은 계산에 넣지 않았습니다.</div>
        <div class="actions"><button class="btn primary" id="share">이 플랜 링크 복사</button><button class="btn" id="reset-picks">추천으로 되돌리기</button></div>
      </div></div>`;
    $('#share').addEventListener('click', async () => { writeHash(); try { await navigator.clipboard.writeText(location.href); $('#share').textContent = '복사했어요'; setTimeout(() => ($('#share').textContent = '이 플랜 링크 복사'), 1500); } catch { prompt('이 주소를 복사하세요', location.href); } });
    $('#reset-picks').addEventListener('click', () => { state.picks = []; runPlan(false); });
  }
  function shortMoney(v) { if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`; if (v >= 1e4) return `${comma(v / 1e4)}만`; return comma(v); }
  function fmtMonths(m) { if (!m) return '-'; if (m >= 1200) return '100년 이상'; const y = Math.floor(m / 12), r = m % 12; return y ? `${y}년 ${r ? r + '개월' : ''}`.trim() : `${m}개월`; }
  function calendarAmounts(rows) {
    const cal = new Array(12).fill(0);
    rows.forEach((r) => {
      const annual = (r.shares || 0) * r.dps; if (!annual) return;
      const f = r.it.f;
      if (['daily', 'weekly', 'monthly'].includes(f)) { for (let i = 0; i < 12; i++) cal[i] += annual / 12; return; }
      const pm = monthsOf(r.it); if (!pm.length) { cal[3] += annual; return; }
      pm.forEach((m) => { cal[m - 1] += annual / pm.length; });
    });
    return cal;
  }
  function buildSteps(P) {
    const s = [];
    if (!P.B) {
      s.push(step(1, `한 번에 사기엔 부담되죠? <b>매달 투자할 수 있는 돈</b>을 위에 적으면 매주·격주·매월 중 어떤 간격으로 얼마씩 사면 되는지, 목표까지 몇 년 걸리는지 계산해 드려요.`));
      s.push(step(2, `일단 지금 살 수 있는 만큼 사도 괜찮아요. 위 표의 비율대로 <b>종목당 같은 금액</b>이 되게 나누어 사면 됩니다.`));
      return s.join('');
    }
    const c = P.cadence;
    if (!c.feasible) {
      s.push(step(1, `${P.n}개를 1주씩만 사도 <b>${big(c.lot1)}</b>이 필요해서, 매달 ${big(P.B)}로는 매번 다 살 수 없어요. <b>${c.label}</b> 모아서 ${big(c.amt)}이 되면 사거나, 비싼 종목을 빼고 다시 골라 보세요.`, 'coin'));
    } else {
      s.push(step(1, `<b>${c.label} 약 ${big(c.amt)}씩</b> 삽니다. 월 ${big(P.B)}를 ${c.k === 'weekly' ? '4~5번' : c.k === 'biweekly' ? '2번' : '1번'}에 나눠 넣는 셈이라 매수 시점 분산 효과가 있어요.`, 'coin'));
      s.push(step(2, `${c.label} 장바구니: ${c.basket.map((b) => `<b>${esc(b.r.it.n)} ${b.shares}주</b>`).join(', ')} (약 ${big(c.spent)}${c.left > 1000 ? `, 남는 ${big(c.left)}은 다음 번에 더해요` : ''}).`));
    }
    if (P.mode === 'goal') {
      s.push(step(s.length + 1, `받은 배당을 다시 사는 데 쓰면 <b>약 ${fmtMonths(P.monthsDrip)}</b> 뒤 목표에 닿아요. 배당을 그냥 쓰면 ${fmtMonths(P.monthsPlain)} 걸립니다.`));
      s.push(step(s.length + 1, `도착하면 보유량은 ${P.rows.map((r) => `${esc(r.it.n)} ${comma(r.shares)}주`).join(' · ')}. 그때부터 매달 약 <b>${big(P.monthly)}</b>이 들어와요.`));
    } else {
      s.push(step(s.length + 1, `${P.years}년 동안 꾸준히 사면 ${P.rows.map((r) => `${esc(r.it.n)} 약 ${comma(r.shares)}주`).join(' · ')}을 갖게 되고, 그때 월 배당은 약 <b>${big(P.monthly)}</b>입니다.`));
    }
    s.push(step(s.length + 1, `분기·연 배당 종목은 배당기준일 <b>이틀 전(국내 기준 D-2)</b>까지 사야 그 회차 배당을 받아요. 매일·매주·매월 배당 ETF는 아무 때나 시작해도 다음 분배일부터 받습니다.`));
    return s.join('');
  }
  const step = (k, html, cls = '') => `<li><span class="k ${cls}">${k}</span><p>${html}</p></li>`;

  // ---------- 종목 찾기 ----------
  const finderInputs = ['#q', '#f-freq', '#f-mkt', '#f-type', '#f-sort'];
  finderInputs.forEach((s) => $(s).addEventListener('input', () => renderFinder(true)));
  $('#more').addEventListener('click', () => { state.finderPage++; renderFinder(false); });
  function finderItems() {
    const q = $('#q').value.trim().toLowerCase();
    const f = $('#f-freq').value, m = $('#f-mkt').value, t = $('#f-type').value, sort = $('#f-sort').value;
    let arr = state.items.filter((it) => (m === 'all' || it.m === m) && (t === 'all' || it.t === t) && freqMatch(it, f)
      && (!q || it.n.toLowerCase().includes(q) || String(it.c).toLowerCase().includes(q) || (it.nEn || '').toLowerCase().includes(q)));
    if (sort === 's') arr.sort((a, b) => score(b) - score(a)); else if (sort === 'y') arr.sort((a, b) => b.y - a.y); else if (sort === 'yl') arr.sort((a, b) => a.y - b.y);
    else if (sort === 'p') arr.sort((a, b) => priceKRW(a) - priceKRW(b)); else arr.sort((a, b) => a.n.localeCompare(b.n, 'ko'));
    return arr;
  }
  function renderFinder(reset) {
    if (reset) state.finderPage = 1;
    const arr = finderItems(); const PAGE = 40; const show = arr.slice(0, PAGE * state.finderPage);
    $('#finder-list').innerHTML = show.length ? show.map((it) => finderRow(it)).join('') : `<div class="empty">검색 결과가 없어요.</div>`;
    $('#more').hidden = show.length >= arr.length; $('#more').textContent = `더 보기 (${show.length.toLocaleString()} / ${arr.length.toLocaleString()})`;
  }
  const finderRow = (it) => `<div class="pick"><span class="nm"><b>${esc(it.n)}</b><small>${esc(it.c)} · ${badge(it)} ${mktBadge(it)} · ${it.cur === 'USD' ? usd(it.p) : won(it.p)}${it.lx ? ' · 최근 기준일 ' + esc(it.lx) : ''}</small></span>
    <span class="y"><b>${pct(it.y)}</b><small>주당 연 ${it.cur === 'USD' ? usd(it.dps) : won(it.dps)}</small></span><button type="button" class="info" data-info="${esc(it.id)}" aria-label="상세">i</button></div>`;

  // ---------- 배당 달력 ----------
  function renderMonthChips() {
    $('#month-chips').innerHTML = MONTHS.map((m, i) => `<button class="chip ${i + 1 === state.calMonth ? 'coin' : ''}" data-v="${i + 1}" aria-pressed="${i + 1 === state.calMonth}">${m}</button>`).join('');
    $('#month-chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; state.calMonth = +b.dataset.v; $$('.chip', $('#month-chips')).forEach((c) => { const on = +c.dataset.v === state.calMonth; c.setAttribute('aria-pressed', on); c.classList.toggle('coin', on); }); renderCalendar(); });
  }
  function renderCalendar() {
    const m = state.calMonth;
    const arr = state.items.filter((it) => sizeKRW(it) >= 5e10 && it.y >= 1 && it.y <= 20 && (['daily', 'weekly', 'monthly'].includes(it.f) || monthsOf(it).includes(m)))
      .sort((a, b) => { const fa = ['daily', 'weekly', 'monthly'].includes(a.f) ? 1 : 0, fb = ['daily', 'weekly', 'monthly'].includes(b.f) ? 1 : 0; return fa - fb || b.y - a.y; }).slice(0, 60);
    const quarterly = arr.filter((it) => !['daily', 'weekly', 'monthly'].includes(it.f));
    const regular = arr.filter((it) => ['daily', 'weekly', 'monthly'].includes(it.f));
    $('#cal-list').innerHTML = `${quarterly.length ? `<div class="pad" style="padding-bottom:4px"><b>${MONTHS[m - 1]}에 배당이 나오는 분기·연 배당 종목</b> <small style="color:var(--muted)">(지급월 기준, 추정 포함)</small></div>` + quarterly.map(finderRow).join('') : ''}
      <div class="pad" style="padding-bottom:4px;border-top:1px solid var(--line)"><b>매달(또는 매주·매일) 나오는 종목</b> <small style="color:var(--muted)">(규모 500억 이상, 수익률 상위)</small></div>${regular.slice(0, 20).map(finderRow).join('')}`;
  }

  // ---------- 상세 시트 ----------
  function openSheet(id) {
    const it = state.items.find((x) => x.id === id); if (!it) return;
    const pKRW = priceKRW(it), tf = state.tax === 'after' ? TAX[it.m] : 1;
    const need = Math.ceil(1e5 * 12 / (dpsKRW(it) * tf));
    const hist = (it.h || []).slice().reverse();
    const isEtfKR = it.m === 'KR' && it.t === 'etf';
    const maxH = Math.max(...(isEtfKR ? hist.map((x) => x[1]) : hist.map((x) => x)), 1);
    const spark = hist.length > 1 ? `<div><b style="font-size:12px;color:var(--muted)">${isEtfKR ? '분배금 추이 (최근 ' + hist.length + '회, 1주당)' : '연간 주당 배당금 추이 (오래된 → 최근)'}</b><div class="spark">${hist.map((x, i) => { const v = isEtfKR ? x[1] : x; return `<i class="${i === hist.length - 1 ? 'last' : ''}" style="height:${Math.max(3, (v / maxH) * 100)}%" title="${isEtfKR ? x[0] + ' ' + won(v) : won(v)}"></i>`; }).join('')}</div></div>` : '';
    const recs = it.recs && it.recs.length ? `<table class="t" style="margin-top:12px"><thead><tr><th>배당기준일</th><th>지급일</th><th class="n">주당</th></tr></thead><tbody>${it.recs.slice(0, 8).map((r) => `<tr><td>${r[0] || '-'}</td><td>${r[1] || '미정'}</td><td class="n">${r[2] ? won(r[2]) : '미정'}</td></tr>`).join('')}</tbody></table>` : '';
    const pm = monthsOf(it);
    $('#sheet').innerHTML = `<div class="hd"><div><h3 id="sheet-title">${esc(it.n)}</h3><div style="font-size:13px;color:var(--muted);margin-top:4px">${esc(it.c)} · ${badge(it)} ${mktBadge(it)}${it.is ? ' · ' + esc(it.is) : ''}${it.sec ? ' · ' + esc(it.sec) : ''}${it.ex ? ' · ' + esc(it.ex) : ''}</div></div><button class="x" aria-label="닫기">×</button></div>
      <div class="stats">
        <div><b>현재가</b><span>${it.cur === 'USD' ? usd(it.p) : won(it.p)}</span>${it.cur === 'USD' ? `<small style="color:var(--muted)">≈ ${won(pKRW)}</small>` : ''}</div>
        <div><b>배당수익률</b><span>${pct(it.y)}</span><small style="color:var(--muted)">세후 ${pct(it.y * TAX[it.m])}</small></div>
        <div><b>주당 연 배당</b><span>${it.cur === 'USD' ? usd(it.dps) : won(it.dps)}</span>${it.la ? `<small style="color:var(--muted)">최근 1회 ${it.cur === 'USD' ? usd(it.la) : won(it.la)}</small>` : ''}</div>
      </div>
      <div style="font-size:14px;color:var(--ink-2)">배당 주기 <b>${FREQ_KO[it.f]}</b>${it.py ? ` (연 ${Math.round(it.py)}회)` : ''}${it.est ? ' <span class="badge">추정</span>' : ''}${it.lx ? ` · 최근 배당기준일 ${esc(it.lx)}` : ''}${it.m === 'KR' && it.t === 'etf' && it.aum ? ` · 순자산 ${big(it.aum * 1e8)}` : ''}${it.mc ? ` · 시총 ${esc(it.mc)}` : ''}${it.streak ? ` · 최근 ${it.streak}년 연속 배당${it.grow ? ', 늘리는 중' : ''}` : ''}</div>
      <div class="cal" style="margin-top:12px">${MONTHS.map((mm, i) => `<div class="${['daily', 'weekly', 'monthly'].includes(it.f) || pm.includes(i + 1) ? 'on' : ''}"><b>${i + 1}</b></div>`).join('')}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">노란 칸 = 배당(분배금)이 나오는 달 ${it.t === 'stock' && it.m === 'KR' ? '(지급월 기준)' : '(배당기준일 기준)'}</div>
      ${spark}${recs}
      <div class="quick">월 10만원(${state.tax === 'after' ? '세후' : '세전'}) 받으려면 <b>${comma(need)}주</b>, 약 <b>${big(need * pKRW)}</b>이 필요해요.<br>월 10만원씩 사면 ${it.cur === 'USD' ? '환율 반영 ' : ''}<b>${Math.floor(1e5 / pKRW) || '1주도 안 되어 모아서'}주</b>씩 살 수 있어요.</div>
      <div class="actions"><button class="btn primary" data-add="${esc(it.id)}">플랜에 담기</button><a class="btn" href="${naverUrl(it)}" target="_blank" rel="noopener">네이버 증권에서 보기</a></div>`;
    $('#sheet').classList.add('open'); $('#sheet-bg').classList.add('open');
    $('#sheet .x').onclick = closeSheet;
    $('#sheet [data-add]').onclick = () => { if (!state.picks.includes(id)) state.picks.push(id); closeSheet(); readForm(); $('#result-sec').hidden = false; runPlan(true); };
  }
  function closeSheet() { $('#sheet').classList.remove('open'); $('#sheet-bg').classList.remove('open'); }
  $('#sheet-bg').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ---------- URL 상태 ----------
  function writeHash() {
    const o = { m: state.mode, g: $('#goal').value, b1: $('#budget1').value, b2: $('#budget2').value, y: $('#years').value, f: state.freq, k: [...state.mkts].join(''), t: [...state.types].join(','), lo: state.ymin, hi: state.ymax, x: state.tax, fx: state.fx, p: state.picks };
    try { history.replaceState(null, '', '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(o))))); } catch { /* ignore */ }
  }
  function restoreFromHash() {
    const m = location.hash.match(/#p=(.+)/); if (!m) return false;
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      state.mode = o.m || 'goal'; $(`.tabs [data-mode=${state.mode}]`).click();
      $('#goal').value = o.g || 50; $('#budget1').value = o.b1 || ''; $('#budget2').value = o.b2 || 50; $('#years').value = o.y || 10;
      const setChips = (id, vals) => $$('.chip', $(id)).forEach((c) => c.setAttribute('aria-pressed', vals.includes(c.dataset.v) ? 'true' : 'false'));
      setChips('#freq-chips', [o.f || 'all']); setChips('#mkt-chips', (o.k || 'KRUS').match(/KR|US/g) || ['KR', 'US']); setChips('#type-chips', (o.t || 'etf,stock').split(',')); setChips('#tax-chips', [o.x || 'after']);
      $('#ymin').value = o.lo ?? 3; $('#ymax').value = o.hi ?? 12; if (o.fx) $('#fx').value = o.fx;
      readForm(); state.picks = Array.isArray(o.p) ? o.p : []; runPlan(true); return true;
    } catch { return false; }
  }

  readForm();
  load();
})();
