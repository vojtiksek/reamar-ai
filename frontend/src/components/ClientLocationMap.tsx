"use client";

import dynamic from "next/dynamic";

type Point = { lat: number; lng: number };
type Area = Point[];

type EditorProps = {
  areas: Area[];
  onChange: (areas: Area[]) => void;
  activeAreaIndex: number;
  onActiveAreaChange: (index: number) => void;
};

const InnerMap = dynamic<EditorProps>(
  () => import("./ClientLocationMapInner").then((m) => m.ClientLocationMapInner),
  { ssr: false }
);

export function ClientLocationMap(props: EditorProps) {
  return <InnerMap {...props} />;
}


