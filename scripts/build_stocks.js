// 종목별 글 생성기 — data/kr.json, us.json, desc.json, curated.json → stocks/*.html, stocks/index.html, sitemap-stocks.xml
// Netlify 배포 때(netlify.toml build.command) 실행되며, 생성물은 git 에 커밋하지 않는다.
// 사용: node scripts/build_stocks.js
const fs = require('fs');
const path = require('path');
const { eligible, size, slug, eok } = require('./eligible.js');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://dividend.qjawnsl112.com';
const OUT = path.join(ROOT, 'stocks');
const read = (rel, fb) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fb; }
};

const kr = read('data/kr.json', []);
const us = read('data/us.json', []);
const desc = read('data/desc.json', {});
const curated = read('data/curated.json', {});
const meta = read('data/meta.json', {});
if (!kr.length && !us.length) { console.log('데이터 없음 — 종목별 글 생성을 건너뜀'); process.exit(0); }

// 금액이 아직 정해지지 않은(0원) 국내 배당 기록은 제외하고 최근 배당 정보를 다시 맞춘다 (build.js 갱신 전 데이터 대비)
for (const x of kr) {
  if (!Array.isArray(x.recs) || !x.recs.length) continue;
  const paid = x.recs.filter((r) => r[2] > 0);
  if (paid.length) { x.recs = paid; x.lx = paid[0][0]; x.la = paid[0][2]; }
}

const FX = meta.usdkrw || 1350;
const kst = (iso) => { const d = new Date(iso || Date.now()); return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
const UPDATED = kst(meta.updated);
const UPDATED_DOT = UPDATED.replace(/-/g, '.');

// ───────── 표기 도우미 ─────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function won(n) {
  n = Math.round(n);
  if (n >= 1e4) n = Math.round(n / 1e4) * 1e4;
  if (n >= 1e8) {
    const e = Math.floor(n / 1e8), m = Math.round((n % 1e8) / 1e4);
    return `${nf(e)}억${m ? ` ${nf(m)}만` : ''}원`;
  }
  if (n >= 1e4) return `${nf(n / 1e4)}만원`;
  return `${nf(n)}원`;
}
function usd(a) {
  if (a == null) return '-';
  const d = a >= 100 ? 2 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  let s = Number(a).toFixed(d);
  s = s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  if (!s.includes('.')) s += '.00'; else if (/\.\d$/.test(s)) s += '0';
  return `$${s}`;
}
const money = (x, a) => (x.m === 'KR' ? `${nf(a)}원` : usd(a));
const pct = (v, d = 1) => `${nf(v, d)}%`;
const sign = (v, d = 1) => `${v > 0 ? '+' : ''}${nf(v, d)}%`;
const FREQ = { daily: '매일', weekly: '매주', monthly: '매월', quarterly: '분기(연 4회)', semiannual: '반기(연 2회)', annual: '연 1회' };
const FREQ_SHORT = { daily: '매일', weekly: '매주', monthly: '매월', quarterly: '분기', semiannual: '반기', annual: '연 1회' };
const TYPE = { 'KR:stock': '국내 주식', 'KR:etf': '국내 ETF', 'US:stock': '미국 주식', 'US:etf': '미국 ETF' };
const tkey = (x) => `${x.m}:${x.t}`;
const TAX = (x) => (x.m === 'KR' ? 0.154 : 0.15);
const afterY = (x) => x.y * (1 - TAX(x));
const priceKRW = (x) => (x.m === 'KR' ? x.p : x.p * FX);
const isFlow = (x) => ['daily', 'weekly', 'monthly'].includes(x.f);
const monthsText = (x) => (isFlow(x) ? '매달' : (x.pm || []).map((m) => `${m}월`).join('·') || '-');
const priceText = (x) => (x.m === 'KR' ? `${nf(x.p)}원` : `${usd(x.p)} (약 ${nf(Math.round(x.p * FX))}원)`);
const sizeText = (x) => {
  if (x.m === 'KR' && x.t === 'etf') return x.aum ? `순자산 ${won(x.aum * 1e8)}` : null;
  if (x.mc) return `${x.t === 'etf' ? '시가총액' : '시가총액'} ${x.m === 'US' ? x.mc.replace(/\s*USD$/, '') + ' 달러' : x.mc + '원'}`.replace('억 달러', '억 달러');
  return null;
};
const name = (x) => x.n;
const subName = (x) => (x.nEn && x.m === 'US' ? x.nEn : '');
const plain = (html) => String(html).replace(/<[^>]+>/g, '');

