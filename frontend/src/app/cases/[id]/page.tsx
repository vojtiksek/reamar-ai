import { redirect } from "next/navigation";

export default async function CaseIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/cases/${id}/overview`);
}
