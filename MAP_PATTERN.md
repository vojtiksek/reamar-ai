# Map pattern

## File structure

```
frontend/src/app/projects/map/
  page.tsx               # Page shell: data fetching, state, layout
  ProjectsLeafletMap.tsx # Pure map component: renders markers, polygons, POI
```

## Required components

| Component | Role |
|---|---|
| `ProjectsLeafletMap` | Prop-driven Leaflet map; no internal fetching |
| `ClickCapture` (inside LeafletMap) | Captures map clicks for polygon drawing |
| `MapContainer`, `TileLayer`, `Marker`, `Popup`, `Polygon` | react-leaflet primitives |

Leaflet requires SSR to be disabled. Always load the map component via:

```ts
const MyMap = dynamic(() => import("./MyLeafletMap"), { ssr: false });
```

## Data flow

```
URL search params
  → parseFiltersFromSearchParams()
  → buildUnitsQuery()
  → fetch /api/projects?...   (paginated, 500 items per chunk)
  → filter items without GPS
  → isPointInPolygon() if polygon is active
  → visibleProjects[]
  → <ProjectsLeafletMap projects={visibleProjects} ... />
```

Secondary fetch (fires on project selection):

```
selectedProjectId
  → fetch /api/projects/:id/walkability-poi-overview?categories=...
  → poiOverviewData
  → <ProjectsLeafletMap poiOverview={poiOverviewData} ... />
```

## How to reuse the map on another page

1. Create `MyLeafletMap.tsx` next to your page. Copy the `Props` type, `getProjectMarkerIcon`, `markerIconCache`, and `ClickCapture` from `ProjectsLeafletMap.tsx`. Adjust the item type and popup content.

2. In your page, load it dynamically:
   ```ts
   const MyLeafletMap = dynamic(() => import("./MyLeafletMap"), { ssr: false });
   ```

3. Fetch your data in the page, compute `center` as the average lat/lng of items, pass everything as props:
   ```tsx
   <MyLeafletMap
     items={visibleItems}
     center={center}
     selectedId={selectedId}
     onSelect={setSelectedId}
   />
   ```

4. If you need polygon drawing, keep `polygon`, `draftPolygon`, `drawing`, and `onMapClick` props — they are already wired in `ClickCapture` and require no changes to the map internals.

5. If you need POI overlays, reuse the `PoiOverview` and `PoiOverviewItem` types exported from `ProjectsLeafletMap.tsx` and pass `poiOverview` as a prop.

## Key conventions

- Marker icons use `L.divIcon` with an inline-styled circle div. Cache icons in a `Map<string, L.DivIcon>` to avoid re-creation on every render.
- Color-code markers by a numeric value using HSL interpolation (see `priceToColor` in `ProjectsLeafletMap.tsx`).
- The map component itself never fetches data. All fetching lives in the page.
- Polygon state is serialised into the URL via `encodePolygon` / `decodePolygon` from `@/lib/geo` so it survives navigation.
