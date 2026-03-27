"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// Palette (light theme, premium advisory):
// - Primary: dark navy (#0f172a / slate-900)
// - Accent: muted blue for data/map (#1d4ed8 / blue-700)
// - Surface: warm neutral (#f9fafb / slate-50) with soft shadow

export const reamarCardClass = cn(
  "rounded-3xl border border-slate-200/80 bg-slate-50/80",
  "shadow-[0_18px_45px_rgba(15,23,42,0.08)]",
  "backdrop-blur-sm"
);

export const reamarSubtleCardClass = cn(
  "rounded-2xl border border-slate-200/70 bg-white/80",
  "shadow-[0_14px_30px_rgba(15,23,42,0.06)]"
);

export const reamarInputClass = cn(
  "w-full rounded-lg border border-slate-300/90 bg-white/95",
  "px-3 py-2 text-sm text-slate-900",
  "placeholder:text-slate-400",
  "shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
  "focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10",
  "disabled:cursor-not-allowed disabled:opacity-60"
);

export const reamarSelectClass = reamarInputClass;

export const reamarLabelClass = cn(
  "block text-xs font-medium uppercase tracking-[0.16em] text-slate-600"
);

export const reamarFieldHintClass = cn("mt-1 text-[11px] text-slate-500");

type ReamarButtonVariant = "primary" | "secondary" | "ghost" | "subtle";
type ReamarButtonSize = "sm" | "md";

type ReamarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ReamarButtonVariant;
  size?: ReamarButtonSize;
};

export function ReamarButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ReamarButtonProps) {
  const base = cn(
    "inline-flex items-center justify-center rounded-full font-medium",
    "transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  );

  const sizeClass =
    size === "sm"
      ? "px-3 py-1.5 text-xs"
      : "px-4 py-2 text-sm";

  const variantClass =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : variant === "secondary"
      ? "border border-slate-900 bg-transparent text-slate-900 hover:bg-slate-900 hover:text-white"
      : variant === "subtle"
      ? "border border-slate-200 bg-white/80 text-slate-900 hover:bg-slate-50"
      : "text-slate-600 hover:bg-slate-100";

  return <button className={cn(base, sizeClass, variantClass, className)} {...props} />;
}

type CardProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export function ReamarCard({ className, ...props }: CardProps) {
  return <div className={cn(reamarCardClass, className)} {...props} />;
}

export function ReamarSubtleCard({ className, ...props }: CardProps) {
  return <div className={cn(reamarSubtleCardClass, className)} {...props} />;
}

type InfoBoxTone = "neutral" | "success" | "warning" | "danger";

type InfoBoxProps = {
  title?: string;
  tone?: InfoBoxTone;
  children: ReactNode;
  className?: string;
};

export function InfoBox({ title, tone = "neutral", children, className }: InfoBoxProps) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200/80 bg-emerald-50/80 text-emerald-900"
      : tone === "warning"
      ? "border-amber-200/80 bg-amber-50/80 text-amber-900"
      : tone === "danger"
      ? "border-rose-200/80 bg-rose-50/80 text-rose-900"
      : "border-slate-200/80 bg-slate-50/80 text-slate-800";

  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2 text-xs shadow-[0_10px_25px_rgba(15,23,42,0.04)]",
        toneClass,
        className
      )}
    >
      {title && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em]">{title}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: ReactNode;
  sublabel?: string;
  className?: string;
};

export function StatCard({ label, value, sublabel, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-3 text-xs",
        "shadow-[0_12px_30px_rgba(15,23,42,0.05)]",
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {sublabel && <p className="mt-0.5 text-[11px] text-slate-500">{sublabel}</p>}
    </div>
  );
}

type WizardStepHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  step: number;
  totalSteps: number;
};

export function WizardStepHeader({
  eyebrow = "Klientský wizard",
  title,
  description,
  step,
  totalSteps,
}: WizardStepHeaderProps) {
  const progress = Math.max(0, Math.min(1, totalSteps ? step / totalSteps : 0));

  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {eyebrow}
        </p>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {description && (
          <p className="max-w-xl text-xs text-slate-600">
            {description}
          </p>
        )}
      </div>
      <div className="text-right">
        <span className="text-[11px] font-medium text-slate-500">
          Krok {step} / {totalSteps}
        </span>
        <div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-slate-900 transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

