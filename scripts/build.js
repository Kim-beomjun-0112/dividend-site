// raw 수집 결과를 사이트용 data/kr.json, data/us.json, data/meta.json 으로 정리
const { readJSON, writeJSON, num, inferFreqFromDates, getJSON } = require('./lib');

const FREQ_ORDER = ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'irregular', 'unknown'];
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const monthOf = (d) => (d ? parseInt(String(d).slice(5, 7), 10) : null);

// 월 집합 → 12칸 중 배당(기준일) 있는 달
function monthsFromDates(dates) {
  const s = new Set(dates.map(monthOf).filter(Boolean));
  return [...s].sort((a, b) => a - b);
}
function monthsFromFreq(freq, anchorMonth) {
  if (freq === 'daily' || freq === 'weekly' || freq === 'monthly') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (!anchorMonth) return [];
  const step = freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
  const out = [];
  for (let m = ((anchorMonth - 1) % step); m < 12; m += step) out.push(m + 1);
  return out;
}

function issuerFromName(name) {
  const m = name.match(/^(KODEX|TIGER|RISE|KBSTAR|ACE|SOL|PLUS|ARIRANG|HANARO|KIWOOM|KOSEF|TIMEFOLIO|WON|1Q|BNK|UNICORN|KoAct|ITF|파워|마이티|히어로즈|DAISHIN343|에셋플러스|TREX|FOCUS|KCGI|VITA|TRUSTON|KODEX|KINDEX)/i);
  if (!m) return null;
  const map = { KODEX: '삼성자산운용', TIGER: '미래에셋자산운용', RISE: 'KB자산운용', KBSTAR: 'KB자산운용', ACE: '한국투자신탁운용', KINDEX: '한국투자신탁운용', SOL: '신한자산운용', PLUS: '한화자산운용', ARIRANG: '한화자산운용', HANARO: 'NH-Amundi자산운용', KIWOOM: '키움투자자산운용', KOSEF: '키움투자자산운용', TIMEFOLIO: '타임폴리오자산운용', WON: '우리자산운용', '1Q': '하나자산운용', BNK: 'BNK자산운용', UNICORN: '현대자산운용', KoAct: '삼성액티브자산운용', TREX: '유리자산운용', 'DAISHIN343': '대신자산운용' };
  return map[m[1]] || map[m[1].toUpperCase()] || m[1];
}

const LEV_RE = /레버리지|인버스|곱버스|\b[23]X\b|\bBull\b|\bBear\b|ProShares Ultra|UltraShort|UltraPro|Inverse|Leveraged|-1x|\b2x\b|\b3x\b|1\.5x|1\.25x/i;
const isLev = (name) => LEV_RE.test(String(name || ''));

