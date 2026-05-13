export type DesignTab = "profile" | "palette" | "interface" | "training" | "llm";

export interface SignalSummaryItem {
  label: string;
  value: string;
}

export interface DesignPresetCopy {
  eyebrow: string;
  name: string;
  description: string;
}
