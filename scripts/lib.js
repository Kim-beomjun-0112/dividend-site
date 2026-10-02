// 공통 유틸 — 외부 의존성 없음 (Node 18+)
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HTTPS_PROXY 환경변수가 있으면(undici 설치 시) 프록시를 거쳐 요청 — Node 기본 fetch는 프록시 env를 무시함
let fetchImpl = globalThis.fetch;
let dispatcher = null;
try {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  if (proxyUrl) {
    const undici = require('undici');
    dispatcher = new undici.EnvHttpProxyAgent();
    fetchImpl = undici.fetch;
  }
} catch { /* undici 없으면 기본 fetch */ }

async function getJSON(url, { retries = 3, delay = 120, headers = {} } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/', Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(20000),
        ...(dispatcher ? { dispatcher } : {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`non-JSON ${url.slice(0, 120)}`); }
      await sleep(delay);
      return json;
    } catch (e) {
      if (i === retries) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

function num(v) {
  if (v === null || v === undefined || v === '' || v === 'N/A') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function writeJSON(rel, obj) {
  const p = path.join(__dirname, '..', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  console.log(`  wrote ${rel} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
}
function readJSON(rel, fallback = null) {
  const p = path.join(__dirname, '..', rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 배당 간격 추정 — 날짜 배열(YYYY-MM-DD 또는 YYYY.MM.DD)을 받아 최근 12~15개월 지급 횟수로 판단
function inferFreqFromDates(dates, monthsWindow = 13) {
  const ds = dates.map((d) => new Date(String(d).replace(/\./g, '-'))).filter((d) => !isNaN(d)).sort((a, b) => b - a);
  if (!ds.length) return { freq: 'none', count12: 0 };
  const cutoff = new Date(ds[0]); cutoff.setMonth(cutoff.getMonth() - monthsWindow);
  const recent = ds.filter((d) => d > cutoff);
  const n = recent.length;
  // 최신 지급 기준 12개월 환산
  const spanDays = n > 1 ? (recent[0] - recent[n - 1]) / 86400000 : 0;
  let perYear = n;
  if (n > 1 && spanDays > 30) perYear = Math.round(((n - 1) / spanDays) * 365);
  return { freq: freqLabelFromPerYear(perYear, n), count12: n, perYear };
}
function freqLabelFromPerYear(perYear, n) {
  if (!n) return 'none';
  if (perYear >= 150) return 'daily';
  if (perYear >= 40) return 'weekly';
  if (perYear >= 10) return 'monthly';
  if (perYear >= 3) return 'quarterly';
  if (perYear >= 2) return 'semiannual';
  if (n === 1 || perYear <= 1) return 'annual';
  return 'irregular';
}

module.exports = { getJSON, num, sleep, writeJSON, readJSON, inferFreqFromDates, freqLabelFromPerYear };
