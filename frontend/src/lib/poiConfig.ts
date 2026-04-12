/** POI category slugs, labels, and colours — mirrors backend WALKABILITY_POI_CATEGORIES */

export const POI_CATEGORY_LABELS: Record<string, string> = {
  restaurants: "Restaurace",
  cafes: "Kavárny",
  supermarkets: "Supermarkety",
  pharmacies: "Lékárny",
  parks: "Parky",
  fitness: "Fitness",
  playgrounds: "Hřiště",
  kindergartens: "Školky",
  primary_schools: "Základní školy",
  tram_stops: "Tram zastávky",
  bus_stops: "Bus zastávky",
  metro_stations: "Metro",
};

export const POI_CATEGORY_COLORS: Record<string, string> = {
  restaurants: "#f97316",
  cafes: "#a16207",
  supermarkets: "#16a34a",
  pharmacies: "#0ea5e9",
  parks: "#22c55e",
  fitness: "#8b5cf6",
  playgrounds: "#ec4899",
  kindergartens: "#f59e0b",
  primary_schools: "#3b82f6",
  tram_stops: "#14b8a6",
  bus_stops: "#64748b",
  metro_stations: "#6366f1",
};

export const ALL_POI_CATEGORIES = Object.keys(POI_CATEGORY_LABELS);

export const DEFAULT_POI_CATEGORIES = [
  "supermarkets",
  "parks",
  "tram_stops",
  "metro_stations",
];
