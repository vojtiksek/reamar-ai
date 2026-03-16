"use client";

import dynamic from "next/dynamic";

type Point = { lat: number; lng: number };
type Area = Point[];

export type LocationProjectPoint = {
  id: number;
  project: string | null;
  municipality?: string | null;
  city?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
};

type EditorProps = {
  areas: Area[];
  onChange: (areas: Area[]) => void;
  activeAreaIndex: number;
  onActiveAreaChange: (index: number) => void;
  projects: LocationProjectPoint[];
};

const InnerMap = dynamic<EditorProps>(
  () => import("./ClientLocationMapInner").then((m) => m.ClientLocationMapInner),
  { ssr: false }
);

export function ClientLocationMap(props: EditorProps) {
  return <InnerMap {...props} />;
}