// ───────── 배당 이력 ─────────
// [[날짜, 금액], …] 최신순
function series(x) {
  if (Array.isArray(x.h) && x.h.length && Array.isArray(x.h[0])) return x.h.map(([d, a]) => [d, a]);
  if (Array.isArray(x.recs) && x.recs.length) return x.recs.map((r) => [r[0], r[2]]);
  return [];
}
const dayMs = 86400e3;
const D = (s) => new Date(s + 'T00:00:00Z').getTime();
function trend(x) {
  const s = series(x);
  if (s.length < 3) return null;
  if (x.f === 'weekly' || x.f === 'daily') {
    if (s.length < 12) return null;
    const avg = (arr) => arr.reduce((a, b) => a + b[1], 0) / arr.length;
    const a = avg(s.slice(0, 4)), b = avg(s.slice(4, 12));
    if (!(b > 0)) return null;
    return { pct: (a / b - 1) * 100, text: `최근 4회 평균 분배금이 그 앞의 8회 평균보다`, basis: 'recent' };
  }
  const last = D(s[0][0]);
  let best = null;
  for (const e of s.slice(1)) {
    const diff = Math.abs((last - D(e[0])) / dayMs - 364);
    if (diff <= 30 && (!best || diff < best.diff)) best = { diff, e };
  }
  if (!best || !(best.e[1] > 0)) return null;
  return { pct: (s[0][1] / best.e[1] - 1) * 100, text: `가장 최근 분배금(${s[0][0]})이 1년 전(${best.e[0]})보다`, basis: 'yoy' };
}
function chart(x) {
  const s = series(x).slice(0, 24).reverse();
  if (s.length < 3) return '';
  const max = Math.max(...s.map((e) => e[1]), 1e-9);
  const W = 640, H = 120, pad = 4, bw = (W - pad * 2) / s.length;
  const bars = s.map((e, i) => {
    const h = Math.max(2, (e[1] / max) * (H - 14));
    const last = i === s.length - 1;
    return `<rect x="${(pad + i * bw + bw * 0.12).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${last ? '#F5C63A' : '#1E6F55'}"><title>${esc(e[0])} · ${esc(money(x, e[1]))}</title></rect>`;
  }).join('');
  return `<figure class="dchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${s.length}회 분배금 막대 그래프" preserveAspectRatio="none">${bars}</svg><figcaption>최근 ${s.length}회 분배금 (왼쪽이 오래된 순서, 노란 막대가 가장 최근)</figcaption></figure>`;
}

// ───────── 소개 문구 ─────────
const LEGAL = /법\s*시행령|투자신탁재산을|1좌당\s*순자산|수익증권|집합투자|자본시장법/;
function pickSentences(text, maxLen = 260, maxN = 3) {
  if (!text) return '';
  const sents = text.split(/(?<=[^A-Z\s][.!?。])\s+(?=[^\s])/).map((t) => t.trim()).filter(Boolean);
  let out = '';
  let n = 0;
  for (const s of sents) {
    if (LEGAL.test(s)) continue;
    if (n >= maxN) break;
    if (out && (out + ' ' + s).length > maxLen) break;
    out = out ? `${out} ${s}` : s;
    n++;
  }
  return out;
}

const KIND_RULES = [
  ['option', /커버드콜|콜옵션|콜\s?매도|위클리|옵션|프리미엄|covered call|option income|premium income|buy-?write|yield ?boost|yieldmax|weeklypay|equity premium|put-?write|0dte|neos/i],
  ['divgrowth', /배당\s?성장|배당귀족|배당\s?어치버|dividend growth|dividend aristocrat|dividend achiev|dividend appreciation|dividend grower/i],
  ['highdiv', /고배당|배당다우|배당주|high dividend|dividend yield|select dividend|dividend equity|superdividend|dividend/i],
  ['bond', /채권|국채|회사채|금리|하이일드|treasury|bond|aggregate|corporate|municipal|high yield|t-bill|credit|loan/i],
  ['reit', /리츠|부동산|인프라|reit|real estate|infrastructure|mortgage/i],
  ['pref', /우선주|preferred/i],
];
function kind(x, d) {
  const hay = `${x.n} ${x.nEn || ''} ${d?.cat || ''} ${d?.s || ''}`;
  for (const [k, re] of KIND_RULES) if (re.test(hay)) return k;
  return 'index';
}
const KIND_TEXT = {
  option: '보유 자산에 더해 옵션(주로 콜옵션)을 이용해 프리미엄 수익을 만들고, 그 일부를 분배금으로 지급하는 인컴형 상품입니다. 분배율은 높게 나오기 쉽지만 주가가 크게 오르는 구간에서는 상승분을 일부 포기하고, 내릴 때는 하락을 대부분 그대로 맞습니다.',
  divgrowth: '배당을 꾸준히 늘려 온 기업을 모아 담는 배당 성장형 상품입니다. 분배율은 높지 않은 편이지만 시간이 지나며 분배금이 늘고 주가도 함께 오르는 것을 기대하는 투자자가 주로 봅니다.',
  highdiv: '배당수익률이 상대적으로 높은 기업을 모아 담고 배당을 분배금으로 지급하는 고배당형 상품입니다. 경기 방어 업종의 비중이 높은 경우가 많고, 배당이 줄어드는 기업이 섞이면 분배금도 따라 줄 수 있습니다.',
  bond: '채권에서 나오는 이자를 분배금으로 지급하는 채권형 상품입니다. 금리가 오르면 채권 가격이 내려 원금이 줄 수 있고, 만기·신용도에 따라 변동 폭이 달라집니다.',
  reit: '리츠·부동산·인프라 자산에서 나오는 임대료와 이자를 분배금으로 지급하는 상품입니다. 금리 변화와 공실·자금 조달 비용에 민감한 편입니다.',
  pref: '우선주(배당을 보통주보다 먼저 받는 주식)와 이에 준하는 증권에 투자해 분배금을 지급하는 상품입니다. 채권과 주식의 중간 성격이며 금리에 영향을 받습니다.',
  index: '특정 지수를 따라가며 보유 종목에서 나오는 배당과 이자를 분배금으로 지급하는 상품입니다.',
};
const KIND_LABEL = { option: '옵션 인컴형', divgrowth: '배당 성장형', highdiv: '고배당형', bond: '채권형', reit: '리츠·부동산형', pref: '우선주형', index: '지수 추종형' };

