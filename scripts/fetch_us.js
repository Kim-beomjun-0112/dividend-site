// 미국 배당 ETF·배당주 수집 (네이버 증권 해외 API, 키 불필요)
// 출력: data/raw/us_etfs.json, data/raw/us_stocks.json
const { getJSON, num, writeJSON, freqLabelFromPerYear } = require('./lib');

const FRONT = 'https://m.stock.naver.com/front-api';
const API = 'https://api.stock.naver.com';

const MIN_ETF_YIELD = 1.0;        // 배당수익률 1% 미만 ETF 제외
const MAX_ETF = 1600;
const MIN_STOCK_YIELD = 0.8;
const MIN_STOCK_MCAP = 1.5e9;     // 시총 15억 달러 이상
const BIG_STOCK_MCAP = 1e10;      // 시총 100억 달러 이상은 수익률 무관 포함
const MAX_STOCK = 1500;

function parseBasic(b) {
  const infos = b.stockItemTotalInfos || [];
  const get = (code) => infos.find((t) => t.code === code);
  const byKey = (k) => infos.find((t) => t.key === k);
  const lastEx = (byKey('배당기준일') || byKey('배당락일') || {}).value || null;
  const lastAmt = num((byKey('배당금') || byKey('주당배당금') || {}).value);
  const dy = num((get('dividendYieldRatio') || byKey('배당수익률') || {}).value);
  const nav = num((byKey('NAV') || {}).value);
  const mcapText = (get('marketValue') || byKey('시가총액') || {}).value || null;
  const issuer = (byKey('운용사') || {}).value || null;
  const sector = (get('industryGroupKor') || byKey('업종') || {}).value || null;
  return {
    price: num(b.closePriceRaw ?? b.closePrice), lastEx: lastEx ? lastEx.replace(/\.$/, '').replace(/\./g, '-') : null,
    lastAmt, yieldBasic: dy, nav, mcapText, issuer, sector, exchange: b.stockExchangeName || null, nameKo: b.stockName || null, nameEn: b.stockNameEng || null,
  };
}

// 연 배당수익률(%) × 가격 = 연 배당금, ÷ 최근 1회 배당금 = 연 지급 횟수
function inferFreq(yieldPct, price, lastAmt, annualDps) {
  const annual = annualDps || (yieldPct && price ? (yieldPct / 100) * price : null);
  if (!annual || !lastAmt) return { freq: 'unknown', perYear: null };
  const perYear = annual / lastAmt;
  let freq;
  if (perYear >= 150) freq = 'daily';
  else if (perYear >= 30) freq = 'weekly';
  else if (perYear >= 8.5) freq = 'monthly';
  else if (perYear >= 3.2) freq = 'quarterly';
  else if (perYear >= 1.6) freq = 'semiannual';
  else freq = 'annual';
  return { freq, perYear: Math.round(perYear * 10) / 10 };
}

