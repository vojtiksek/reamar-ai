# Ověření location metrics flow

## Scénáře a stav

### 1) Nový projekt s GPS – po importu se automaticky dopočítá noise + micro-location

**Stav: funguje**

- **Kde:** `backend/src/app/import_units.py` – v každém chunku se sestaví `enrich_project_ids`.
- **Logika:** Nové projekty (`key not in projects_map`) se přidají do `enrich_project_ids` (ř. 705–707). Po zpracování jednotek v chunku se volá `apply_project_data(project, unit_data, ...)`, takže projekt dostane GPS z unit dat. Po `db.flush()` se pro každé `pid` z `enrich_project_ids` zavolá `enrich_project_location_metrics(db, pid)` (ř. 798–799).
- **Klíčové soubory:** `import_units.py`, `project_location_metrics.py` (`enrich_project_location_metrics`).

---

### 2) Změna GPS u existujícího projektu – projekt se automaticky přepočítá

**Stav: funguje při změně z importu; přes API override aktuálně ne (GPS není v katalogu editovatelné)**

- **Import:** V `import_units.py` se pro existující projekty uloží `old_project_location` (ř. 698–702). Po aplikaci `apply_project_data` v chunku se pro každý existující projekt zkontroluje `should_enrich_after_project_change(...)` (ř. 779–793). Při změně `gps_latitude`, `gps_longitude` nebo `region_iga` se projekt přidá do `enrich_project_ids` a po flush se zavolá enrichment. **Tímto způsobem scénář funguje.**
- **API (override):** V `main.py` je po `put_project_override` / `delete_project_override` pro pole z `LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS` volání `enrich_project_location_metrics(db, project_id)` (ř. 3139–3142, 3186–3188). V `field_catalog.csv` ale mají `gps_latitude` a `gps_longitude` sloupec „Editable” = NE a „Zobrazit na webu” = NE, takže nejsou v `PROJECT_OVERRIDEABLE_FIELDS`. `PUT /projects/{id}/overrides/gps_latitude` tedy vrátí 422. Změna GPS přes UI override tedy momentálně není možná; jakmile budou tato pole v katalogu označena jako editovatelná (nebo doplněna do fallbacku v `overrides.py`), hook už je připraven a přepočet po změně bude fungovat.
- **Klíčové soubory:** `import_units.py`, `main.py` (put/delete project override), `project_location_metrics.py`, `overrides.py`, `field_catalog.csv`.

---

### 3) Tlačítko „Přepočítat tento projekt“ – přepočítá jen daný projekt

**Stav: funguje**

- **Endpoint:** `POST /projects/{project_id}/location-metrics/recompute`
- **Backend:** `main.py` – `recompute_project_location_metrics` (ř. 3210–3219): `_get_project_or_404`, pak `enrich_project_location_metrics(db, project_id)`, commit, vrací `{ project_id, computed }`.
- **Frontend:** `frontend/src/app/projects/[id]/page.tsx` – tlačítko v sekci Lokalita volá `handleRecomputeLocationMetrics` → POST na výše uvedený endpoint, po úspěchu znovu načte projekt a aktualizuje stav.
- **Klíčové soubory:** `main.py`, `project_location_metrics.py`, `projects/[id]/page.tsx`.

---

### 4) Tlačítko „Přepočítat všechny projekty“ – přepočítá všechny projekty s GPS

**Stav: funguje**

- **Endpoint:** `POST /admin/location-metrics/recompute-all`
- **Backend:** `main.py` – `admin_recompute_all_location_metrics` (ř. 3222–3225) volá `recompute_all_project_location_metrics(db)`. Ta v `project_location_metrics.py` (ř. 97–130) načte všechna `Project.id` s neprázdnými `gps_latitude` a `gps_longitude`, po dávkách volá `enrich_project_location_metrics(db, pid)` a po každé dávce commit. Vrací `{ processed, total, elapsed_seconds }`.
- **Frontend:** V detailu projektu při `?debug=1` sekce Dev s tlačítkem „Přepočítat všechny projekty“ volá `handleAdminRecomputeAll` → POST na tento endpoint a zobrazí výsledek.
- **Klíčové soubory:** `main.py`, `project_location_metrics.py`, `projects/[id]/page.tsx`.

---

### 5) Tlačítko „Obnovit zdrojová data + přepočítat vše“ – obnoví source data a pak přepočítá všechny projekty