function etfAbout(x, d) {
  const k = kind(x, d);
  const parts = [];
  const cur = curated[x.c];
  if (x.m === 'US' && cur) parts.push(`<p>${esc(cur)}</p>`);
  else {
    const sent = x.m === 'KR' ? pickSentences(d?.s, 280, 2) : '';
    const issuer = d?.is || x.is;
    const yy = x.m === 'US' ? (/yieldmax\s+([A-Z0-9]{2,6})\b/i.exec(`${x.nEn || ''} ${x.n}`) || [])[1] : null;
    let lead = `${x.m === 'KR' ? '국내' : '미국'} 증시에 상장된 ETF입니다.${issuer ? ` 운용사: ${esc(issuer)}.` : ''}`;
    if (yy) lead += ` ${esc(yy.toUpperCase())} 종목을 기초로 옵션 전략을 쓰는 단일 종목 인컴형 상품입니다.`;
    parts.push(`<p>${lead} 성격은 <b>${KIND_LABEL[k]}</b>에 가깝습니다. ${KIND_TEXT[k]}</p>`);
    if (sent) parts.push(`<p class="src-line">공식 설명 요약: ${esc(sent)}</p>`);
  }
  const facts = [];
  if (d?.inc) facts.push(`설정일 ${d.inc}`);
  if (d?.cat) facts.push(`네이버 증권 분류 ${d.cat.replace(/ /g, ' › ')}`);
  if (d?.fee != null) facts.push(`총보수 연 ${nf(d.fee, 2)}%`);
  if (facts.length) parts.push(`<p>${facts.map(esc).join(' · ')}</p>`);
  return parts.join('\n');
}

function about(x) {
  const d = desc[x.id];
  const src = '<p class="src-line">소개 문구는 네이버 증권 제공 정보를 요약한 것으로, 요약·번역 과정에서 실제와 다를 수 있습니다. 투자 전 공시를 확인하세요.</p>';
  if (x.t === 'etf') return etfAbout(x, d) + (d?.s && x.m === 'KR' ? src : '');
  const text = pickSentences(d?.s, 270, 3);
  const out = [];
  if (text) out.push(`<p>${esc(text)}</p>`);
  else out.push(`<p>${esc(name(x))}은(는) ${x.m === 'KR' ? `${esc(x.ex || '국내')} 상장` : `미국 ${esc(x.ex || '')} 상장`} 기업입니다. 이 종목의 사업 소개는 아직 수집되지 않았습니다.</p>`);
  const facts = [];
  const ind = d?.ind || x.sec;
  if (ind) facts.push(`업종 ${ind}`);
  if (x.ex) facts.push(`거래소 ${x.ex}`);
  if (d?.nat) facts.push(`국가 ${d.nat}`);
  if (d?.emp) facts.push(`직원 약 ${nf(d.emp)}명`);
  if (facts.length) out.push(`<p>${facts.map(esc).join(' · ')}</p>`);
  if (text) out.push(src);
  return out.join('\n');
}

