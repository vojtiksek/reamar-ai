import { redirect } from "next/navigation";

// Legacy route — consolidated into /admin/scoring (fáze 12).
// The V2 engine parameters live under the "Parametry V2 engine" tab there.
export default function ScoringV2Redirect() {
  redirect("/admin/scoring");
}
