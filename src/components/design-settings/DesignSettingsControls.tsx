import type { ReactNode } from "react";

export function SegmentControl<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="design-segment-group">
      <div className="design-segment-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="design-segment-row">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`design-segment-btn${option.value === value ? " active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ToggleRow({
  icon,
  label,
  description,
  checked,
  onToggle,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="design-toggle-row" onClick={onToggle} disabled={disabled}>
      <div className="design-toggle-copy">
        <div className="design-toggle-title">
          {icon}
          <span>{label}</span>
        </div>
        <p>{description}</p>
      </div>
      <div className={`switch${checked ? " active" : ""}`} aria-hidden="true" />
    </button>
  );
}