**Stav: funguje (refresh jen pokud jsou v env nastavené cesty)**

- **Endpoint:** `POST /admin/location-sources/refresh-and-recompute`
- **Backend:** `main.py` – `admin_refresh_sources_and_recompute` (ř. 3228–3251) načte z `settings` cesty pro noise (den/noc) a OSM vrstvy. Zavolá `refresh_all_location_sources_and_recompute(db, noise_day_path=..., noise_night_path=..., osm_paths=...)`. V `location_sources.py` (ř. 184–207) tato funkce: (1) pokud jsou zadané cesty, zavolá `refresh_noise_source_data` (truncate + import z GeoJSON), (2) pokud je zadaný `osm_paths`, zavolá `refresh_osm_source_data` (truncate + import po vrstvách), (3) vždy zavolá `recompute_all_project_location_metrics(db)`. Bez nastavených cest v env se provede jen krok 3 (full recompute).
- **Nastavení:** Volitelné env proměnné: `LOCATION_SOURCE_NOISE_DAY_PATH`, `LOCATION_SOURCE_NOISE_NIGHT_PATH`, `LOCATION_SOURCE_OSM_PRIMARY_ROADS_PATH`, `LOCATION_SOURCE_OSM_TRAM_TRACKS_PATH`, `LOCATION_SOURCE_OSM_RAILWAY_PATH`, `LOCATION_SOURCE_OSM_AIRPORTS_PATH`.
- **Frontend:** Při `?debug=1` tlačítko „Obnovit zdrojová data + přepočítat vše“ volá `handleAdminRefreshAndRecompute` a zobrazí zprávu s výsledkem recompute.
- **Klíčové soubory:** `main.py`, `location_sources.py`, `settings.py`, `projects/[id]/page.tsx`.

---

## Shrnutí

| Co fungovalo | Co nefungovalo / omezení |
|--------------|---------------------------|
| 1) Auto-enrichment nových projektů s GPS při importu | — |
| 2) Auto-enrichment při změně GPS/regionu **z importu** | 2) Změna GPS **přes API override** – pole nejsou v katalogu editovatelná, API vrací 422; hook je připraven na budoucí zapnutí |
| 3) Přepočet jednoho projektu (tlačítko + endpoint) | — |
| 4) Přepočet všech projektů (tlačítko + endpoint) | — |
| 5) Refresh zdrojů + full recompute (endpoint; tlačítko volá endpoint) | 5) Refresh zdrojů proběhne jen pokud jsou v env nastavené cesty k GeoJSON; jinak se provede jen full recompute |

---

## Klíčové endpointy a soubory při testu

- **Endpointy:**  
  `POST /projects/{id}/location-metrics/recompute`  
  `POST /admin/location-metrics/recompute-all`  
  `POST /admin/location-sources/refresh-and-recompute`
- **Soubory:**  
  `backend/src/app/project_location_metrics.py` (enrich + full recompute)  
  `backend/src/app/location_sources.py` (refresh noise/OSM + combined job)  
  `backend/src/app/import_units.py` (hook po chunku)  
  `backend/src/app/main.py` (endpointy + hook put/delete project override)  
  `frontend/src/app/projects/[id]/page.tsx` (tlačítka)

---

## Připravenost pro produkční scheduler

- **Ano.**  
  - Per-project enrichment se volá při importu a (až budou GPS/region v override) při změně přes API.  
  - Full recompute: `POST /admin/location-metrics/recompute-all` nebo přímo `recompute_all_project_location_metrics(db)`.  
  - Kombinovaný job: `POST /admin/location-sources/refresh-and-recompute` (nebo `refresh_all_location_sources_and_recompute(db, ...)` s cestami). Scheduler může volat tento endpoint (např. 1× týdně/měsíčně); pokud nejsou v env cesty, proběhne jen full recompute.  
- **Doporučení:** V env nastavit cesty k GeoJSON pro noise a OSM, aby refresh zdrojů při volání „Obnovit zdrojová data + přepočítat vše“ skutečně naplnil tabulky. Případně přidat `gps_latitude` / `gps_longitude` (a `region_iga`) mezi editovatelná pole projektu (katalog nebo fallback v `overrides.py`), pokud má být změna GPS z UI podporována a má spouštět automatický přepočet.
