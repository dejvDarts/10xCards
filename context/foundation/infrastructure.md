---
project: 10x-cards
researched_at: 2026-08-18
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 (SSR) + React 19
  runtime: Cloudflare Workers (workerd) / Node 22 build
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

Starter `10x-astro-starter` jest już w pełni skonfigurowany pod Cloudflare (`wrangler.jsonc`, `@astrojs/cloudflare`, `.github/workflows/ci.yml`), więc wdrożenie nie wymaga żadnej wymiany adaptera ani przepisywania CI — kluczowe przy odpowiedzi Q3 (brak znajomości platform, priorytet: niska friction). Wszystkie 5 kryteriów agent-friendly wypada na PASS, a przy Q1 (brak połączeń trwałych) model serverless jest lepiej dopasowany niż kontenery always-on. Free tier ($0, 100k req/dzień) z zapasem pokrywa MVP dla dziesiątek–setek użytkowników; ewentualne przejście na plan Paid ($5/mc) jest trywialne kosztowo.

## Platform Comparison

| Platforma | CLI-first | Serverless / zarządzane | Docs (agent-readable) | Stabilne API deploy/rollback | Integracja MCP | Ogólnie |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | **5/5 — rekomendacja** |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | 5/5 — runner-up (koszt/adapter) |
| **Netlify** | Partial | Pass | Pass | Partial | Partial | 3.  miejsce |
| **Render** | Pass | Partial | Pass | Pass | Pass | poza podium (kontener) |
| **Railway** | Partial | Partial | Pass | Partial | Pass | poza podium (kontener) |
| **Fly.io** | Partial | Fail | Pass | Partial | Pass | poza podium (Dockerfile) |

**Cloudflare** — `wrangler deploy/rollback/tail` w pełni skryptowalne i GA; serverless bez zarządzania infrastrukturą; docs jako `llms.txt` per produkt; rollback GA (do 100 wersji); MCP GA (`McpAgent` + oficjalny serwer CF). Jedyna platforma z zerową zmianą względem startera. Główna słabość: limit 10 ms CPU na free tier oraz różnice runtime `workerd` vs Node.

**Vercel** — komplet kryteriów PASS, świetne DX/docs (`llms.txt`, `llms-full.txt`) i oficjalny MCP (`mcp.vercel.com`). Minus: plan Hobby zakazany do użytku komercyjnego → realnie Pro $20/mc; wymaga wymiany adaptera na `@astrojs/vercel`. Retencja logów 1 h na Hobby.

**Netlify** — solidny serverless (`@astrojs/netlify`), free tier viable, znakomite docs (`llms.txt` + `.md` na każdej stronie). Minusy: brak komendy `netlify rollback` w CLI (tylko UI/REST), oficjalny MCP oparty na SDK w wersji beta, twardy timeout funkcji 60 s, brak WebSocketów (dla nas nieistotne — Q1=Nie).

**Render** — kryteria mocne (CLI z `--wait --confirm`, rollback GA, hosted MCP), ale model kontenerowy always-on: darmowy tier ma cold-start ~1 min, sensowny start to Starter $7/mc. Przy Q1=Nie serverless jest lepiej dopasowany.

**Railway** — dojrzały MCP first-party, persistent container, ~$5/mc. Wymaga zmian w projekcie (`host: '0.0.0.0'`, start `node ./dist/server/entry.mjs`), rollback tylko UI/GraphQL z oknem 72 h na Hobby.

