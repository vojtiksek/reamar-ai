import { redirect } from "next/navigation";

export default function LegacyUnitsRedirect() {
  redirect("/explorer/units");
}
