import { useMemo, useState } from "react";
import {
  Box,
  Cpu,
  Database,
  Download,
  FolderOpen,
  Gauge,
  Network,
  Save,
  Settings2,
  Sliders,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { DiffusionPipeConfig } from "../../lib/types";
import { readTextFile, writeTextFile } from "../../lib/desktopApi";
import {
  createDpPreset,
  loadDpPresetsFromStorage,
  saveDpPresetsToStorage,
  type DiffusionPipePreset,
} from "../../lib/presets";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";

// ─── Shared mini-components (same style as ConfigEditor) ────────────────────

function SectionCard({
  title,
  icon,
  animationDelay = "0s",
  children,
}: {
  title: string;
  icon: React.ReactNode;
  animationDelay?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card fade-in-section" style={{ gridColumn: "span 12", animationDelay }}>
      <div className="card-header">
        <span className="card-title-icon">
          {icon} {title}
        </span>
      </div>
      <div style={{ padding: "0.85rem 1rem" }}>{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type="text"
        className="form-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "0.3rem", lineHeight: 1.4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  hint?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type="number"
        className="form-input"
        value={value}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? (
        <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "0.3rem", lineHeight: 1.4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { label: string; value: string }>;
  hint?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select className="form-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => {
          const o = typeof opt === "string" ? { label: opt, value: opt } : opt;
          return (
            <option key={o.value || o.label} value={o.value}>
              {o.label}
            </option>
          );
        })}
      </select>
      {hint ? (
        <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "0.3rem", lineHeight: 1.4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function ToggleSwitch({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="switch-wrapper"
      onClick={onToggle}
      style={{
        background: "transparent",
        border: "1px solid var(--border-dim)",
        padding: "0.65rem 0.75rem",
        justifyContent: "space-between",
      }}
    >
      <span className="form-label" style={{ margin: 0 }}>
        {label}
      </span>
      <div className={`switch${active ? " active" : ""}`} />
    </button>
  );
}

function FilePickerField({
  label,
  value,
  onChange,
  placeholder,
  filters,
  allowDirectory,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  filters?: { name: string; extensions: string[] }[];
  /** If true, browse as folder; otherwise browse as file using `filters`. */
  allowDirectory?: boolean;
}) {
  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: allowDirectory ?? false,
        // no filters = show all files; only apply filters when explicitly provided
        filters: (allowDirectory || !filters) ? undefined : filters,
      });
      if (selected) onChange(selected as string);
    } catch {
      // cancelled
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <input
          type="text"
          className="form-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          onClick={() => void handleBrowse()}
          title={allowDirectory ? "选择文件夹" : "选择文件"}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "2rem",
            height: "2rem",
            border: "1px solid var(--border-dim)",
            borderRadius: "var(--radius-sm, 4px)",
            background: "var(--surface-raised, var(--bg-card))",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <FolderOpen size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Model type options ──────────────────────────────────────────────────────

const MODEL_OPTIONS: { label: string; value: string }[] = [
  { value: "hunyuan-video", label: "HunyuanVideo" },
  { value: "hunyuan_video_15", label: "HunyuanVideo 1.5" },
  { value: "hunyuan_image", label: "HunyuanImage 2.1" },
  { value: "wan", label: "Wan 2.1 / 2.2" },
  { value: "flux", label: "Flux" },
  { value: "flux2", label: "Flux 2" },
  { value: "ltx-video", label: "LTX-Video" },
  { value: "ltx2", label: "LTX 2.3" },
  { value: "sdxl", label: "SDXL" },
  { value: "sd3", label: "Stable Diffusion 3" },
  { value: "cosmos", label: "Cosmos" },
  { value: "cosmos_predict2", label: "Cosmos-Predict2" },
  { value: "anima", label: "Anima" },
  { value: "lumina_2", label: "Lumina Image 2.0" },
  { value: "chroma", label: "Chroma" },
  { value: "hidream", label: "HiDream" },
  { value: "omnigen2", label: "OmniGen2" },
  { value: "qwen_image", label: "Qwen-Image" },
  { value: "auraflow", label: "AuraFlow" },
  { value: "z_image", label: "Z-Image" },
  { value: "ernie_image", label: "Ernie-Image" },
];

const USES_DIFFUSERS_PATH = new Set(["qwen_image", "ernie_image", "z_image"]);
const SUPPORTS_BLOCK_SWAP = new Set(["wan", "hunyuan-video", "hunyuan_video_15", "flux", "flux2", "chroma"]);

/** Which optional component path fields each model needs. */
interface ModelComponents {
  /** Row-2 Transformer 路径字段（仅 hunyuan 等目录型模型需要：ckpt_path 是目录，transformer_path 是单独文件） */
  transformer?: boolean;
  vae?: boolean;
  llm?: boolean;
  clip?: boolean;
}

/**
 * 使用 ckpt_path（整体目录）作为主路径的模型。
 * 其它模型（anima/flux/chroma/…）直接以 Row-1 的路径作为 transformer_path。
 */
const USES_CKPT_PATH = new Set(["hunyuan-video", "hunyuan_video_15"]);

const MODEL_COMPONENTS: Record<string, ModelComponents> = {
  // hunyuan: ckpt_path 是目录，Row-2 里还需要单独指定 transformer
  "hunyuan-video":    { transformer: true, vae: true, llm: true, clip: true },
  "hunyuan_video_15": { transformer: true, vae: true, llm: true, clip: true },
  // 以下模型 Row-1 本身就是 transformer_path，无需 Row-2 重复
  "anima":            { vae: true, llm: true },
  "flux":             { vae: true },
  "flux2":            { vae: true },
  "chroma":           {},
  "hidream":          { vae: true },
  "sd3":              { vae: true },
};

function modelComponents(modelType: string): ModelComponents {
  return MODEL_COMPONENTS[modelType] ?? {};
}

// ─── Main component ──────────────────────────────────────────────────────────

type TabKey = "basic" | "advanced" | "expert";

interface DiffusionPipeConfigPanelProps {
  /** Current config managed by parent (null while loading). */
  config: DiffusionPipeConfig | null;
  /** Called whenever any field changes — parent owns state. */
  onChange: (next: DiffusionPipeConfig) => void;
}

export default function DiffusionPipeConfigPanel({
  config,
  onChange,
}: DiffusionPipeConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [presets, setPresets] = useState<DiffusionPipePreset[]>(() => loadDpPresetsFromStorage());
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetError, setSavePresetError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  const update = <K extends keyof DiffusionPipeConfig>(key: K, value: DiffusionPipeConfig[K]) => {
    if (!config) return;
    onChange({ ...config, [key]: value });
  };

  const handleExport = async () => {
    if (!config) return;
    try {
      const savePath = await saveDialog({
        title: "导出 diffusion-pipe 配置",
        defaultPath: "dp_config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!savePath) return;
      await writeTextFile(savePath as string, JSON.stringify(config, null, 2));
    } catch {
      // cancelled
    }
  };

  const handleApplyPreset = () => {
    const preset = presets.find((p) => p.id === selectedPresetId);
    if (!preset || !config) return;
    onChange({ ...config, ...preset.config });
    setPresetError(null);
  };

  const confirmSavePreset = () => {
    const name = savePresetName.trim();
    if (!name) { setSavePresetError("请输入预设名称"); return; }
    if (!config) return;
    setSavePresetError(null);
    const next = [...presets, createDpPreset(name, config)];
    setPresets(next);
    saveDpPresetsToStorage(next);
    setSelectedPresetId(next[next.length - 1].id);
    setSavePresetOpen(false);
    setSavePresetName("");
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    const next = presets.filter((p) => p.id !== selectedPresetId);
    setPresets(next);
    saveDpPresetsToStorage(next);
    setSelectedPresetId("");
  };

  const presetMenuGroups = useMemo((): PresetMenuGroup[] => {
    if (presets.length === 0) return [];
    return [{ label: "已保存预设", items: presets.map((p) => ({ id: p.id, label: p.label })) }];
  }, [presets]);

  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        title: "导入 diffusion-pipe 配置",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const text = await readTextFile(filePath as string);
      const parsed = JSON.parse(text) as Partial<DiffusionPipeConfig>;
      if (config) onChange({ ...config, ...parsed });
      setPresetError(null);
    } catch {
      setPresetError("配置导入失败");
    }
  };

  if (!config) {
    return (
      <div className="bento bento-detail view-config">
        <div className="card" style={{ gridColumn: "span 12", padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
          加载中...
        </div>
      </div>
    );
  }

  const modelType = config.modelType;
  const usesDiffusersPath = USES_DIFFUSERS_PATH.has(modelType);
  const usesCkptPath      = USES_CKPT_PATH.has(modelType);
  const supportsBlockSwap = SUPPORTS_BLOCK_SWAP.has(modelType);
  const { transformer: needsTransformer, vae: needsVae, llm: needsLlm, clip: needsClip } =
    modelComponents(modelType);

  // Row-1 字段的标签和提示语
  const mainPathLabel = usesDiffusersPath
    ? "模型路径 (diffusers_path)"
    : usesCkptPath
    ? "模型目录 (ckpt_path)"
    : "Transformer 路径 (主模型)";
  const mainPathPlaceholder = usesDiffusersPath
    ? "/mnt/d/models/Qwen-Image"
    : usesCkptPath
    ? "/mnt/d/models/HunyuanVideo/ckpts"
    : "model.safetensors 或 transformer.safetensors";

  return (
    <div className="bento bento-detail view-config">
      {/* ── Top control bar ─────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          gridColumn: "span 12",
          padding: "0.55rem",
          background:
            "linear-gradient(90deg, rgba(0, 212, 255, 0.06), transparent 28%, transparent 72%, rgba(255, 85, 0, 0.06)), var(--bg-surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "0.55rem",
            padding: "0.1rem 0.15rem 0",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.66rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            diffusion-pipe 训练参数
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              color: "var(--accent-acid)",
              textTransform: "uppercase",
            }}
          >
            {activeTab === "basic" ? "基础" : activeTab === "advanced" ? "高级" : "专家"}
          </div>
        </div>

        {/* ── Preset bar ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            marginBottom: "0.45rem",
            padding: "0 0.1rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}
          >
            预设
          </span>

          <PresetDropdownMenu
            value={selectedPresetId}
            onChange={(v) => { setSelectedPresetId(v); setPresetError(null); }}
            placeholder="— 选择预设 —"
            groups={presetMenuGroups}
            allowEmptyValue
          />

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.75rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}
            disabled={!selectedPresetId}
            onClick={handleApplyPreset}
          >
            应用
          </button>

          <button
            type="button"
            className="btn btn-primary"
            style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            onClick={() => { setSavePresetName(""); setSavePresetError(null); setSavePresetOpen(true); }}
          >
            <Save size={12} /> 保存预设
          </button>

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            onClick={() => void handleImport()}
          >
            <Upload size={12} /> 导入
          </button>

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            onClick={() => void handleExport()}
          >
            <Download size={12} /> 导出
          </button>

          {selectedPresetId ? (
            <button
              type="button"
              className="btn"
              style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", opacity: 0.7 }}
              onClick={handleDeletePreset}
              title="删除选中预设"
            >
              删除
            </button>
          ) : null}
        </div>

        {/* preset error hint — same pattern as ConfigEditor's presetError */}
        {presetError ? (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--accent-orange)", marginBottom: "0.4rem", padding: "0 0.1rem" }}>
            {presetError}
          </div>
        ) : null}

        {/* ── Tab buttons ─────────────────────────────────────────── */}
        <div className="design-segment-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "basic" ? "active" : ""}`}
            onClick={() => setActiveTab("basic")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Box size={14} /> 基础
          </button>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "advanced" ? "active" : ""}`}
            onClick={() => setActiveTab("advanced")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Settings2 size={14} /> 高级
          </button>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "expert" ? "active" : ""}`}
            onClick={() => setActiveTab("expert")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Wrench size={14} /> 专家
          </button>
        </div>
      </div>

      {/* ── Basic tab ─────────────────────────────────────────────── */}
      {activeTab === "basic" ? (
        <>
          <SectionCard title="基础设置" icon={<Cpu size={18} />} animationDelay="0s">
            {/* Row 1: model type + main path + dtype fields */}
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              <SelectField
                label="模型类型"
                value={config.modelType}
                onChange={(v) => update("modelType", v)}
                options={MODEL_OPTIONS}
              />
              <FilePickerField
                label={mainPathLabel}
                value={config.modelPath}
                placeholder={mainPathPlaceholder}
                onChange={(v) => update("modelPath", v)}
                filters={usesDiffusersPath ? undefined : [{ name: "Model", extensions: ["safetensors", "ckpt", "pt", "bin"] }]}
                allowDirectory={usesDiffusersPath || usesCkptPath}
              />
              <SelectField
                label="模型 dtype"
                value={config.modelDtype}
                onChange={(v) => update("modelDtype", v)}
                options={["bfloat16", "float16", "float32"]}
              />
              <SelectField
                label="Transformer dtype"
                value={config.transformerDtype}
                onChange={(v) => update("transformerDtype", v)}
                options={[
                  { label: "float8（推荐，省显存）", value: "float8" },
                  { label: "bfloat16", value: "bfloat16" },
                  { label: "float16", value: "float16" },
                  { label: "float32", value: "float32" },
                ]}
              />
              <SelectField
                label="时间步采样方法"
                value={config.timestepSampleMethod}
                onChange={(v) => update("timestepSampleMethod", v)}
                options={["logit_normal", "uniform"]}
              />
            </div>

            {/* Row 2: component paths — only shown when model needs them */}
            {(needsTransformer || needsVae || needsLlm || needsClip) ? (
              <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: "0.5rem" }}>
                {needsTransformer ? (
                  <FilePickerField
                    label="Transformer 路径"
                    value={config.transformerPath}
                    placeholder="transformer.safetensors"
                    onChange={(v) => update("transformerPath", v)}
                    filters={[{ name: "Model", extensions: ["safetensors", "ckpt", "pt"] }]}
                  />
                ) : null}
                {needsVae ? (
                  <FilePickerField
                    label="VAE 路径"
                    value={config.vaePath}
                    placeholder="vae.safetensors"
                    onChange={(v) => update("vaePath", v)}
                    filters={[{ name: "VAE", extensions: ["safetensors", "pt", "bin"] }]}
                  />
                ) : null}
                {needsLlm ? (
                  <FilePickerField
                    label="LLM / 文本编码器路径"
                    value={config.llmPath}
                    placeholder="D:\models\qwen_3_06b_base.safetensors 或目录"
                    onChange={(v) => update("llmPath", v)}
                  />
                ) : null}
                {needsClip ? (
                  <FilePickerField
                    label="CLIP 路径"
                    value={config.clipPath}
                    placeholder="D:\models\clip-vit-large-patch14 或 .safetensors"
                    onChange={(v) => update("clipPath", v)}
                  />
                ) : null}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="核心训练" icon={<Zap size={18} />} animationDelay="0.04s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label="Epochs"
                value={config.epochs}
                min={1}
                onChange={(v) => update("epochs", v)}
              />
              <NumberField
                label="Max Steps（0=不限）"
                value={config.maxSteps}
                min={0}
                onChange={(v) => update("maxSteps", v)}
              />
              <NumberField
                label="单 GPU Batch Size"
                value={config.microBatchSizePerGpu}
                min={1}
                onChange={(v) => update("microBatchSizePerGpu", v)}
              />
              <NumberField
                label="梯度累积步数"
                value={config.gradientAccumulationSteps}
                min={1}
                onChange={(v) => update("gradientAccumulationSteps", v)}
              />
              <SelectField
                label="优化器"
                value={config.optimizerType}
                onChange={(v) => update("optimizerType", v)}
                options={[
                  { label: "adamw_optimi（推荐）", value: "adamw_optimi" },
                  { label: "AdamW8bitKahan（低显存）", value: "AdamW8bitKahan" },
                  { label: "automagic（自动）", value: "automagic" },
                  { label: "AdamW", value: "AdamW" },
                  { label: "Prodigy", value: "Prodigy" },
                ]}
              />
              <TextField
                label="学习率"
                value={config.lr}
                placeholder="2e-5"
                onChange={(v) => update("lr", v)}
              />
              <TextField
                label="Weight Decay"
                value={config.weightDecay}
                placeholder="0.01"
                onChange={(v) => update("weightDecay", v)}
              />
              <NumberField
                label="Warmup 步数"
                value={config.warmupSteps}
                min={0}
                onChange={(v) => update("warmupSteps", v)}
              />
            </div>
          </SectionCard>

          <SectionCard title="LoRA / Adapter" icon={<Network size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <SelectField
                label="Adapter 类型"
                value={config.adapterType}
                onChange={(v) => update("adapterType", v)}
                options={[
                  { label: "LoRA", value: "lora" },
                  { label: "全量微调 (FFT)", value: "" },
                ]}
              />
              <NumberField
                label="LoRA Rank"
                value={config.loraRank}
                min={1}
                onChange={(v) => update("loraRank", v)}
              />
              <SelectField
                label="LoRA dtype"
                value={config.loraDtype}
                onChange={(v) => update("loraDtype", v)}
                options={["bfloat16", "float16", "float32"]}
              />
            </div>
          </SectionCard>

          <SectionCard title="性能与内存" icon={<Gauge size={18} />} animationDelay="0.12s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <SelectField
                label="激活检查点"
                value={config.activationCheckpointing}
                onChange={(v) => update("activationCheckpointing", v)}
                options={[
                  { label: "true（推荐）", value: "true" },
                  { label: "unsloth（极低显存）", value: "unsloth" },
                  { label: "false（关闭）", value: "false" },
                ]}
              />
              {supportsBlockSwap ? (
                <NumberField
                  label="Block Swap 数量"
                  value={config.blocksToSwap}
                  min={0}
                  hint="卸载部分层到内存；0=禁用"
                  onChange={(v) => update("blocksToSwap", v)}
                />
              ) : null}
              <ToggleSwitch
                label="禁用 NCCL P2P/IB（RTX 4000 系列必需）"
                active={config.ncclDisable}
                onToggle={() => update("ncclDisable", !config.ncclDisable)}
              />
            </div>
          </SectionCard>
        </>
      ) : null}

      {/* ── Advanced tab ──────────────────────────────────────────── */}
      {activeTab === "advanced" ? (
        <>
          <SectionCard title="数据集" icon={<Database size={18} />} animationDelay="0s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <TextField
                label="分辨率"
                value={config.datasetResolutions}
                placeholder="512 或 1024,512"
                hint="多分辨率用逗号分隔"
                onChange={(v) => update("datasetResolutions", v)}
              />
              <TextField
                label="帧数分桶 (frame_buckets)"
                value={config.frameBuckets}
                placeholder="1,33"
                hint="1=图片，视频需加帧数"
                onChange={(v) => update("frameBuckets", v)}
              />
              <NumberField
                label="数据集重复次数"
                value={config.numRepeats}
                min={1}
                onChange={(v) => update("numRepeats", v)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "0.5rem" }}>
              <ToggleSwitch
                label="宽高比分桶 (enable_ar_bucket)"
                active={config.enableArBucket}
                onToggle={() => update("enableArBucket", !config.enableArBucket)}
              />
              <NumberField
                label="AR 桶数量"
                value={config.numArBuckets}
                min={1}
                hint="min_ar=0.5 ~ max_ar=2.0 等比分布"
                onChange={(v) => update("numArBuckets", v)}
              />
            </div>
          </SectionCard>

          <SectionCard title="保存 / Eval" icon={<Save size={18} />} animationDelay="0.04s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label="每 N Epoch 保存"
                value={config.saveEveryNEpochs}
                min={0}
                hint="0=禁用"
                onChange={(v) => update("saveEveryNEpochs", v)}
              />
              <NumberField
                label="每 N 步保存"
                value={config.saveEveryNSteps}
                min={0}
                hint="0=禁用"
                onChange={(v) => update("saveEveryNSteps", v)}
              />
              <NumberField
                label="Eval 每 N Epoch"
                value={config.evalEveryNEpochs}
                min={1}
                onChange={(v) => update("evalEveryNEpochs", v)}
              />
              <NumberField
                label="Checkpoint 间隔（分钟）"
                value={config.checkpointEveryNMinutes}
                min={0}
                onChange={(v) => update("checkpointEveryNMinutes", v)}
              />
              <SelectField
                label="保存 dtype"
                value={config.saveDtype}
                onChange={(v) => update("saveDtype", v)}
                options={["bfloat16", "float16", "float32"]}
              />
            </div>
          </SectionCard>

          <SectionCard title="优化器详细" icon={<Sliders size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <TextField
                label="梯度裁剪 (gradient_clipping)"
                value={config.gradientClipping}
                placeholder="1.0"
                onChange={(v) => update("gradientClipping", v)}
              />
            </div>
          </SectionCard>
        </>
      ) : null}

      {/* ── Expert tab ────────────────────────────────────────────── */}
      {activeTab === "expert" ? (
        <>
          <SectionCard title="恢复训练" icon={<Settings2 size={18} />} animationDelay="0s">
            <div className="config-grid" style={{ gridTemplateColumns: "1fr" }}>
              <TextField
                label="从 Checkpoint 恢复 (resume_from_checkpoint)"
                value={config.resumeFromCheckpoint}
                placeholder="留空从头训练 / latest / 20250212_07-06-40"
                hint="填写 output_dir 内的 checkpoint 子目录名，或填 latest 使用最新"
                onChange={(v) => update("resumeFromCheckpoint", v)}
              />
            </div>
          </SectionCard>

          <SectionCard title="DeepSpeed" icon={<Zap size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField
                label="steps_per_print"
                value={config.stepsPerPrint}
                min={1}
                hint="每 N 步打印一次训练日志"
                onChange={(v) => update("stepsPerPrint", v)}
              />
            </div>
          </SectionCard>
        </>
      ) : null}

      {/* ── Save preset dialog ─────────────────────────────────── */}
      {savePresetOpen
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10000,
              }}
              onClick={(e) => { if (e.target === e.currentTarget) setSavePresetOpen(false); }}
            >
              <div
                style={{
                  background: "var(--bg-card, #18181b)",
                  border: "1px solid var(--border-dim)",
                  borderRadius: "8px",
                  padding: "1.5rem",
                  width: "340px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-primary)" }}>
                  保存为预设
                </div>
                <input
                  type="text"
                  className="form-input"
                  placeholder="预设名称"
                  value={savePresetName}
                  onChange={(e) => setSavePresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmSavePreset();
                    if (e.key === "Escape") setSavePresetOpen(false);
                  }}
                  autoFocus
                />
                {savePresetError ? (
                  <div style={{ fontSize: "0.72rem", color: "var(--error, #f87171)" }}>{savePresetError}</div>
                ) : null}
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={() => setSavePresetOpen(false)}>取消</button>
                  <button type="button" className="btn btn-primary" onClick={confirmSavePreset}>保存</button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