// 야후 차트 API로 최근 2년 배당 이벤트 → 12개월 합계(TTM)·지급 횟수·최근 배당일. 실패하면 null (네이버 값으로 대체)
let yahooFails = 0;
async function yahooDividends(symbol, interval = '1wk') {
  if (yahooFails > 40) return null; // 연속 실패가 많으면 차단된 것으로 보고 중단
  const sym = symbol.replace(/\s+/g, '-').replace(/\./g, '-');
  const hosts = ['query1', 'query2'];
  const host = hosts[Math.floor(Math.random() * hosts.length)];
  try {
    const j = await getJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=${interval}&events=div`, { retries: 1, delay: 150, headers: { Referer: 'https://finance.yahoo.com/' } });
    const r = j?.chart?.result?.[0]; if (!r) { yahooFails++; return null; }
    yahooFails = 0;
    const ev = Object.values(r.events?.dividends || {}).map((v) => ({ d: new Date(v.date * 1000).toISOString().slice(0, 10), a: v.amount })).filter((v) => v.a > 0).sort((a, b) => (a.d < b.d ? 1 : -1));
    const price = num(r.meta?.regularMarketPrice);
    if (!ev.length) return { price, hist: [], ttm: 0, count13: 0, lastEx: null, lastAmt: null };
    const latest = new Date(ev[0].d);
    const c12 = new Date(latest.getTime() - 350 * 86400000); // 1년 경계의 같은 회차 중복 방지
    const c13 = new Date(latest); c13.setMonth(c13.getMonth() - 13);
    const last12 = ev.filter((v) => new Date(v.d) > c12);
    const last13 = ev.filter((v) => new Date(v.d) > c13);
    return { price, hist: ev.slice(0, 60), ttm: last12.reduce((s, v) => s + v.a, 0), count13: last13.length, count12: last12.length, lastEx: ev[0].d, lastAmt: ev[0].a };
  } catch { yahooFails++; return null; }
}
function freqFromCount(c) {
  if (c >= 150) return 'daily'; if (c >= 30) return 'weekly'; if (c >= 10) return 'monthly'; if (c >= 3) return 'quarterly'; if (c === 2) return 'semiannual'; if (c === 1) return 'annual'; return 'unknown';
}
async function yahooSmart(e) {
  let y = await yahooDividends(e.symbol, '1wk');
  // 주봉 버킷에 묶여 횟수가 적게 잡힌 경우(일배당 등): 목록 수익률이 TTM보다 훨씬 크면 일봉으로 재조회
  if (y && y.ttm > 0 && e.price && e.yieldListed && e.yieldListed / ((y.ttm / e.price) * 100) > 1.5) {
    const y2 = await yahooDividends(e.symbol, '1d');
    if (y2 && y2.ttm > y.ttm) y = y2;
  }
  return y;
}
function applyYahoo(e, y) {
  if (!y) return;
  e.yahoo = true;
  if (y.price) e.price = y.price;
  e.hist = y.hist; e.lastEx = y.lastEx || e.lastEx; e.lastAmt = y.lastAmt ?? e.lastAmt;
  if (y.count13 > 0) { e.freq = freqFromCount(y.count13); e.perYear = y.count12; e.est = false; }
  if (y.ttm > 0 && e.price) { e.ttm = y.ttm; e.yieldTtm = (y.ttm / e.price) * 100; }
}

async function fetchETFs() {
  console.log('[US] 배당 ETF 목록');
  const list = [];
  // 목록의 dividend 는 '연간 주당 배당금(USD)'이라 수익률은 가격으로 나눠 계산. 목록은 배당금 큰 순이라 끝까지 훑는다.
  for (let page = 1; page <= 120; page++) {
    const j = await getJSON(`${FRONT}/worldstock/etf/list?sortTypeCode=dividend&page=${page}&pageSize=50`);
    const rows = j?.result?.result || [];
    if (!rows.length) break;
    for (const r of rows) {
      const dps = num(r.dividend), price = num(r.currentPrice);
      if (!dps || !price) continue;
      const y = (dps / price) * 100;
      if (y < MIN_ETF_YIELD) continue;
      if (r.nationType && r.nationType !== 'USA') continue;
      list.push({ symbol: r.symbolCode, reuters: r.reutersCode, name: r.name, exchange: r.stockExchangeType, price, dpsListed: dps, yieldListed: Math.round(y * 100) / 100, ret3m: num(r.returnRate3m) });
    }
    if (!j?.result?.hasNext || list.length >= MAX_ETF) break;
  }
  list.sort((a, b) => b.yieldListed - a.yieldListed);
  // 네이버 목록에 빠져 있어도 꼭 넣을 대표 배당 ETF
  const MUST = ['SCHD', 'DGRO', 'HDV', 'DVY', 'SPYD', 'SPHD', 'VIG', 'NOBL', 'DIVO', 'JEPI', 'JEPQ', 'QYLD', 'XYLD', 'RYLD', 'SPYI', 'QQQI', 'VYM', 'SDY', 'FDVV', 'DGRW', 'SCHY', 'IDV', 'VYMI', 'PFF', 'PFFD', 'BND', 'TLT', 'TLTW', 'LQD', 'HYG', 'JNK', 'SRLN', 'BIZD', 'PBDC', 'KBWY', 'VNQ', 'SCHH', 'XLRE', 'MORT', 'REM', 'AMLP', 'MLPA', 'ENFR', 'SVOL', 'GPIX', 'GPIQ', 'ISPY', 'QDTE', 'XDTE', 'RDTE', 'YMAX', 'YMAG', 'ULTY', 'MSTY', 'NVDY', 'TSLY', 'CONY', 'JAAA', 'BKLN', 'USFR', 'SGOV', 'BIL', 'SHV', 'VCIT', 'VCSH', 'BNDX', 'EMB', 'SCHP', 'TIP', 'DIA', 'IWD', 'VTV', 'XLU', 'XLE', 'XLP', 'XLV', 'XLF', 'DTD', 'DHS', 'DLN', 'DON', 'DES', 'RDVY', 'FVD', 'FDL', 'CDC', 'KNG', 'DIVB', 'DIVZ', 'DURA', 'OUSA', 'OUSM', 'SMHB', 'TDIV', 'DJD', 'DIV', 'SDIV', 'ALTY', 'EFAS', 'LVHD', 'HDEF', 'DEM', 'DGS', 'EUDV', 'IHDG', 'EFAV', 'ACWV', 'USMV', 'SPLV', 'XMHQ', 'VOO', 'SPY', 'IVV', 'VTI', 'QQQ'];
  const have = new Set(list.map((x) => x.symbol));
  for (const sym of MUST) {
    if (have.has(sym)) continue;
    for (const suf of ['.K', '.O', '']) {
      try {
        const b = await getJSON(`${API}/etf/${encodeURIComponent(sym + suf)}/basic`, { retries: 0, delay: 60 });
        if (b && b.stockName) { list.push({ symbol: sym, reuters: sym + suf, name: b.stockName, exchange: b.stockExchangeName, price: num(b.closePriceRaw ?? b.closePrice), yieldListed: null, ret3m: null }); have.add(sym); break; }
      } catch { /* 다음 접미사 */ }
    }
    if (!have.has(sym)) {
      // 네이버에 없으면 야후 메타로 이름·가격만 채움
      try {
        const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=5d&interval=1d`, { retries: 1, delay: 150, headers: { Referer: 'https://finance.yahoo.com/' } });
        const m = j?.chart?.result?.[0]?.meta;
        if (m?.regularMarketPrice && m.currency === 'USD') { list.push({ symbol: sym, reuters: null, name: m.longName || m.shortName || sym, nameEn: m.longName || m.shortName || sym, exchange: m.fullExchangeName || null, price: num(m.regularMarketPrice), yieldListed: null, ret3m: null, yahooOnly: true }); have.add(sym); }
      } catch { /* skip */ }
    }
  }
  console.log(`  ${list.length}개, 상세 조회 중…`);
  let i = 0;
  for (const e of list) {
    try {
      if (!e.yahooOnly) {
        const b = await getJSON(`${API}/etf/${encodeURIComponent(e.reuters)}/basic`, { delay: 60 });
        Object.assign(e, parseBasic(b));
        if (e.price == null) e.price = num(b.closePrice);
        Object.assign(e, inferFreq(e.yieldListed, e.price, e.lastAmt));
      }
      e.est = true;
      applyYahoo(e, await yahooSmart(e));
    } catch { e.freq = e.freq || 'unknown'; }
    if (++i % 200 === 0) console.log(`  ${i}/${list.length}`);
  }
  return list;
}

