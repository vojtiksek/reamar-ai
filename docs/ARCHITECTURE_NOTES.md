# Reamar AI – Architecture Notes

## Frontend Design System – Reamar UI

Reamar AI je prémiový real-estate advisory produkt používaný živě během schůzek makléř–klient.
Frontend musí být konzistentní napříč aplikací a opírat se o jednotný design systém („Reamar UI“).

Tento dokument popisuje, **jak má design systém vypadat** a **kde se má použít**.

### 1. Záměr design systému

- **Prémiový advisory nástroj** – UI má působit jako klidný, dobře strukturovaný reportovací/poradenský nástroj.
- **Použití v živém rozhovoru** – broker aplikaci sdílí na obrazovce s klientem; vše musí být srozumitelné během vysvětlování nahlas.
- **Ne startup, ne admin dashboard**
  - Vyhnout se přehnaným barevným akcentům, „startup gradientům“ a hravým prvkům.
  - Vyhnout se příliš hustým tabulkám s desítkami sloupců a bez prostoru.
- **Jeden vizuální jazyk napříč produktem**
  - Stejná podoba karet, tlačítek, formulářů a infoboxů na všech obrazovkách.
  - Stejný pocit z wizardů (intake, konfigurace, onboarding).

Detailní vizuální pravidla (barvy, spacing, karty, CTA, wizard, mapy, tabulky) jsou rozvedena v
`.cursor/rules/reamar-ui.mdc`. Tento dokument řeší hlavně **architektonické použití** v rámci produktu.

### 2. Kde se má Reamar UI použít jako první

První vlny adopce design systému:

1. **Klientský wizard a detail klienta**
   - Stránka `/clients/[id]` – intake wizard, shrnutí profilu klienta, přehled trhu, market fit, doporučené jednotky.
   - Cíl: aby celá stránka působila jako strukturovaný advisory canvas pro schůzku s klientem.
2. **Seznam klientů**
   - Stránka `/clients` – vizuální jazyk pro přehled klientů (karty nebo zjednodušená tabulka).
3. **Přehled projektů a jednotek pro klienta**
   - Jakékoli obrazovky, kde broker společně s klientem prochází konkrétní projekty/jednotky, musí používat stejné
     karty, tlačítka a typografii.

Další části produktu se mohou přizpůsobovat postupně, ale tyto musí být vždy vnímány jako „ukázková implementace“ Reamar UI.

### 3. Sdílené UI primitives / komponenty

Některé primitives již existují, jiné jsou zatím pouze **plánované** – v promtech je označuj jako „plánované sdílené primitivum“,
dokud fyzicky nevzniknou v kódu.

#### 3.1 Existující primitives (už v kódu)

Aktuálně (stav po refaktoringu klientského wizardu) existuje soubor `frontend/src/components/ui/reamar-ui.tsx`,
který obsahuje:

- **`ReamarButton`**  
  - Variants: `primary`, `secondary`, `subtle`, `ghost`.  
  - Používat místo ad-hoc Tailwind tříd pro tlačítka na obrazovkách, kde má být Reamar UI.

- **`ReamarCard` / `ReamarSubtleCard`**  
  - Základní card primitives s konzistentním zaoblením, stínem a povrchem.
  - Používat pro hlavní obsahové bloky (wizard, konfigurace) a sekundární bloky (analytics).

- **`InfoBox`**  
  - Infobox s různými „tóny“ (neutral, success, warning, danger), vhodný pro vysvětlující texty a upozornění.

- **`StatCard`**  
  - Malá kartuška pro zobrazení jedné metriky (label + hodnota + sublabel), používat v analytických sekcích.

- **`WizardStepHeader`**  
  - Sdílený header pro wizardy: eyebrow, název kroku, popis a progress bar (krok X/Y).
  - Všechny multi-step flows by ho měly adoptovat, aby působily konzistentně.

- **Form primitives (`reamarInputClass`, `reamarSelectClass`, `reamarLabelClass`, `reamarFieldHintClass`)**  
  - Sdílené Tailwind class kombinace pro vstupy, selecty a labely, aby formuláře na různých screens působily jednotně.

Při jakékoliv nové UI práci v rámci Reamar AI, kde dává smysl Reamar UI, je potřeba tyto primitives **použít místo custom stylů**.