// ───────── 확인할 점 ─────────
function flags(x, tr) {
  const d = desc[x.id] || {};
  const f = [];
  if (x.t === 'stock' && x.y < 1.5) f.push(`<b>배당수익률이 ${pct(x.y)}로 낮은 편입니다.</b> 배당보다 주가 상승이 수익의 중심인 종목이라, 배당만으로 월 생활비를 만들려면 위 표처럼 필요한 투자금이 매우 큽니다. 배당 투자용보다는 성장 투자 종목에 가깝습니다.`);
  if (x.y >= 30) f.push(`<b>배당수익률이 ${pct(x.y)}로 매우 높습니다.</b> 이 정도 수치는 대부분 옵션 프리미엄이나 일회성 배당, 또는 주가 급락으로 분모가 줄어서 생깁니다. 같은 수준이 앞으로도 이어진다고 가정하기 어렵습니다.`);
  else if (x.y >= 12) f.push(`<b>배당수익률이 ${pct(x.y)}로 높은 편입니다.</b> 분배금의 출처(배당·이자·옵션 프리미엄)와 주가 추이를 함께 보세요. 분배금을 받아도 주가가 그만큼 내려가면 총수익은 제자리일 수 있습니다.`);
  const r1y = d.r1y ?? null;
  if (x.t === 'etf' && r1y != null && r1y <= -10) f.push(`최근 1년 수익률이 ${sign(r1y)}입니다. 분배금을 받더라도 주가 하락이 더 크면 투자 원금은 줄어듭니다.`);
  else if (x.t === 'etf' && r1y != null && x.y >= 8 && r1y < 0) f.push(`최근 1년 수익률이 ${sign(r1y)}로 마이너스입니다. 분배율이 높은데도 수익률이 낮은 것은 분배금만큼 가격이 내려갔다는 신호일 수 있습니다.`);
  if (tr && tr.pct <= -20) f.push(`${tr.text} <b>${nf(Math.abs(tr.pct), 0)}% 적습니다.</b> 분배금이 줄고 있는 종목은 예상 수익을 낮춰 잡아야 합니다.`);
  else if (tr && tr.pct >= 20) f.push(`${tr.text} <b>${nf(tr.pct, 0)}% 많습니다.</b> 늘어난 만큼 앞으로도 유지될지는 별개의 문제입니다.`);
  if (x.m === 'KR' && x.t === 'stock' && x.streak) f.push(`최근 기록상 ${x.streak}년 연속 배당을 지급했습니다.${x.grow ? ' 배당금도 늘어 온 흐름입니다.' : ''} 다만 과거 기록이 미래를 보장하지는 않습니다.`);
  if (x.m === 'KR' && x.t === 'stock' && x.f === 'annual') f.push('연 1회 결산 배당 종목은 배당기준일(보통 12월 말)에 주주명부에 올라야 하고, 지급은 이듬해 봄에 이뤄집니다. 기준일 2영업일 전까지 매수해야 합니다.');
  if (x.est) f.push('배당 주기는 최근 지급 기록으로 추정한 값이라 실제와 다를 수 있습니다.');
  if (x.m === 'US') f.push('미국 종목은 배당락일로부터 보통 2~4주 뒤에 입금됩니다. 달러로 받으므로 환율에 따라 원화 수령액이 달라지고, 배당에서 15%가 원천징수됩니다.');
  if (x.m === 'KR') f.push('국내 종목·ETF의 배당소득세는 15.4%이며, ISA·연금저축·IRP 계좌에서 사면 과세가 줄거나 미뤄집니다.');
  if (x.f === 'weekly' || x.f === 'daily') f.push(`${FREQ[x.f]} 지급 상품은 분배 횟수가 많을 뿐 수익이 더 크다는 뜻이 아닙니다. 지급 간격이 짧아도 연간 총 분배금(${money(x, x.dps)})이 기준입니다.`);
  if (x.m === 'KR' && x.t === 'etf' && x.aum < 300) f.push(`순자산이 ${won(x.aum * 1e8)}으로 작은 편입니다. 규모가 작은 ETF는 거래량이 적어 사고팔 때 가격 차이가 생기거나 상장폐지될 수 있습니다.`);
  if (x.m === 'US' && x.t === 'etf' && eok(x.mc) < 5) f.push('시가총액이 작은 ETF라 거래량이 적고 상장폐지 가능성도 상대적으로 높습니다.');
  return f;
}

// ───────── 같이 보면 좋은 종목 ─────────
const bySlug = new Map();
const items = [...kr, ...us].filter(eligible);
for (const x of items) bySlug.set(x.id, slug(x));
function related(x) {
  const grp = (o) => (o.t === 'etf' ? kind(o, desc[o.id]) : (desc[o.id]?.ind || o.sec || ''));
  const gx = grp(x);
  const score = (o) => Math.abs(Math.log((o.y + 0.5) / (x.y + 0.5))) + (o.f === x.f ? 0 : 0.5) + (gx && grp(o) !== gx ? 0.7 : 0) - Math.min(0.2, Math.log10(1 + size(o)) / 40);
  const rank = (arr, n) => arr.map((o) => [score(o), o]).sort((a, b) => a[0] - b[0]).slice(0, n).map((a) => a[1]);
  const same = rank(items.filter((o) => o.id !== x.id && o.m === x.m && o.t === x.t), 4);
  const other = rank(items.filter((o) => o.id !== x.id && o.m !== x.m && o.t === x.t && o.f === x.f), 2);
  return [...same, ...other];
}

