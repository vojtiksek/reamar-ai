import { redirect } from "next/navigation";

// Legacy route — consolidated into /admin/scoring (fáze 12).
// Old tabs (Weights / Groups / Field rules / Eligibility rules) targeted the
// legacy compute_match() pipeline which is no longer invoked in production.
// Only Thresholds survived and now lives in /admin/scoring along with the
// V2 engine parameters.
export default function StudioRedirect() {
  redirect("/admin/scoring");
}
