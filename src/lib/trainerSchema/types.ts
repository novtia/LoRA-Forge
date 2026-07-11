export type TrainerFieldKind =
  | "text"
  | "number"
  | "select"
  | "toggle"
  | "textarea"
  | "file"
  | "directory";

export interface TrainerFieldOption {
  label: string;
  value: string;
}

export interface TrainerField<T extends object> {
  key: keyof T & string;
  label: string;
  kind: TrainerFieldKind;
  hint?: string;
  placeholder?: string;
  options?: Array<string | TrainerFieldOption>;
  min?: number;
  step?: number;
  wide?: boolean;
  visible?: (config: T) => boolean;
  extensions?: string[];
}

export interface TrainerSection<T extends object> {
  id: string;
  title: string;
  description?: string;
  fields: Array<TrainerField<T>>;
}