// ───────── HTML 껍데기 ─────────
const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23F5C63A'/%3E%3Ccircle cx='16' cy='16' r='9' fill='none' stroke='%236B4E00' stroke-width='2.5'/%3E%3C/svg%3E">`;
const HEAD_COMMON = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${FAVICON}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/css/style.css?v=2">
<meta name="naver-site-verification" content="6aa72149c47ae66ad7cd6e335d03e5414cea1d06" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9705278233317075" crossorigin="anonymous"></script>`;
const HEADER = `<header class="hdr"><div class="wrap"><a class="logo" href="/"><i></i>불룩한배당</a><nav class="nav"><a href="/#planner">플랜</a><a href="/#finder" class="opt">종목 찾기</a><a href="/stocks/">종목별 글</a><a href="/#guides">가이드</a></nav></div></header>`;
const FOOTER = `<footer><div class="wrap"><div class="links"><a href="/">불룩한배당 홈</a><a href="/stocks/">종목별 글</a><span>데이터: 네이버 증권, 금융위원회 주식배당정보 · ${UPDATED_DOT} 기준</span></div></div></footer>`;
const AD_TOP = `<div class="ad" data-slot="stock-top"><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-9705278233317075" data-ad-slot="5549605452" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
const AD_BOTTOM = `<div class="ad" data-slot="stock-bottom"><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-9705278233317075" data-ad-slot="5874355734" data-ad-format="autorelaxed"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;

function guideLinks(x, k) {
  const g = [];
  if (x.f === 'weekly' || x.f === 'daily' || k === 'option') g.push(['/guide/weekly-daily-dividend.html', '매주·매일 배당 ETF의 구조와 함정']);
  if (x.f === 'monthly') g.push(['/guide/monthly-dividend-etf.html', '월배당 ETF, 뭐가 다르고 뭘 봐야 하나']);
  if (x.f === 'quarterly' || x.f === 'semiannual' || x.f === 'annual') g.push(['/guide/dividend-calendar-strategy.html', '분기 배당주로 매달 배당 받는 조합 만들기']);
  g.push(['/guide/monthly-income-plan.html', '월 100만원 배당 받으려면 얼마가 필요할까']);
  g.push(['/guide/dividend-tax.html', '배당 세금 한 번에 정리']);
  g.push(['/guide/how-to-read-this-site.html', '이 사이트 숫자는 어떻게 계산되나요']);
  return g.slice(0, 4);
}

