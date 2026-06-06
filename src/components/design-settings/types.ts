export type DesignTab = "profile" | "palette" | "interface" | "env" | "llm";

export interface SignalSummaryItem {
  label: string;
  value: string;
}

export interface DesignPresetCopy {
  eyebrow: string;
  name: string;
  description: string;
}