**Fly.io** — pełna kontrola i WebSockety, `flyctl mcp` GA, ale wymaga własnego Dockerfile i zarządzania maszynami (nie „zarządzane/serverless"), brak free tier (~$3–5/mc). Najdalej od profilu MVP „low-ops".

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Wygrywa dopasowaniem: starter jest pod nią prekonfigurowany (zero zmian adaptera i CI), wszystkie kryteria agent-friendly na PASS, w pełni skryptowalne `wrangler` (deploy/rollback/tail), docs jako `llms.txt`, dojrzałe MCP. Serverless zgodny z Q1 (brak połączeń trwałych), a przy Q4 (pojedynczy region) globalna sieć edge jest bonusem, nie wymogiem. Koszt startowy $0.

#### 2. Vercel

Równie komplet kryteriów i najlepsze w zestawieniu docs/DX/MCP, ale przegrywa dwoma praktycznymi tarciami: zakaz użytku komercyjnego na darmowym Hobby (realny koszt $20/mc Pro) oraz konieczność wymiany adaptera i konfiguracji CI względem gotowego startera.

#### 3. Netlify

Dobry serverless z darmowym tierem i świetną dokumentacją dla agentów, ale traci punkty na braku rollbacku w CLI (UI/REST-only) i MCP zbudowanym na beta-SDK; do tego wymaga wymiany adaptera. Solidna alternatywa, lecz z wyższą friction niż Cloudflare.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. Limit **10 ms CPU** na free tier — SSR Astro + renderowanie React 19 bywa cięższe, co prawdopodobnie wymusi przejście na plan Paid ($5/mc) i grozi sporadycznymi błędami „CPU exceeded" pod obciążeniem.
2. `workerd` to **nie Node.js** — część zależności npm może wymagać flagi `nodejs_compat`, a mimo to niektóre pakiety zakładające API Node mogą nie działać; diagnoza trudniejsza niż na zwykłym Node.
3. Przepływ cookies **Supabase SSR** musi iść przez middleware Astro + WebCrypto; przy współbieżnych izolatach możliwe są wyścigi/redundancja przy odświeżaniu tokenu.
4. Brak trwałego systemu plików w runtime; ograniczony dostęp do plików na etapie build (konieczny `prerenderEnvironment: 'node'` w niektórych przypadkach).
5. Ryzyko lock-in przy adopcji bindings specyficznych dla CF (KV/R2/D1/Durable Objects).

### Pre-Mortem — How This Could Fail

Za około trzy tygodnie, tuż przed końcem okna MVP, integracja z dostawcą AI do generowania fiszek okazuje się zakładać API Node niedostępne w `workerd`; `nodejs_compat` nie pokrywa konkretnego przypadku, więc solo-developer (Q3: brak znajomości środowisk edge) traci kilka wieczorów na polyfille zamiast dowozić funkcje produktowe. Równolegle strony SSR z cięższym renderowaniem React przekraczają budżet 10 ms CPU na free tier, dając sporadyczne błędy „CPU exceeded" i wymuszając wcześniejsze przejście na plan Paid. Debugging jest bolesny, bo stack-trace są zminifikowane, a runtime edge różni się od lokalnego Node. Do tego wyścig przy odświeżaniu tokenu Supabase między izolatami powoduje sporadyczne, trudne do odtworzenia wylogowania. Suma tych tarć — nie pojedyncza awaria — rozjeżdża harmonogram i zagraża domknięciu 3-tygodniowego MVP po godzinach.

### Unknown Unknowns

- Czy klient AI (OpenAI / Anthropic / OpenRouter) użyty do generowania fiszek działa czysto na `workerd` (jeśli komunikacja idzie przez `fetch` — najpewniej tak; jeśli używa SDK zakładającego Node — ryzyko).
- Realny koszt CPU pojedynczego renderu UI fiszek — niezmierzony; decyduje o tym, czy free tier wystarczy, czy potrzebny jest plan Paid.
- Zachowanie połączeń do Supabase z Workers pod realnym obciążeniem (bezpośredni `fetch` vs ewentualny Hyperdrive).
- Ewentualne regresje kombinacji Astro 6 + `@astrojs/cloudflare` v14 z wyspami React 19.
- Poprawność przekazania sekretów (`SUPABASE_URL` / `SUPABASE_KEY`) z GitHub Actions do `wrangler deploy` w istniejącym `ci.yml`.

## Operational Story

- **Preview deploys**: Push na branch/PR uruchamia build; Cloudflare Pages/Workers udostępnia preview URL per commit. PR z forków mogą nie mieć dostępu do sekretów repo — wtedy preview z funkcjami serwerowymi wymaga zaufanego brancha lub środowiska z sekretami. Dla wrażliwych preview można włączyć Cloudflare Access.
- **Secrets**: Sekrety runtime (`SUPABASE_URL`, `SUPABASE_KEY`, klucze AI) trzymane jako Workers Secrets (`wrangler secret put`) oraz jako GitHub Secrets dla pipeline CI. Odczyt tylko dla maintainerów repo; rotacja przez `wrangler secret put <KEY>` + aktualizacja odpowiedniego GitHub Secret.
- **Rollback**: `npx wrangler rollback [VERSION_ID]` (lub `wrangler versions list` → wybór wersji); revert w sekundy. Uwaga: rollback kodu nie cofa migracji bazy Supabase — migracje trzeba wersjonować/cofać osobno.
- **Approval**: Publikacja na produkcję i rotacja kluczy pierwotnych (Supabase service key, klucze AI) wymagają człowieka. Agent może bez nadzoru: deploy preview, odczyt logów, `wrangler versions list`, dry-run buildy.
- **Logs**: Agent czyta logi read-only: `npx wrangler tail` (strumień na żywo, `| jq` do filtrowania) oraz Workers Logs w dashboardzie; logi CI dostępne przez GitHub Actions API/`gh run view`. Dodatkowo oficjalny MCP Cloudflare udostępnia narzędzia odczytu stanu konta.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Render SSR przekracza 10 ms CPU na free tier | Devil's advocate | M | M | Zmierzyć CPU/req wcześnie; zaplanować budżet $5/mc na plan Paid; ograniczać ciężkie renderowanie po stronie serwera |
| Zależność npm zakłada API Node niedostępne w `workerd` | Pre-mortem | M | H | Preferować klienty AI/HTTP oparte na `fetch`; włączyć `nodejs_compat`; testować krytyczne zależności na `wrangler dev` przed integracją |
| Wyścig odświeżania tokenu Supabase między izolatami | Devil's advocate | L | M | Obsługiwać sesję wyłącznie przez middleware Astro + `Astro.cookies`; polegać na krótkim odświeżaniu Supabase; dodać testy logowania |
| Trudny debugging edge (zminifikowane stack-trace) | Unknown unknowns | M | L | `vite.build.minify=false` w dev; korzystać z `wrangler tail`; utrzymywać parytet lokalny przez `platformProxy` |
| Sekrety Supabase/AI niepoprawnie wpięte w CI | Unknown unknowns | M | H | Zweryfikować mapowanie GitHub Secrets → `wrangler deploy` w `ci.yml`; smoke-test po pierwszym deployu |
| Vendor lock-in przy adopcji bindings CF | Research finding | L | M | Trzymać logikę domenową niezależną od bindings; wprowadzać KV/R2/D1 tylko przy realnej potrzebie |

## Getting Started

1. Ustawić Node zgodny ze starterem (`.nvmrc` = 22.14.0; obecnie lokalnie 22.12.0 → podbić, by uniknąć ostrzeżeń EBADENGINE).
2. Zalogować/ustawić poświadczenia: `npx wrangler login` lokalnie albo `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) jako sekrety CI.
3. Dodać sekrety runtime: `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY` (oraz klucz dostawcy AI).
4. Zbudować i wdrożyć: `npm run build` → `npx wrangler deploy` (starter ma już `@astrojs/cloudflare` i `wrangler.jsonc`).
5. Zweryfikować: `npx wrangler tail` do podglądu logów; smoke-test logowania Supabase i generowania fiszek na URL produkcyjnym.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