function page(x) {
  const d = desc[x.id] || {};
  const sl = bySlug.get(x.id);
  const k = x.t === 'etf' ? kind(x, d) : null;
  const tr = trend(x);
  const ay = afterY(x);
  const fl = FREQ[x.f] || x.f;
  const title = `${name(x)}(${x.c}) 배당 정보 — 수익률 ${pct(x.y)}, ${FREQ_SHORT[x.f] || x.f} 배당`;
  const descText = `${name(x)}(${x.c})의 배당수익률 ${pct(x.y)}, 배당 주기(${fl}), 지급월, 최근 배당금과 월 100만원을 받으려면 필요한 투자금을 정리했습니다. ${UPDATED_DOT} 기준.`;
  const url = `${SITE}/stocks/${sl}.html`;
  const monthlyCash = (x.dps * (x.m === 'KR' ? 1 : FX)) * (1 - TAX(x)) / 12;

  // 한눈에 카드
  const cards = `<div class="sum">
<div><span>배당수익률(세전)</span><b>${pct(x.y)}</b><i>세후 약 ${pct(ay)}</i></div>
<div><span>배당 주기</span><b>${esc(FREQ_SHORT[x.f] || x.f)}</b><i>${x.est ? '추정' : esc(monthsText(x))}</i></div>
<div><span>최근 배당</span><b>${x.la != null ? esc(money(x, x.la)) : '-'}</b><i>${esc(x.lx || '')}</i></div>
</div>`;

  // 기본 정보 표
  const rows = [];
  rows.push(['현재가', priceText(x)]);
  rows.push(['연간 배당금(최근 12개월)', `${money(x, x.dps)}${x.m === 'US' ? ` (약 ${won(x.dps * FX)})` : ''}`]);
  rows.push(['배당수익률', `세전 ${pct(x.y)} / 세후 약 ${pct(ay)} (${x.m === 'KR' ? '15.4%' : '15%'} 과세 가정)`]);
  rows.push(['배당 주기', `${fl}${x.est ? ' (추정)' : ''}`]);
  rows.push([x.m === 'KR' && x.t === 'stock' ? '배당 지급월' : '배당 기준월(배당락)', monthsText(x)]);
  if (x.lx) rows.push(['최근 배당', `${x.lx}${x.la != null ? ` · ${money(x, x.la)}` : ''}`]);
  const sz = sizeText(x);
  if (sz) rows.push([x.t === 'etf' ? '규모' : '규모', sz]);
  const issuer = d.is || x.is;
  if (x.t === 'etf' && issuer) rows.push(['운용사', issuer]);
  if (x.t === 'etf' && d.fee != null) rows.push(['총보수', `연 ${nf(d.fee, 2)}%`]);
  if (x.t === 'etf' && (d.r1y != null || d.r3m != null)) {
    const rr = [];
    if (d.r1m != null) rr.push(`1개월 ${sign(d.r1m)}`);
    if (d.r3m != null) rr.push(`3개월 ${sign(d.r3m)}`);
    if (d.r6m != null) rr.push(`6개월 ${sign(d.r6m)}`);
    if (d.r1y != null) rr.push(`1년 ${sign(d.r1y)}`);
    rows.push(['최근 수익률(네이버 증권)', rr.join(' · ')]);
  }
  if (x.t === 'stock' && x.streak) rows.push(['연속 배당 기록', `최근 ${x.streak}년`]);
  if (x.m === 'KR' && x.t === 'stock' && x.recs?.[0]) rows.push(['최근 결산 배당', `기준일 ${x.recs[0][0]} · 지급일 ${x.recs[0][1] || '미정'} · 주당 ${nf(x.recs[0][2])}원`]);
  const table = `<table class="kv"><tbody>${rows.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;

  // 배당 이력
  const s = series(x);
  let hist = '';
  if (s.length) {
    const isKrStock = x.m === 'KR' && x.t === 'stock' && x.recs?.length;
    const body = isKrStock
      ? x.recs.slice(0, 10).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] || '-')}</td><td class="r">${nf(r[2])}원</td></tr>`).join('')
      : s.slice(0, 10).map((e, i) => {
        const prev = s[i + 1];
        const ch = prev && prev[1] > 0 ? sign((e[1] / prev[1] - 1) * 100, 0) : '';
        return `<tr><td>${esc(e[0])}</td><td class="r">${esc(money(x, e[1]))}</td><td class="r">${ch}</td></tr>`;
      }).join('');
    const head = isKrStock ? '<tr><th>배당기준일</th><th>지급일</th><th class="r">주당 배당금</th></tr>' : '<tr><th>배당락일</th><th class="r">1회 분배금</th><th class="r">직전 대비</th></tr>';
    let trLine = '';
    if (tr) {
      const dir = tr.pct >= 0 ? '많습니다' : '적습니다';
      trLine = `<p>${esc(tr.text)} <mark>${nf(Math.abs(tr.pct), 1)}% ${dir}</mark>. ${tr.basis === 'recent' ? '주·일 단위 분배는 회차마다 들쭉날쭉하므로 최근 흐름만 참고하세요.' : '같은 시기끼리 비교한 값이라 계절적 요인은 걸러집니다.'}</p>`;
    }
    hist = `<h2>배당 흐름</h2>${trLine}${chart(x)}<table class="hist"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // 월 목표별 필요 자금
  const targets = [30, 50, 100];
  const plan = targets.map((t) => {
    const need = (t * 1e4 * 12) / (ay / 100);
    const sh = Math.max(1, Math.ceil(need / priceKRW(x)));
    return `<tr><td>월 ${t}만원</td><td class="r">${won(need)}</td><td class="r">약 ${nf(sh)}주</td></tr>`;
  }).join('');
  const per100 = 1e6 * (ay / 100);
  const flowWord = x.f === 'weekly' ? `매주 약 ${won(per100 / 52)}` : x.f === 'daily' ? `영업일마다 약 ${won(per100 / 250)}` : x.f === 'monthly' ? `매달 약 ${won(per100 / 12)}` : x.f === 'quarterly' ? `분기마다 약 ${won(per100 / 4)}` : x.f === 'semiannual' ? `반기마다 약 ${won(per100 / 2)}` : `1년에 한 번 약 ${won(per100)}`;
  const planHtml = `<h2>월 배당을 받으려면 얼마가 필요할까</h2>
<p>지금 수익률(세후 ${pct(ay)})이 그대로 유지된다고 가정하고 이 종목 하나만 샀을 때의 계산입니다. 100만원을 넣으면 1년에 세후 약 ${won(per100)}, ${flowWord}이 들어오는 셈입니다${x.m === 'US' ? ` (환율 ${nf(FX)}원 기준)` : ''}.</p>
<table><thead><tr><th>목표 월 배당(세후)</th><th class="r">필요 투자금</th><th class="r">매수 수량</th></tr></thead><tbody>${plan}</tbody></table>
${x.y >= 15 ? '<p class="src-line">수익률이 높은 종목은 실제 분배금과 주가가 변하기 쉬워, 위 표보다 훨씬 많은 돈이 필요해질 수 있습니다.</p>' : ''}
<div class="tip"><b>한 종목에 몰아넣지 마세요</b><br>목표 금액과 투자 기간을 넣으면 여러 종목을 섞은 매수 수량과 간격을 계산해 드립니다.<br><a class="toplan" href="/#planner">배당 플랜 만들기</a></div>`;

  // 확인할 점
  const fl2 = flags(x, tr);
  const flagHtml = fl2.length ? `<h2>투자 전 확인할 점</h2><ul class="flags">${fl2.map((t) => `<li>${t}</li>`).join('')}</ul>` : '';

  // 관련
  const rel = related(x);
  const relHtml = rel.length ? `<h2>비슷한 종목</h2><ul class="rel">${rel.map((o) => `<li><a href="/stocks/${bySlug.get(o.id)}.html"><b>${esc(name(o))}</b><span>${esc(TYPE[tkey(o)])} · ${esc(FREQ_SHORT[o.f] || o.f)} · ${pct(o.y)}</span></a></li>`).join('')}</ul>` : '';
  const gl = guideLinks(x, k).map(([u, t]) => `<li><a href="${u}">${esc(t)}</a></li>`).join('');

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '불룩한배당', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: '종목별 글', item: `${SITE}/stocks/` },
        { '@type': 'ListItem', position: 3, name: `${name(x)}(${x.c})`, item: url },
      ] },
      { '@type': 'Article', headline: title, description: descText, dateModified: UPDATED, datePublished: '2026-10-05', author: { '@type': 'Organization', name: '불룩한배당' }, publisher: { '@type': 'Organization', name: '불룩한배당' }, mainEntityOfPage: url },
    ],
  };

  return `<!doctype html>
