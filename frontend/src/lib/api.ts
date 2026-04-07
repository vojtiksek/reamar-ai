import type { RecommendationDislikeReason, RecommendationFeedback, RecommendationFeedbackType, FlatWeightsResponse } from "@/lib/caseTypes";

/** Backend API base URL. V produkci nastavte NEXT_PUBLIC_API_URL v .env */
const envApiBase =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL : undefined;

export const API_BASE =
  envApiBase ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8001`
    : "http://localhost:8001");

export async function putRecommendationFeedback(params: {
  token: string;
  clientId: number;
  recId: number;
  feedbackType: RecommendationFeedbackType;
  dislikeReason?: RecommendationDislikeReason | null;
  note?: string | null;
}): Promise<RecommendationFeedback> {
  const res = await fetch(
    `${API_BASE}/clients/${params.clientId}/recommendations/${params.recId}/feedback`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        feedback_type: params.feedbackType,
        dislike_reason: params.dislikeReason ?? null,
        note: params.note ?? null,
      }),
    }
  );
  if (!res.ok) {
    throw new Error("Nepodařilo se uložit feedback.");
  }
  return (await res.json()) as RecommendationFeedback;
}

export async function deleteRecommendationFeedback(params: {
  token: string;
  clientId: number;
  recId: number;
}): Promise<void> {
  const res = await fetch(
    `${API_BASE}/clients/${params.clientId}/recommendations/${params.recId}/feedback`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${params.token}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error("Nepodařilo se smazat feedback.");
  }
}

export async function getClientFlatWeights(
  clientId: number,
  token: string,
): Promise<FlatWeightsResponse> {
  const res = await fetch(`${API_BASE}/clients/${clientId}/flat-weights`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Nepodařilo se načíst váhy.");
  return (await res.json()) as FlatWeightsResponse;
}

export async function setClientBrokerWeightOverrides(
  clientId: number,
  token: string,
  overrides: Record<string, number>,
): Promise<{ broker_overrides: Record<string, number> | null; effective_weights: Record<string, number> }> {
  const res = await fetch(
    `${API_BASE}/clients/${clientId}/flat-weights/broker-overrides`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(overrides),
    },
  );
  if (!res.ok) throw new Error("Nepodařilo se uložit override vah.");
  return res.json();
}

export async function deleteClientBrokerWeightOverrides(
  clientId: number,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/clients/${clientId}/flat-weights/broker-overrides`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error("Nepodařilo se smazat override vah.");
}

