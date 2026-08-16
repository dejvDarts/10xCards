---
project: "10xCards"
context_type: greenfield
created: 2026-08-15
updated: 2026-08-15
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-09-14
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "profesjonalista poszerzający kompetencje (programista, lekarz, prawnik) — osoba ucząca się przez całe życie"
    - topic: "pain category"
      decision: "tarcie w przepływie pracy — przygotowanie materiału do nauki zabiera za dużo czasu"
    - topic: "insight / edge"
      decision: "istniejące narzędzia wymagają ręcznego tworzenia fiszek; AI z wklejonego tekstu radykalnie skraca ten krok"
    - topic: "auth strategy"
      decision: "logowanie e-mail + hasło; płaski model użytkownika, każdy widzi tylko własne fiszki"
  frs_drafted: 9
  quality_check_status: accepted
---

# Shape Notes

> Seed idea (from idea-notes.md): **10xCards — MVP**. Aplikacja do generowania fiszek
> edukacyjnych przez AI na podstawie wklejonego tekstu, wspierająca naukę metodą
> spaced repetition. Kluczowa bolączka: manualne tworzenie wysokiej jakości fiszek
> jest czasochłonne i zniechęca do korzystania z efektywnej metody nauki.

## Vision & Problem Statement

**Problem.** Profesjonaliści, którzy muszą stale poszerzać wiedzę, tracą zbyt dużo czasu
na ręczne tworzenie wysokiej jakości fiszek edukacyjnych. Ten koszt zniechęca ich do
korzystania ze spaced repetition — metody nauki o udowodnionej skuteczności.

- **Pain:** ręczne tworzenie dobrych fiszek jest czasochłonne.
- **Moment:** przy próbie regularnych powtórek, gdy brakuje gotowych fiszek.
- **Cost today:** rezygnacja z efektywnych powtórek lub żmudne przygotowywanie materiału
  ręcznie.

**Vision.** Narzędzie, które zamienia wklejony tekst źródłowy w gotowe do nauki fiszki
za pomocą AI, spięte z gotowym algorytmem powtórek — tak, aby profesjonalista mógł
przejść od materiału źródłowego do regularnej nauki w minuty, nie godziny.

**Insight / edge.** Istniejące narzędzia (Anki, Quizlet) wymagają ręcznego tworzenia
fiszek. Kluczowa przewaga 10xCards to generowanie fiszek AI z wklejonego tekstu, które
radykalnie skraca krok przygotowania — przy zachowaniu wysokiej akceptowalności treści.

## User & Persona

**Primary persona — Profesjonalista uczący się przez całe życie.**
Programista, lekarz, prawnik lub inny specjalista, który musi nieustannie przyswajać
nową wiedzę (nowe technologie, wytyczne, przepisy). Ma dostęp do materiałów źródłowych
(dokumentacja, artykuły, książki), ale brakuje mu czasu na przekształcenie ich w
materiał do nauki. Chce uczyć się efektywnie metodą powtórek, ale odbija się od kosztu
przygotowania fiszek.

## Access Control

**Model uwierzytelniania:** logowanie e-mail + hasło. Konto jest wymagane do
przechowywania fiszek.

**Model ról:** płaski — brak podziału na role. Każdy uwierzytelniony użytkownik jest
równy i ma dostęp wyłącznie do własnych fiszek (izolacja danych per użytkownik). To
najmniejszy model dostępu, który wciąż czyni MVP użytecznym.

## Success Criteria

### Primary
Pełny przepływ end-to-end działa: użytkownik loguje się, wkleja tekst, AI generuje
propozycje fiszek, użytkownik przegląda (akceptuje / edytuje / odrzuca), zaakceptowane
fiszki zapisują się na koncie, a następnie użytkownik uczy się w sesji powtórek
opartej o gotowy algorytm spaced repetition. Powiązana miara adopcji: użytkownicy
tworzą ≥ 75% swoich fiszek z wykorzystaniem generowania AI.

### Secondary
Manualne tworzenie fiszek działa jako pełnoprawna alternatywa dla generowania AI —
użytkownik może stworzyć fiszkę od zera, bez wklejania tekstu.

### Guardrails
- **Jakość generowania:** co najmniej 75% fiszek zaproponowanych przez AI jest
  akceptowanych przez użytkownika. Poniżej tego progu rdzeniowa obietnica produktu
  (AI oszczędza czas) przestaje się bronić.
- **Izolacja danych:** fiszki i wklejony tekst jednego użytkownika nigdy nie są
  widoczne dla innych (wynika z płaskiego modelu dostępu).

**Budżet czasu:** ~3 tygodnie pracy po godzinach dla MVP.

## Functional Requirements

### Konta
- FR-001: Użytkownik może założyć konto (e-mail + hasło). Priority: must-have
  > Socrates: Rozważony kontrargument: "konto zbędne w MVP, dane lokalnie". Rozstrzygnięcie: zostaje — przechowywanie fiszek per użytkownik jest częścią rdzenia produktu.
- FR-002: Użytkownik może zalogować się i wylogować. Priority: must-have
  > Socrates: Rozważony kontrargument: "wylogowanie/logowanie można odłożyć". Rozstrzygnięcie: zostaje — dostęp do własnej kolekcji wymaga sesji użytkownika.

