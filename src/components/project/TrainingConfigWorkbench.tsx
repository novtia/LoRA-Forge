import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Clipboard, FileCode2, FolderOpen, ListTree, LoaderCircle } from "lucide-react";
import type { TrainingConfigPreview } from "../../lib/types";
import type { TrainerField, TrainerSection } from "../../lib/trainerSchema/types";

interface TrainingConfigWorkbenchProps<T extends object> {
  title: string;
  config: T;
  sections: TrainerSection<T>[];
  onChange: (next: T) => void;
  preview: (config: T) => Promise<TrainingConfigPreview>;
  toolbar?: ReactNode;
}

type PreviewTab = "main" | "dataset" | "command";

export default function TrainingConfigWorkbench<T extends object>({
  title,
  config,
  sections,
  onChange,
  preview,
  toolbar,
}: TrainingConfigWorkbenchProps<T>) {
  const [previewData, setPreviewData] = useState<TrainingConfigPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("main");
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const id = ++requestId.current;
      setPreviewLoading(true);
      preview(config)
        .then((result) => {
          if (requestId.current !== id) return;
          setPreviewData(result);
          setPreviewError("");
        })
        .catch((error: unknown) => {
          if (requestId.current !== id) return;
          setPreviewError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (requestId.current === id) setPreviewLoading(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [config, preview]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -72% 0px", threshold: 0 },
    );
    Object.values(sectionRefs.current).forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  const previewText = useMemo(() => {
    if (!previewData) return "";
    if (previewTab === "dataset") return previewData.datasetToml;
    if (previewTab === "command") return previewData.command;
    return previewData.mainToml;
  }, [previewData, previewTab]);

  const setField = (field: TrainerField<T>, value: unknown) => {
    onChange({ ...config, [field.key]: value });
  };

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  };

  const copyPreview = async () => {
    if (!previewText) return;
    await navigator.clipboard.writeText(previewText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="training-workbench">
      <div className="card training-workbench-toolbar">
        <div>
          <div className="training-workbench-kicker">TRAINING PARAMETERS</div>
          <div className="training-workbench-title">{title}</div>
        </div>
        {toolbar ? <div className="training-workbench-toolbar-actions">{toolbar}</div> : null}
      </div>

      <div className="training-workbench-layout">
        <main className="training-workbench-form">
          {sections.map((section) => {
            const fields = section.fields.filter((field) => !field.visible || field.visible(config));
            if (fields.length === 0) return null;
            return (
              <section
                id={section.id}
                key={section.id}
                ref={(node) => { sectionRefs.current[section.id] = node; }}
                className="card training-workbench-section"
              >
                <div className="card-header training-workbench-section-header">
                  <div>
                    <div className="training-workbench-section-title">{section.title}</div>
                    {section.description ? (
                      <div className="training-workbench-section-description">{section.description}</div>
                    ) : null}
                  </div>
                  <span className="training-workbench-count">{fields.length} 项</span>
                </div>
                <div className="training-workbench-fields">
                  {fields.map((field) => (
                    <Field
                      key={field.key}
                      field={field}
                      value={config[field.key]}
                      onChange={(value) => setField(field, value)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </main>

        <aside className="training-workbench-side">
          <div className="card training-workbench-preview">
            <div className="training-workbench-panel-header">
              <span><FileCode2 size={14} /> TOML 预览</span>
              <button type="button" className="training-workbench-icon-btn" onClick={() => void copyPreview()}>
                {copied ? <Check size={13} /> : <Clipboard size={13} />}
              </button>
            </div>
            <div className="training-workbench-preview-tabs">
              {([
                ["main", "主配置"],
                ["dataset", "数据集"],
                ["command", "命令"],
              ] as Array<[PreviewTab, string]>).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={previewTab === id ? "active" : ""}
                  onClick={() => setPreviewTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="training-workbench-code-wrap">
              {previewLoading ? (
                <div className="training-workbench-preview-status"><LoaderCircle size={14} className="spin" /> 正在生成</div>
              ) : null}
              {previewError ? (
                <div className="training-workbench-preview-error">{previewError}</div>
              ) : (
                <pre className="training-workbench-code"><code>{previewText || "等待配置预览…"}</code></pre>
              )}
            </div>
          </div>

          <nav className="card training-workbench-index" aria-label="参数章节索引">
            <div className="training-workbench-panel-header">
              <span><ListTree size={14} /> 参数索引</span>
            </div>
            <div className="training-workbench-index-list">
              {sections.map((section, index) => (
                <button
                  type="button"
                  key={section.id}
                  className={activeSection === section.id ? "active" : ""}
                  onClick={() => scrollToSection(section.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </button>
              ))}
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

function Field<T extends object>({
  field,
  value,
  onChange,
}: {
  field: TrainerField<T>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const browse = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: field.kind === "directory",
      filters: field.extensions?.length
        ? [{ name: field.label, extensions: field.extensions }]
        : undefined,
      title: field.label,
    });
    if (selected) onChange(selected as string);
  };

  if (field.kind === "toggle") {
    return (
      <button
        type="button"
        className={`training-workbench-toggle${value ? " active" : ""}`}
        onClick={() => onChange(!value)}
      >
        <span>
          <strong>{field.label}</strong>
          {field.hint ? <small>{field.hint}</small> : null}
        </span>
        <i aria-hidden="true" />
      </button>
    );
  }

  const normalizedOptions = field.options?.map((option) =>
    typeof option === "string" ? { label: option || "默认", value: option } : option,
  );
  return (
    <label className={`training-workbench-field${field.wide ? " wide" : ""}`}>
      <span>{field.label}</span>
      {field.kind === "select" ? (
        <select className="form-select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {normalizedOptions?.map((option) => (
            <option key={`${field.key}-${option.value}`} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : field.kind === "textarea" ? (
        <textarea
          className="form-input"
          rows={4}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === "file" || field.kind === "directory" ? (
        <div className="training-workbench-path">
          <input
            className="form-input"
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <button type="button" onClick={() => void browse()} title="浏览">
            <FolderOpen size={14} />
          </button>
        </div>
      ) : (
        <input
          className="form-input"
          type={field.kind === "number" ? "number" : "text"}
          min={field.min}
          step={field.step}
          value={field.kind === "number" ? Number(value ?? 0) : String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.kind === "number" ? Number(e.target.value) : e.target.value)}
        />
      )}
      {field.hint ? <small>{field.hint}</small> : null}
    </label>
  );
}
