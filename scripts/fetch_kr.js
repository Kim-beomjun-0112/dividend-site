// 국내 배당주·배당 ETF 수집 (네이버 증권 모바일 API, 키 불필요)
// 출력: data/raw/kr_stocks.json, data/raw/kr_etfs.json
const { getJSON, num, writeJSON, readJSON, inferFreqFromDates } = require('./lib');

const FRONT = 'https://m.stock.naver.com/front-api';
const OLD = 'https://m.stock.naver.com/api';

async function fetchStocks() {
  console.log('[KR] 배당주 목록');
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const j = await getJSON(`${FRONT}/domestic/stock/list/dividend?sortType=dividend&dividendSortType=rate&page=${page}&pageSize=50`);
    const rows = j?.result?.dividends || [];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        code: r.itemCode, name: r.name, market: r.marketType || r.stockExchangeType,
        dps: num(r.dividend), dpsHist: [num(r.dividend1), num(r.dividend2), num(r.dividend3)],
        yieldListed: num(r.dividendRate), fiscal: r.dividendDate || '',
      });
    }
    if (rows.length < 50) break;
  }
  // 금융위 배당 이력(fetch_fsc.js 선실행 시)에 있지만 네이버 목록에 빠진 종목 보충 — 최근 12개월 현금배당 합계를 주당배당금으로
  const fsc = readJSON('data/raw/kr_fsc.json', null);
  if (fsc?.stocks) {
    const have = new Set(out.map((x) => x.code));
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
    let added = 0;
    for (const [code, v] of Object.entries(fsc.stocks)) {
      if (have.has(code)) continue;
      const paid = v.recs.filter((r) => r.amt > 0 && r.base && new Date(r.base) > cutoff);
      if (!paid.length) continue;
      const dps = paid.reduce((s, r) => s + r.amt, 0);
      out.push({ code, name: v.name, market: '', dps, dpsHist: [], yieldListed: null, fiscal: '', fromFsc: true });
      added++;
    }
    console.log(`  금융위 이력에서 ${added}개 보충`);
  }
  console.log(`  ${out.length}개, 현재가 조회 중…`);
  let i = 0;
  for (const s of out) {
    try {
      const b = await getJSON(`${OLD}/stock/${s.code}/basic`, { delay: 60 });
      s.price = num(b.closePrice);
      s.exchange = b.stockExchangeName || s.market;
      const g = await getJSON(`${OLD}/stock/${s.code}/integration`, { delay: 60 });
      const infos = g.totalInfos || [];
      const pick = (code) => (infos.find((t) => t.code === code) || {}).value;
      s.marketCapText = pick('marketValue') || null;
      s.yieldBasic = num(pick('dividendYieldRatio'));
      s.dpsTtm = num(pick('dividend')); // 네이버 표기 주당배당금(최근 12개월)
      s.per = num(pick('per')); s.pbr = num(pick('pbr'));
      s.industryCode = g.industryCode || null;
    } catch (e) { s.price = s.price || null; }
    if (++i % 200 === 0) console.log(`  ${i}/${out.length}`);
  }
  return out;
}

async function fetchETFs() {
  console.log('[KR] ETF 목록');
  const list = [];
  const seen = new Set();
  for (let index = 0; index < 60; index++) { // index = 0부터 시작하는 페이지 번호
    const j = await getJSON(`${FRONT}/domestic/etf/list?index=${index}&sortTypeCode=aum&pageSize=50`);
    const rows = j?.result?.items || [];
    if (!rows.length) break;
    for (const r of rows) {
      if (seen.has(r.itemCode)) continue; seen.add(r.itemCode);
      list.push({ code: r.itemCode, name: r.name, price: num(r.currentPrice), aum: num(r.aum), ret3m: num(r.returnRate3m) });
    }
    if (!j?.result?.hasNext) break;
  }
  console.log(`  ${list.length}개, 분배금 이력 조회 중…`);
  const out = [];
  let i = 0;
  for (const e of list) {
    try {
      const j = await getJSON(`${FRONT}/stock/domestic/etf/dividendHistory/list?code=${e.code}&page=1&pageSize=50&firstPageSize=50`, { delay: 70 });
      const hist = (j?.result?.result || []).map((h) => ({ d: h.exDividendAt.replace(/\./g, '-'), a: num(h.dividendAmount) })).filter((h) => h.a > 0);
      if (!hist.length) continue; // 분배금 없는 ETF 제외
      const { freq, count12, perYear } = inferFreqFromDates(hist.map((h) => h.d));
      const cutoff = new Date(hist[0].d); cutoff.setFullYear(cutoff.getFullYear() - 1);
      const ttm = hist.filter((h) => new Date(h.d) > cutoff).reduce((s, h) => s + h.a, 0);
      out.push({ ...e, hist: hist.slice(0, 60), freq, count12, perYear, ttm, lastEx: hist[0].d, lastAmt: hist[0].a, total: j?.result?.totalCount || hist.length });
    } catch (err) { /* skip */ }
    if (++i % 200 === 0) console.log(`  ${i}/${list.length}`);
  }
  return out;
}

(async () => {
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'stocks') writeJSON('data/raw/kr_stocks.json', await fetchStocks());
  if (which === 'all' || which === 'etfs') writeJSON('data/raw/kr_etfs.json', await fetchETFs());
})().catch((e) => { console.error(e); process.exit(1); });