function buildKR() {
  const stocks = readJSON('data/raw/kr_stocks.json', []);
  const etfs = readJSON('data/raw/kr_etfs.json', []);
  const fsc = readJSON('data/raw/kr_fsc.json', null);
  const out = [];

  for (const e of etfs) {
    if (!e.price || !e.ttm || isLev(e.name)) continue;
    const y = (e.ttm / e.price) * 100;
    if (y < 0.3) continue;
    const dates12 = e.hist.filter((h) => new Date(h.d) > new Date(new Date(e.lastEx).setFullYear(new Date(e.lastEx).getFullYear() - 1))).map((h) => h.d);
    out.push({
      id: `KR:${e.code}`, m: 'KR', t: 'etf', c: e.code, n: e.name, p: e.price, cur: 'KRW',
      y: r2(y), dps: Math.round(e.ttm), f: e.freq, py: e.perYear ?? null,
      pm: e.freq === 'daily' || e.freq === 'weekly' || e.freq === 'monthly' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : monthsFromDates(dates12),
      lx: e.lastEx, la: e.lastAmt, h: e.hist.slice(0, 24).map((h) => [h.d, h.a]),
      aum: e.aum ? Math.round(e.aum / 1e8) : null, // 억원
      is: issuerFromName(e.name), ret3m: e.ret3m ?? null, src: 'naver',
    });
  }

  for (const s of stocks) {
    if (s.dpsTtm && s.dpsTtm > 0 && (!s.dps || Math.abs(s.dpsTtm - s.dps) / s.dps < 3)) s.dps = s.dpsTtm; // 네이버 최근 12개월 주당배당금 우선
    if (!s.price || !s.dps || isLev(s.name)) continue;
    const y = (s.dps / s.price) * 100;
    if (y < 0.3) continue;
    let f = 'annual', py = 1, pm = [], recs = [], payDates = [], est = true;
    const fs = fsc?.stocks?.[s.code];
    if (fs && fs.recs.length) {
      const paid = fs.recs.filter((r) => r.amt > 0);
      if (paid.length) {
        const inf = inferFreqFromDates(paid.map((r) => r.base));
        f = inf.freq; py = inf.perYear; est = false;
        const latest = new Date(paid[0].base);
        const cutoff = new Date(latest); cutoff.setFullYear(cutoff.getFullYear() - 1);
        const last12 = paid.filter((r) => new Date(r.base) > cutoff);
        payDates = last12.map((r) => r.pay).filter(Boolean);
        pm = monthsFromDates(payDates.length ? payDates : last12.map((r) => r.base));
        recs = fs.recs.slice(0, 12).map((r) => [r.base, r.pay, r.amt]);
      }
    }
    if (!pm.length) {
      // 결산월 기준 추정: 12월 결산 → 4월 지급
      const fm = parseInt((s.fiscal || '').split('.')[1] || '12', 10);
      pm = [((fm + 3) % 12) + 1];
    }
    const hist = [s.dps, ...(s.dpsHist || [])].filter((v) => v != null);
    let streak = 0; for (const v of hist) { if (v > 0) streak++; else break; }
    const growing = hist.length >= 3 && hist[0] >= hist[1] && hist[1] >= hist[2];
    out.push({
      id: `KR:${s.code}`, m: 'KR', t: 'stock', c: s.code, n: s.name, p: s.price, cur: 'KRW',
      y: r2(y), dps: s.dps, f, py, pm, est, lx: fs?.recs?.[0]?.base || null, la: recs[0]?.[2] ?? null,
      h: hist, recs, streak, grow: growing, mc: s.marketCapText || null, sec: s.sector || null, ex: s.market, fiscal: s.fiscal, src: fs ? 'naver+fsc' : 'naver',
    });
  }
  return out;
}

// 미국 월배당으로 알려진 개별주 보정 (리츠·BDC 등)
const US_MONTHLY_STOCKS = new Set(['O', 'MAIN', 'STAG', 'AGNC', 'EPR', 'ADC', 'LTC', 'GOOD', 'GAIN', 'SLG', 'APLE', 'PSEC', 'ORC', 'ARR', 'EFC', 'DX', 'HRZN', 'PFLT', 'GLAD', 'LAND', 'OXSQ', 'SBR', 'PBA', 'ENB', 'SJT', 'PSEC', 'EARN', 'ITUB', 'BBD', 'CRT', 'PVL', 'MTR', 'PRT', 'GROW', 'WSR', 'SRET']);