<html lang="ko">
<head>
<title>${esc(title)} — 불룩한배당</title>
<meta name="description" content="${esc(descText)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(descText)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
${HEAD_COMMON}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
${HEADER}
<main class="article stock">
<div class="meta"><a href="/stocks/">종목별 글</a> › ${esc(TYPE[tkey(x)])} · ${UPDATED_DOT} 기준</div>
<h1>${esc(name(x))} <small>${esc(x.c)}</small></h1>
${subName(x) ? `<p class="meta">${esc(subName(x))} · ${esc(x.ex || '')}</p>` : `<p class="meta">${esc(TYPE[tkey(x)])}${x.ex ? ` · ${esc(x.ex)}` : ''}</p>`}
${cards}
${AD_TOP}
<h2>어떤 종목인가요</h2>
${about(x)}
<h2>배당 한눈에 보기</h2>
${table}
${hist}
${planHtml}
${flagHtml}
${AD_BOTTOM}
${relHtml}
<h2>함께 읽기</h2>
<ul>${gl}</ul>
<p class="src-line">이 글은 공개 데이터를 자동으로 정리한 참고 자료이며 특정 종목의 매수·매도를 권유하지 않습니다. 수치는 ${UPDATED_DOT} 기준으로 매주 갱신되고, 실제 거래 전 증권사 앱에서 최신 가격과 공시를 확인하세요. 투자 판단과 결과는 본인 책임입니다.</p>
</main>
${FOOTER}
</body>
</html>`;
}

// ───────── 목록(허브) 페이지 ─────────
function hub() {
  const order = ['KR:etf', 'US:etf', 'KR:stock', 'US:stock'];
  const label = { 'KR:etf': '국내 ETF', 'US:etf': '미국 ETF', 'KR:stock': '국내 주식', 'US:stock': '미국 주식' };
  const blurb = {
    'KR:etf': '원화로 사고 ISA·연금계좌에도 담을 수 있는 국내 상장 배당 ETF. 월배당·커버드콜·미국 배당 지수형까지.',
    'US:etf': '매일·매주·매월 분배금을 주는 상품이 몰려 있는 미국 상장 ETF. 분배율이 높은 상품은 구조를 꼭 확인하세요.',
    'KR:stock': '시가총액 500억 원 이상, 배당수익률 1% 이상인 국내 배당 종목.',
    'US:stock': '시가총액 10억 달러 이상, 배당수익률 1% 이상인 미국 배당 종목.',
  };
  const groups = {};
  for (const x of items) (groups[tkey(x)] ||= []).push(x);
  const count = Object.fromEntries(order.map((k) => [k, (groups[k] || []).length]));
  const sections = order.map((k) => {
    const arr = (groups[k] || []).sort((a, b) => size(b) - size(a));
    return `<details class="hsec" id="${k.toLowerCase().replace(':', '-')}">
<summary><h2>${label[k]} <small>${nf(arr.length)}종목</small></h2></summary>
<p class="sub">${blurb[k]}</p>
<div class="si-grid">${arr.map((x) => `<a class="si" data-f="${x.f}"${x.nEn ? ` data-e="${esc(x.nEn.toLowerCase())}"` : ''} href="${bySlug.get(x.id)}.html"><b>${esc(name(x))}</b><span>${esc(x.c)} · ${esc(FREQ_SHORT[x.f] || x.f)} · ${pct(x.y)}</span></a>`).join('')}</div>
</details>`;
  }).join('\n');
  const total = items.length;
  const fl = { daily: 0, weekly: 0, monthly: 0 };
  for (const x of items) if (x.f in fl) fl[x.f]++;
  const t = '종목별 배당 정보 — 국내·미국 배당 ETF와 배당주 한눈에';
  const dsc = `국내·미국 배당 ETF와 배당주 ${nf(total)}종목의 배당수익률, 배당 주기(매일·매주·매월·분기), 지급월, 월 배당을 받기 위한 필요 투자금을 종목별로 정리했습니다.`;
  return `<!doctype html>
