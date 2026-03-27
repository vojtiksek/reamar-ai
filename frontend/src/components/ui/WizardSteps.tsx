"use client";

import type { Dispatch, SetStateAction } from "react";
import clsx from "clsx";

type WizardStepsProps = {
  currentStep: number;
  setCurrentStep: Dispatch<SetStateAction<number>>;
  totalSteps: number;
};

const STEP_LABELS: Record<number, string> = {
  1: "Lokalita",
  2: "Mapa / prostředí",
  3: "Dispozice",
  4: "Rozpočet",
  5: "Standardy",
  6: "Charakter",
  7: "Shrnutí",
};

export function WizardSteps({ currentStep, setCurrentStep, totalSteps }: WizardStepsProps) {
  const steps = Array.from({ length: totalSteps }, (_, idx) => idx + 1);

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-slate-900/5/60 px-4 py-2 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
          {steps.map((step) => {
            const label = STEP_LABELS[step] ?? `Krok ${step}`;
            const isCurrent = step === currentStep;
            const isCompleted = step < currentStep;
            const isFuture = step > currentStep;

            return (
              <button
                key={step}
                type="button"
                onClick={() => setCurrentStep(step)}
                className={clsx(
                  "relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px]",
                  "transition-colors",
                  isCurrent && "bg-white text-slate-900 shadow-sm",
                  isCompleted && !isCurrent && "text-slate-700 hover:bg-white/50",
                  isFuture && !isCurrent && "text-slate-500 hover:bg-white/40"
                )}
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                    isCompleted
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent
                      ? "border-slate-900 text-slate-900"
                      : "border-slate-300 text-slate-400"
                  )}
                >
                  {isCompleted ? "✓" : step}
                </span>
                <span className={clsx("whitespace-nowrap", isCurrent && "font-semibold")}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <span className="hidden text-[11px] text-slate-500 sm:inline">
          Krok {currentStep} / {totalSteps}
        </span>
      </div>
    </div>
  );
}

