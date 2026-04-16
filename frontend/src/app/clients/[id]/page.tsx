"use client";

import { useParams, redirect } from "next/navigation";

export default function LegacyClientRedirect() {
  const { id } = useParams<{ id: string }>();
  redirect(`/cases/${id}/brief`);
}