async function fetchStocks() {
  console.log('[US] 배당주 목록 (시총순)');
  const list = [];
  for (let page = 1; page <= 80; page++) {
    const j = await getJSON(`${FRONT}/worldstock/nation/stock/list?stockNationType=USA&stockPriceSortType=marketValue&page=${page}&pageSize=50`);
    const rows = j?.result?.stocks || [];
    if (!rows.length) break;
    let stop = false;
    for (const r of rows) {
      const mcap = num(r.marketValue);
      if (mcap !== null && mcap < MIN_STOCK_MCAP) { stop = true; break; }
      const y = num(r.dividendYield);
      // 시총 100억 달러 이상 대형주는 수익률이 낮아도(애플·MS 등) 배당을 지급하면 포함, 그 아래는 수익률 하한 적용
      const big = mcap !== null && mcap >= BIG_STOCK_MCAP;
      if (!y || (!big && y < MIN_STOCK_YIELD)) continue;
      if (/_p/.test(r.reutersCode || '')) continue; // 우선주 제외
      list.push({ symbol: r.symbolCode, reuters: r.reutersCode, name: r.name, exchange: r.stockExchangeType, price: num(r.currentPrice), mcap, yieldListed: y, dpsListed: num(r.dividend), payAt: r.dividendPayAt || null });
    }
    if (stop || list.length >= MAX_STOCK) break;
  }
  console.log(`  ${list.length}개, 상세 조회 중…`);
  let i = 0;
  for (const s of list) {
    try {
      const b = await getJSON(`${API}/stock/${encodeURIComponent(s.reuters)}/basic`, { delay: 60 });
      Object.assign(s, parseBasic(b));
      if (s.price == null) s.price = num(b.closePrice);
      // 개별주: 주당배당금(연)과 최근 1회 배당금이 분리되어 있지 않으면 분기 가정
      const infos = b.stockItemTotalInfos || [];
      const dpsAnnual = num((infos.find((t) => t.code === 'dividend') || {}).value) ?? s.dpsListed;
      s.dpsAnnual = dpsAnnual;
      s.freq = 'quarterly'; s.perYear = 4; s.est = true; // 기본값, 야후 이력이 있으면 덮어씀
      applyYahoo(s, await yahooSmart(s));
    } catch { s.freq = s.freq || 'quarterly'; }
    if (++i % 200 === 0) console.log(`  ${i}/${list.length}`);
  }
  return list;
}

(async () => {
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'etfs') writeJSON('data/raw/us_etfs.json', await fetchETFs());
  if (which === 'all' || which === 'stocks') writeJSON('data/raw/us_stocks.json', await fetchStocks());
})().catch((e) => { console.error(e); process.exit(1); });
