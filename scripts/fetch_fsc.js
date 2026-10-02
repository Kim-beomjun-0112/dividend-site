// 금융위원회 주식배당정보 API (공공데이터포털) — 국내 주식의 배당기준일·지급일 이력
// DATA_GO_KR_KEY 환경변수(인코딩된 키) 필요. 없거나 접속 불가하면 조용히 건너뜀.
// 출력: data/raw/kr_fsc.json  { "005930": { name, recs:[{base:'2026-06-30', pay:'2026-08-28', amt:374, kind:'현금배당'}] } }
const { getJSON, writeJSON, num } = require('./lib');

const KEY = process.env.DATA_GO_KR_KEY;
const BASE = 'https://apis.data.go.kr/1160100/GetStocDiviInfoService_V2/getDiviInfo_V2';
const YEARS_BACK = 3;

function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function dash(s) { return s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; }

(async () => {
  if (!KEY) { console.log('[FSC] DATA_GO_KR_KEY 없음 — 건너뜀'); return; }
  // 가장 최근 기준일자(basDt) 찾기 — 오늘부터 최대 10일 전까지
  let basDt = null, total = 0;
  for (let back = 0; back < 10; back++) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - back);
    const cand = ymd(d);
    try {
      const j = await getJSON(`${BASE}?serviceKey=${KEY}&resultType=json&pageNo=1&numOfRows=1&basDt=${cand}`, { retries: 1, delay: 50, headers: { Referer: '' } });
      const t = j?.response?.body?.totalCount || 0;
      if (t > 0) { basDt = cand; total = t; break; }
    } catch (e) { console.log(`[FSC] ${cand} 조회 실패: ${e.message}`); if (back === 0 && /reset|timeout|fetch failed/i.test(e.message)) { console.log('[FSC] 접속 불가 — 건너뜀'); return; } }
  }
  if (!basDt) { console.log('[FSC] 최근 기준일자 데이터 없음 — 건너뜀'); return; }
  console.log(`[FSC] basDt=${basDt}, ${total}건`);

  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - YEARS_BACK);
  const cutoffYmd = ymd(cutoff);
  const map = {};
  const rows = 5000, pages = Math.ceil(total / rows);
  for (let p = 1; p <= pages; p++) {
    const j = await getJSON(`${BASE}?serviceKey=${KEY}&resultType=json&pageNo=${p}&numOfRows=${rows}&basDt=${basDt}`, { delay: 200, headers: { Referer: '' } });
    const items = j?.response?.body?.items?.item || [];
    for (const it of items) {
      if (!it.isinCd || !it.isinCd.startsWith('KR7')) continue;
      if (it.dvdnBasDt < cutoffYmd) continue;
      if (it.scrsItmsKcdNm && !/보통주|우선주/.test(it.scrsItmsKcdNm)) continue;
      const kind = it.stckDvdnRcdNm || '';
      if (!/현금|동시/.test(kind) && !(kind === '' && num(it.stckGenrDvdnAmt) > 0)) continue;
      const code = it.isinCd.slice(3, 9);
      const amt = num(it.stckGenrDvdnAmt) || 0;
      (map[code] ||= { name: it.isinCdNm || it.stckIssuCmpyNm, recs: [] }).recs.push({ base: dash(it.dvdnBasDt), pay: dash(it.cashDvdnPayDt), amt, kind });
    }
    console.log(`  page ${p}/${pages}`);
  }
  for (const c of Object.values(map)) {
    c.recs.sort((a, b) => (b.base > a.base ? 1 : -1));
    // 동일 기준일 중복 제거
    const seen = new Set();
    c.recs = c.recs.filter((r) => { const k = r.base; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  writeJSON('data/raw/kr_fsc.json', { basDt, updated: new Date().toISOString(), stocks: map });
  console.log(`[FSC] ${Object.keys(map).length}개 종목`);
})().catch((e) => { console.error('[FSC] 오류(무시):', e.message); });