### Generowanie AI
- FR-003: Użytkownik może wkleić tekst źródłowy i wygenerować propozycje fiszek przez AI. Priority: must-have
  > Socrates: Rozważone kontrargumenty: jakość <75%, koszt/opóźnienie AI, wąski format wejścia. Rozstrzygnięcie: zostaje — to rdzeń produktu; ryzyko jakości pokryte guardrailem 75% akceptacji.
- FR-004: Użytkownik może przejrzeć propozycje AI i zaakceptować, edytować lub odrzucić każdą propozycję. Priority: must-have
  > Socrates: Rozważony kontrargument: "ręczny przegląd niweczy oszczędność czasu". Rozstrzygnięcie: zostaje — przegląd jest tańszy niż tworzenie od zera i chroni jakość kolekcji.

### Zarządzanie fiszkami
- FR-005: Użytkownik może ręcznie utworzyć fiszkę (przód/tył). Priority: must-have
  > Socrates: Rozważony kontrargument: "rozprasza fokus / odtwarza Anki". Rozstrzygnięcie: zostaje jako secondary — pełnoprawna alternatywa dla przypadków bez tekstu źródłowego.
- FR-006: Użytkownik może przeglądać listę swoich zapisanych fiszek. Priority: must-have
  > Socrates: Rozważony kontrargument: "lista zbędna, bo algorytm i tak serwuje fiszki". Rozstrzygnięcie: zostaje — użytkownik potrzebuje wglądu i punktu wejścia do edycji/usuwania.
- FR-007: Użytkownik może edytować zapisaną fiszkę. Priority: must-have
  > Socrates: Rozważony kontrargument: "edycja na etapie przeglądu AI wystarcza". Rozstrzygnięcie: zostaje — błędy wychodzą też w trakcie nauki, po zapisaniu.
- FR-008: Użytkownik może usunąć fiszkę. Priority: must-have
  > Socrates: Rozważony kontrargument: "usuwanie zbędne w MVP". Rozstrzygnięcie: zostaje — użytkownik musi móc usunąć błędne lub nietrafione fiszki.

### Nauka
- FR-009: Użytkownik może uczyć się w sesji powtórek opartej o gotowy algorytm spaced repetition. Priority: must-have
  > Socrates: Rozważone kontrargumenty: dopasowanie gotowego algorytmu, ryzyko własnej implementacji, odłożenie na v2. Rozstrzygnięcie: zostaje — to domyka pętlę nauki; zależność od gotowego algorytmu odnotowana jako założenie.

## Business Logic

Aplikacja przekształca wklejony przez użytkownika tekst źródłowy w zestaw propozycji
fiszek (pytanie–odpowiedź) gotowych do nauki metodą powtórek.

Wejściem, które użytkownik dostarcza, jest surowy tekst źródłowy (fragment
dokumentacji, artykułu, notatek). Aplikacja decyduje, które fragmenty wiedzy warto
utrwalić i jak rozbić je na pary pytanie–odpowiedź — to jest decyzja domenowa, której
użytkownik nie musi podejmować ręcznie.

Wyjściem jest lista proponowanych fiszek. Każda propozycja jest wynikiem tej reguły i
podlega akceptacji użytkownika, zanim trafi do jego trwałej kolekcji. Miarą, że reguła
działa dobrze, jest akceptowalność propozycji (cel: ≥ 75%).

Użytkownik spotyka regułę w głównym przepływie: wkleja tekst, otrzymuje propozycje,
przegląda je i zatwierdza. Zaakceptowane fiszki zasilają następnie pętlę nauki opartą
o gotowy algorytm spaced repetition.

## Non-Functional Requirements

- **Odczuwalny czas generowania:** po wklejeniu tekstu użytkownik otrzymuje propozycje
  fiszek w krótkim, akceptowalnym czasie, z widoczną informacją o postępie dla
  operacji trwających dłużej niż kilka sekund.
- **Prywatność danych:** wklejony tekst i fiszki danego użytkownika nie są dostępne dla
  innych użytkowników ani wykorzystywane niezgodnie z jego wiedzą.
- **Wsparcie przeglądarek:** aplikacja działa poprawnie na aktualnych przeglądarkach
  desktopowych (podejście web-first).

## Non-Goals

MVP świadomie NIE obejmuje poniższych zakresów:

- **Własny zaawansowany algorytm powtórek** (jak SuperMemo czy Anki) — korzystamy z
  gotowego algorytmu; budowa własnego jest poza zakresem.
- **Import wielu formatów** (PDF, DOCX itp.) — jedynym wejściem jest wklejony tekst.
- **Współdzielenie zestawów fiszek** między użytkownikami — model jest jednoosobowy,
  każdy widzi tylko własne fiszki.
- **Integracje z innymi platformami edukacyjnymi** — brak zewnętrznych integracji
  edukacyjnych w MVP.
- **Aplikacje mobilne** — na start wyłącznie web.

## User Stories

### US-01: Wygenerowanie fiszek z wklejonego tekstu

- **Given** zalogowany użytkownik z tekstem źródłowym do nauki
- **When** wkleja tekst i uruchamia generowanie fiszek przez AI
- **Then** widzi listę propozycji fiszek, które może pojedynczo zaakceptować, edytować lub odrzucić, a zaakceptowane trafiają do jego kolekcji

#### Acceptance Criteria
- Każda propozycja jest edytowalna przed zapisaniem
- Odrzucone propozycje nie trafiają do kolekcji
- Zaakceptowane fiszki są natychmiast dostępne do nauki w sesji powtórek
- Pusty lub zbyt krótki wklejony tekst pokazuje zrozumiały komunikat, a nie pustą listę