function buildUS() {
  const etfs = readJSON('data/raw/us_etfs.json', []);
  const stocks = readJSON('data/raw/us_stocks.json', []);
  const out = [];
  const histMonths = (hist) => { if (!hist || !hist.length) return null; const latest = new Date(hist[0].d); const c = new Date(latest); c.setFullYear(c.getFullYear() - 1); return monthsFromDates(hist.filter((h) => new Date(h.d) > c).map((h) => h.d)); };
  // 야후 TTM이 네이버 수익률과 크게 어긋나면(액면병합 등) 네이버 값을 신뢰
  const pickYield = (ttm, listed) => { if (ttm == null) return listed; if (listed == null) return ttm; const r = ttm / listed; return r > 1.8 || r < 0.55 ? listed : ttm; };
  for (const e of etfs) {
    const y = pickYield(e.yieldTtm, e.yieldListed);
    if (!e.price || !y || y < 0.3 || y > 150 || isLev(e.nameEn || e.name)) continue;
    if (y !== e.yieldTtm) e.ttm = null;
    const f = e.freq && e.freq !== 'unknown' ? e.freq : 'quarterly';
    const pm = (!e.est && histMonths(e.hist)) || monthsFromFreq(f, monthOf(e.lastEx));
    out.push({
      id: `US:${e.symbol}`, m: 'US', t: 'etf', c: e.symbol, n: e.nameKo || e.name, nEn: (e.nameEn && e.nameEn !== (e.nameKo || e.name)) ? e.nameEn : undefined, p: e.price, cur: 'USD',
      y: r2(y), dps: r2(e.ttm ?? (y / 100) * e.price), f, py: e.perYear ?? null, est: !!e.est && !e.yahoo,
      pm: ['daily', 'weekly', 'monthly'].includes(f) ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : pm, lx: e.lastEx || null, la: e.lastAmt ?? null,
      h: (e.hist || []).slice(0, 14).map((h) => [h.d, h.a]),
      mc: e.mcapText || null, is: e.issuer || null, ex: e.exchange || null, src: e.yahoo ? 'naver+yahoo' : 'naver',
    });
  }
  for (const s of stocks) {
    const y = pickYield(s.yieldTtm, s.yieldListed);
    if (!s.price || !y || y < 0.3 || y > 60) continue;
    if (y !== s.yieldTtm) s.ttm = null;
    let f = s.yahoo && s.freq ? s.freq : (US_MONTHLY_STOCKS.has(s.symbol) ? 'monthly' : 'quarterly');
    if (f === 'unknown') f = 'quarterly';
    const anchor = monthOf(s.lastEx) || (s.payAt ? new Date(s.payAt).getMonth() + 1 : null);
    const pm = (s.yahoo && histMonths(s.hist)) || monthsFromFreq(f, anchor);
    out.push({
      id: `US:${s.symbol}`, m: 'US', t: 'stock', c: s.symbol, n: s.nameKo || s.name, nEn: (s.nameEn && s.nameEn !== (s.nameKo || s.name)) ? s.nameEn : undefined, p: s.price, cur: 'USD',
      y: r2(y), dps: r2(s.ttm ?? s.dpsAnnual ?? (y / 100) * s.price), f, py: s.perYear ?? (f === 'monthly' ? 12 : 4), est: !s.yahoo,
      pm: ['daily', 'weekly', 'monthly'].includes(f) ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : pm, lx: s.lastEx || null, la: s.lastAmt ?? null,
      h: (s.hist || []).slice(0, 14).map((h) => [h.d, h.a]),
      mc: s.mcapText || null, mcap: s.mcap ?? null, sec: s.sector || null, ex: s.exchange || null, src: s.yahoo ? 'naver+yahoo' : 'naver',
    });
  }
  return out;
}

(async () => {
  const kr = buildKR();
  const us = buildUS();
  const sortFn = (a, b) => (b.y || 0) - (a.y || 0);
  kr.sort(sortFn); us.sort(sortFn);
  let usdkrw = null;
  try {
    const fx = await getJSON('https://api.stock.naver.com/marketindex/exchange/FX_USDKRW', { retries: 1 });
    usdkrw = num(fx?.exchangeInfo?.calcPrice ?? fx?.exchangeInfo?.closePrice);
  } catch { /* ignore */ }
  const prev = readJSON('data/meta.json', {});
  const count = (arr, f) => arr.filter(f).length;
  const meta = {
    updated: new Date().toISOString(),
    usdkrw: usdkrw || prev.usdkrw || 1400,
    fsc: !!readJSON('data/raw/kr_fsc.json', null),
    counts: {
      kr: kr.length, krEtf: count(kr, (x) => x.t === 'etf'), krStock: count(kr, (x) => x.t === 'stock'),
      us: us.length, usEtf: count(us, (x) => x.t === 'etf'), usStock: count(us, (x) => x.t === 'stock'),
      byFreq: Object.fromEntries(FREQ_ORDER.map((f) => [f, count([...kr, ...us], (x) => x.f === f)])),
    },
  };
  writeJSON('data/kr.json', kr);
  writeJSON('data/us.json', us);
  writeJSON('data/meta.json', meta);
  console.log(JSON.stringify(meta.counts));
})();