<html lang="ko">
<head>
<title>${t} — 불룩한배당</title>
<meta name="description" content="${esc(dsc)}">
<link rel="canonical" href="${SITE}/stocks/">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${esc(dsc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/stocks/">
<meta property="og:image" content="${SITE}/og.png">
${HEAD_COMMON}
</head>
<body>
${HEADER}
<main class="article hubpage">
<div class="meta"><a href="/">불룩한배당</a> › 종목별 글 · ${UPDATED_DOT} 기준</div>
<h1>종목별 배당 정보</h1>
<p class="meta">${esc(dsc)}</p>
<p>각 종목 페이지에는 어떤 종목인지 간단한 소개, 배당수익률과 세후 수익률, 배당 주기와 지급월, 최근 분배금 흐름, 월 30·50·100만원을 받기 위해 필요한 투자금, 투자 전 확인할 점을 담았습니다. 수치는 매주 월요일에 자동으로 갱신됩니다. 지금은 매일·매주 배당 ${nf(fl.daily + fl.weekly)}종목, 매월 배당 ${nf(fl.monthly)}종목이 들어 있습니다.</p>
<div class="hubtools">
<input id="q" type="search" placeholder="종목명·티커 검색 (예: SCHD, 삼성전자, 커버드콜)" aria-label="종목 검색" autocomplete="off">
<div class="chips" id="mchips">
<button class="chip" data-m="" aria-pressed="true">국내+미국</button>
<button class="chip" data-m="kr" aria-pressed="false">국내만</button>
<button class="chip" data-m="us" aria-pressed="false">미국만</button>
</div>
<div class="chips" id="fchips">
<button class="chip" data-f="" aria-pressed="true">전체</button>
<button class="chip" data-f="daily,weekly" aria-pressed="false">매일·매주</button>
<button class="chip" data-f="monthly" aria-pressed="false">매월</button>
<button class="chip" data-f="quarterly" aria-pressed="false">분기</button>
<button class="chip" data-f="semiannual,annual" aria-pressed="false">반기·연 1회</button>
</div>
<div class="hubcats">${order.map((k) => `<a href="#${k.toLowerCase().replace(':', '-')}">${label[k]} ${nf(count[k])}</a>`).join('')}</div>
</div>
<div id="none" hidden>조건에 맞는 종목이 없습니다.</div>
${AD_TOP}
${sections}
<p class="src-line">이 목록은 공개 데이터를 자동으로 정리한 참고 자료이며 특정 종목의 매수·매도를 권유하지 않습니다. 레버리지·인버스 상품과 규모가 매우 작은 상품은 제외했습니다.</p>
</main>
${FOOTER}
<script>
(function(){
  var q=document.getElementById('q'),chips=document.querySelectorAll('#fchips .chip'),none=document.getElementById('none');
  var items=[].slice.call(document.querySelectorAll('.si')),secs=[].slice.call(document.querySelectorAll('.hsec'));
  var fset=null,mset='',mchips=document.querySelectorAll('#mchips .chip');
  function run(){
    var t=q.value.trim().toLowerCase(),shown=0;
    items.forEach(function(a){
      var ok=(!fset||fset.indexOf(a.dataset.f)>-1)&&(!t||(a.textContent.toLowerCase()+' '+(a.dataset.e||'')).indexOf(t)>-1);
      a.hidden=!ok; if(ok)shown++;
    });
    var active=!!(t||fset);
    secs.forEach(function(s){var has=!!s.querySelector('.si:not([hidden])')&&(!mset||s.id.indexOf(mset+'-')===0);s.hidden=!has;if(active&&has)s.open=true;});
    none.hidden=!!secs.filter(function(s){return !s.hidden;}).length;
  }
  function openHash(){var h=location.hash.slice(1),e=h&&document.getElementById(h);if(e&&e.tagName==='DETAILS'){e.open=true;e.scrollIntoView();}}
  window.addEventListener('hashchange',openHash);openHash();
  mchips.forEach(function(c){c.addEventListener('click',function(){
    mchips.forEach(function(o){o.setAttribute('aria-pressed',o===c?'true':'false');});
    mset=c.dataset.m; run();
  });});
  q.addEventListener('input',run);
  chips.forEach(function(c){c.addEventListener('click',function(){
    chips.forEach(function(o){o.setAttribute('aria-pressed',o===c?'true':'false');});
    fset=c.dataset.f?c.dataset.f.split(','):null; run();
  });});
})();
</script>
</body>
</html>`;
}

// ───────── 실행 ─────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const x of items) { fs.writeFileSync(path.join(OUT, `${bySlug.get(x.id)}.html`), page(x)); n++; }
fs.writeFileSync(path.join(OUT, 'index.html'), hub());
const urls = [`${SITE}/stocks/`, ...items.map((x) => `${SITE}/stocks/${bySlug.get(x.id)}.html`)];
fs.writeFileSync(path.join(ROOT, 'sitemap-stocks.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}\n</urlset>\n`);
const withDesc = items.filter((x) => desc[x.id]).length;
console.log(`종목별 글 ${n}편 + 목록 + sitemap-stocks.xml (소개 데이터 있음 ${withDesc}/${n})`);
