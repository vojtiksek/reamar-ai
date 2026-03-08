/** Backend API base URL. V produkci nastavte NEXT_PUBLIC_API_URL v .env */
export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://127.0.0.1:8001";

