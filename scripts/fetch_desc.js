// 종목별 글에 쓸 소개 정보 수집 → data/desc.json
//   국내 주식: 기업개요 (finance/annual 의 corporationSummary)
//   국내 ETF : 상품 설명 + 운용사·총보수·수익률 (integration)
//   미국 주식: 기업 소개·업종·국가·직원 수 (api.stock.naver.com overview)
//   미국 ETF : 분류·설정일·운용사·수익률·NAV (api.stock.naver.com etf/basic) — 소개 문구는 네이버에 없음
// 소개 문구는 앞 2~3문장(약 260자)만 저장한다. 실패한 종목은 이전 값을 유지한다.
// 사용: node scripts/fetch_desc.js [limit]
const { getJSON, num, writeJSON, readJSON } = require('./lib.js');
const { eligible } = require('./eligible.js');

const LIMIT = parseInt(process.argv[2] || '0', 10) || Infinity;
const CONC = 5;
const today = new Date().toISOString().slice(0, 10);

function clean(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^[\s\-•·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// 문장 분리 — "U.S." 같은 약어 마침표에서는 자르지 않는다
function sentences(t) {
  return t.split(/(?<=[^A-Z\s][.!?。])\s+(?=[^\s])/).map((x) => x.trim()).filter(Boolean);
}
// 앞쪽 문장부터 maxLen 이내로 (문장 중간에서 끊지 않음). 선택·가공은 build_stocks.js 에서 한 번 더 한다.
function brief(text, maxLen = 700) {
  const t = clean(text);
  if (!t) return '';
  let out = '';
  for (const s of sentences(t)) {
    if (out && (out + ' ' + s).length > maxLen) break;
    out = out ? out + ' ' + s : s;
  }
  return out.length > maxLen + 100 ? out.slice(0, maxLen).replace(/\s+\S*$/, '') + '…' : out;
}

async function krStock(x) {
  const j = await getJSON(`https://m.stock.naver.com/api/stock/${x.c}/finance/annual`, { retries: 2 });
  const cs = j.corporationSummary || {};
  const text = brief([cs.comment1, cs.comment2, cs.comment3].filter(Boolean).join(' '));
  return text ? { s: text } : null;
}
async function krEtf(x) {
  const j = await getJSON(`https://m.stock.naver.com/api/stock/${x.c}/integration`, { retries: 2 });
  const k = j.etfKeyIndicator || {};
  const o = {};
  const text = brief(j.description);
  if (text) o.s = text;
  if (k.issuerName) o.is = k.issuerName;
  if (num(k.totalFee) != null) o.fee = num(k.totalFee);
  if (num(k.returnRate1m) != null) o.r1m = num(k.returnRate1m);
  if (num(k.returnRate3m) != null) o.r3m = num(k.returnRate3m);
  if (num(k.returnRate1y) != null) o.r1y = num(k.returnRate1y);
  if (num(k.deviationRate) != null && k.deviationSign) o.dev = (k.deviationSign === '-' ? -1 : 1) * Math.abs(num(k.deviationRate));
  return Object.keys(o).length ? o : null;
}
async function usStock(x) {
  const j = await getJSON(`https://api.stock.naver.com/stock/${encodeURIComponent(x.rc || x.c)}/overview`, { retries: 2 });
  const sm = j.summaries || {};
  const o = {};
  const text = brief(j.summary || sm.summary);
  if (text) o.s = text;
  if (j.industry?.industryGroupKor) o.ind = j.industry.industryGroupKor;
  if (sm.nation) o.nat = sm.nation;
  if (num(sm.employees) != null) o.emp = num(sm.employees);
  if (j.stockItemListedInfo?.listedAt) o.ipo = String(j.stockItemListedInfo.listedAt).slice(0, 10);
  return Object.keys(o).length ? o : null;
}
async function usEtf(x) {
  const j = await getJSON(`https://api.stock.naver.com/etf/${encodeURIComponent(x.rc || x.c)}/basic`, { retries: 2 });
  const items = Object.fromEntries((j.stockItemTotalInfos || []).map((i) => [i.code, i.value]));
  const o = {};
  const cat = [j.largeCodeName, j.middleCodeName].filter(Boolean).join(' ');
  if (cat) o.cat = cat;
  if (items.inceptionDate) o.inc = String(items.inceptionDate).replace(/\./g, '-').replace(/-$/, '');
  if (items.providerCompanyName) o.is = items.providerCompanyName;
  for (const [code, key] of [['return1Month', 'r1m'], ['return3Month', 'r3m'], ['return6Month', 'r6m'], ['return1Year', 'r1y'], ['nav', 'nav']]) {
    const v = num(items[code]);
    if (v != null) o[key] = v;
  }
  return Object.keys(o).length ? o : null;
}

const FETCH = { 'KR:stock': krStock, 'KR:etf': krEtf, 'US:stock': usStock, 'US:etf': usEtf };

(async () => {
  const items = [...(readJSON('data/kr.json', [])), ...(readJSON('data/us.json', []))].filter(eligible).slice(0, LIMIT);
  const old = readJSON('data/desc.json', {}) || {};
  const out = {};
  let ok = 0, fail = 0, kept = 0;
  let i = 0;
  console.log(`대상 ${items.length}종목 (기존 캐시 ${Object.keys(old).length})`);
  async function worker() {
    while (i < items.length) {
      const x = items[i++];
      try {
        const r = await FETCH[`${x.m}:${x.t}`](x);
        if (r) { out[x.id] = { ...r, at: today }; ok++; }
        else if (old[x.id]) { out[x.id] = old[x.id]; kept++; }
      } catch (e) {
        fail++;
        if (old[x.id]) { out[x.id] = old[x.id]; kept++; }
        if (fail <= 8) console.log('  실패', x.id, String(e.message || e).slice(0, 80));
      }
      if ((ok + fail + kept) % 300 === 0) console.log(`  진행 ${ok + fail + kept}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  if (ok < items.length * 0.5) {
    console.log(`성공 ${ok} < 절반 — 파일을 덮어쓰지 않음`);
    process.exit(0);
  }
  writeJSON('data/desc.json', out);
  console.log(`완료: 성공 ${ok}, 실패 ${fail}, 이전값 유지 ${kept}`);
})();
