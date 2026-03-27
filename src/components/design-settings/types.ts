export type DesignTab = "profile" | "palette" | "interface" | "llm";

export interface SignalSummaryItem {
  label: string;
  value: string;
}

export interface DesignPresetCopy {
  eyebrow: string;
  name: string;
  description: string;
}
