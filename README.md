# 불룩한배당 (dividend.qjawnsl112.com)

조건에 맞는 배당주·배당 ETF를 골라 **몇 주를 얼마에, 어떤 간격으로** 사면 되는지 계산해 주는 정적 사이트.

## 구조
- `index.html`, `css/`, `js/app.js` — 사이트 본체 (빌드 없음, 바닐라 JS)
- `data/kr.json`, `data/us.json`, `data/meta.json` — 사이트가 읽는 데이터 (주 1회 자동 갱신)
- `scripts/` — 수집 스크립트 (Node 18+, 의존성은 `undici` 하나)
  - `fetch_fsc.js` 금융위원회 주식배당정보 API (국내 주식 배당기준일·지급일). `DATA_GO_KR_KEY` 필요, 없으면 건너뜀
  - `fetch_kr.js` 네이버 증권 — 국내 배당주 목록·현재가, 국내 ETF 목록·분배금 이력
  - `fetch_us.js` 네이버 증권 해외 — 미국 배당 ETF·배당주 목록/상세 + 야후 차트 API 배당 이벤트(TTM·주기)
  - `build.js` raw → 사이트용 JSON (레버리지·인버스 제외, 주기·지급월 계산, 환율)
  - `fetch_desc.js` 종목별 글용 소개 정보(네이버) → `data/desc.json`
  - `eligible.js` 종목별 글 대상 기준(규모·수익률 하한) — 숫자만 고치면 페이지 수가 바뀜
  - `build_stocks.js` `stocks/*.html` 3천여 장 + `sitemap-stocks.xml` 생성. **Netlify 빌드 때 실행**되고 git 에는 커밋하지 않음 (`netlify.toml` build.command)
- `data/curated.json` — 미국 ETF 직접 쓴 소개 문구 (티커 → 문장)
- `guide/_tpl.js` — 가이드 글 생성기 (`node guide/_tpl.js` 로 HTML + sitemap 재생성)
- `.github/workflows/update-data.yml` — 매주 월요일 06:30 KST 수집 → `data/` 커밋 → Netlify 자동 배포

## 로컬 실행
```bash
npm install
DATA_GO_KR_KEY=인코딩된키 npm run update   # 전체 수집 + 빌드 (10~20분)
python3 -m http.server 8765               # http://localhost:8765
```

## 배포
Netlify에 이 레포 연결, publish directory `.`, build command `node scripts/build_stocks.js` (netlify.toml). 커스텀 도메인 `dividend.qjawnsl112.com`.
GitHub Secrets에 `DATA_GO_KR_KEY` 등록 (공공데이터포털 일반 인증키, Encoding 버전).

## 애드센스
`index.html` 상단 주석의 스크립트를 해제하고 `.ad` 자리(`data-slot`)에 광고 단위를 넣는다.
