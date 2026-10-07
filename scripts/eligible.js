// 종목별 글을 만들 대상 선정 — fetch_desc.js 와 build_stocks.js 가 같은 기준을 쓴다.
// 기준을 바꾸려면 아래 숫자만 고치면 된다.
const MIN = {
  krStockMcapEok: 500,   // 국내 주식 시가총액 하한 (억원)
  krStockYield: 1,       // 국내 주식 배당수익률 하한 (%)
  krStockBigEok: 10000,  // 이 시총(억원, =1조) 이상 대형주는 수익률 무관 포함 (삼성전자 등)
  krEtfAumEok: 100,      // 국내 ETF 순자산 하한 (억원)
  usStockMcapEok: 10,    // 미국 주식 시가총액 하한 (억 달러)
  usStockYield: 1,       // 미국 주식 배당수익률 하한 (%)
  usStockBigEok: 100,    // 이 시총(억 달러) 이상 대형주는 수익률 무관 포함 (애플·MS 등)
  usEtfMcapEok: 1,       // 미국 ETF 시가총액 하한 (억 달러)
};

// "1,613조 5,729억" / "726억" / "47.4억 USD" → 억 단위 숫자
function eok(s) {
  if (!s) return 0;
  const t = String(s);
  let v = 0;
  const jo = t.match(/([\d,.]+)\s*조/);
  const e = t.replace(/[\d,.]+\s*조/, '').match(/([\d,.]+)\s*억/);
  if (jo) v += parseFloat(jo[1].replace(/,/g, '')) * 10000;
  if (e) v += parseFloat(e[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : 0;
}

function size(x) { // 정렬용 규모 (억 단위, 국내는 원화·미국은 달러 기준이라 시장 안에서만 비교)
  return x.t === 'etf' && x.m === 'KR' ? x.aum || 0 : eok(x.mc);
}

function eligible(x) {
  if (!(x.y > 0) || !x.p) return false;
  if (x.m === 'KR' && x.t === 'stock') return eok(x.mc) >= MIN.krStockBigEok || (x.y >= MIN.krStockYield && eok(x.mc) >= MIN.krStockMcapEok);
  if (x.m === 'KR' && x.t === 'etf') return (x.aum || 0) >= MIN.krEtfAumEok;
  if (x.m === 'US' && x.t === 'stock') return eok(x.mc) >= MIN.usStockBigEok || (x.y >= MIN.usStockYield && eok(x.mc) >= MIN.usStockMcapEok);
  if (x.m === 'US' && x.t === 'etf') return eok(x.mc) >= MIN.usEtfMcapEok;
  return false;
}

// URL 슬러그: kr-105560, us-jepi, us-brk-b
function slug(x) {
  return `${x.m.toLowerCase()}-${String(x.c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

module.exports = { MIN, eok, size, eligible, slug };