#### 3.2 Plánovaná shared primitives (zatím nemusí existovat v kódu)

Tyto komponenty jsou designově definované v pravidlech, ale nemusí být ještě implementované:

- **`ReamarTable`** (plánované)
  - Ovinutí `<table>` s přednastavenými třídami pro čisté, klidné tabulky.
  - Vhodné pro seznamy jednotek, projektů, klientů, kde je potřeba tabulkový layout.

- **`ReamarPageShell` / `ReamarLayout`** (plánované)
  - Layout komponenta pro stránku s pozadím, maximální šířkou obsahu a spacingem.
  - Zajistí konzistentní „canvas“ okolo všech hlavních povrchů (wizard, seznamy, detail).

- **`ReamarSectionHeader`** (plánované)
  - Malý header pro sekundární sekce („Trh v oblasti“, „Market fit analysis“), aby byly konzistentní napříč screens.

U nových feature branchů je vhodné tyto plánované primitives buď doplnit do `reamar-ui.tsx`, nebo navrhnout jejich rozšíření
podle pravidel v `.cursor/rules/reamar-ui.mdc`.

### 4. Kde design systém adoptovat dál

Po stabilizaci klientského wizardu a detailu klienta by se měl Reamar UI rozšířit do těchto částí:

1. **Clients**
   - `/clients` (list):
     - Převést výpis klientů tak, aby používal Reamar UI (karty nebo klidnou tabulku, `ReamarButton` pro akce).
   - `/clients/new` (nový klient):
     - Používat wizard layout, step header, sdílené form primitives.
   - `/clients/[id]` (detail):
     - Postupně sladit spodní analytické sekce (trh, market fit, doporučení) s Reamar UI primitives.

2. **Units**
   - `/units` (seznam jednotek):
     - Tabulky přepsat na Reamar-style tabulky (`ReamarTable` až bude existovat, nebo ručně dle pravidel).
     - Filtry a akce sjednotit přes Reamar form primitives a `ReamarButton`.
   - `/units/[external_id]` (detail jednotky):
     - Použít `ReamarCard` pro hlavní přehled, `StatCard` pro klíčové metriky (cena, plocha, cena/m²).

3. **Projects**
   - `/projects` (přehled projektů):
     - Seznam / karty / tabulky podle Reamar UI.
   - `/projects/[id]` (detail projektu):
     - Strukturovaný layout: hlavní karta s overview, stat cards pro metriky, mapová část podle map rules.

4. **Matches**
   - `/matches` (párování klient ↔ jednotky/projekty):
     - Hlavní obrazovka by měla vypadat jako „poradenský stůl“: nahoře volba klienta / profilu,
       pod tím doporučené jednotky v klidné tabulce a stat cards.

5. **Map**
   - `/projects/map` a další mapové pohledy:
     - Všechny mapy by měly používat stejné zásady: mapa jako hlavní plocha, ovládací prvky v kartách,
       analytics a seznamy jednotek v sekundárních kartách pod/vedle mapy.

### 5. Jak psát nové featury „v duchu Reamar UI“

Když v budoucnu vzniká nová UI feature:

1. **Nejdřív se rozhodnout o typu obrazovky**
   - Je to **wizard / guided flow** → použít `WizardStepHeader`, velkou primární kartu, fullscreen focus layout.
   - Je to **přehled nebo analytika** → použít kombinaci `ReamarCard` / `ReamarSubtleCard`, `StatCard`, klidných tabulek.
   - Je to **čistě interní skriptovací nástroj** (méně častý) → i tak raději držet se Reamar UI, pokud není důvod jinak.

2. **Použít existující primitives**
   - Tlačítka: vždy `ReamarButton` (správný variant + size), nepřidávat custom tailwind třídy všude.
   - Form: `reamarInputClass`, `reamarSelectClass`, `reamarLabelClass` místo ručních kombinací.
   - Karty: `ReamarCard` pro hlavní, `ReamarSubtleCard` pro sekundární obsah.

3. **Pokud primitives nestačí**
   - Nejprve rozšířit `reamar-ui.tsx` o nové planned primitives podle pravidel v `.cursor/rules/reamar-ui.mdc`.
   - Teprve potom je použít v nové obrazovce – aby se nové patterny staly sdíleným standardem.

