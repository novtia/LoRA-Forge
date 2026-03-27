import { useState, type ReactNode } from "react";
import {
  Box,
  Cpu,
  FolderOpen,
  Gauge,
  Network,
  Settings2,
  Sliders,
  TerminalSquare,
  Wrench,
  Zap,
} from "lucide-react";
import type { TrainingConfig } from "../../lib/types";
import { useI18n } from "../../lib/i18n";

interface ConfigEditorProps {
  config: TrainingConfig;
  onChange: (next: TrainingConfig) => void;
}

type TabKey = "basic" | "advanced" | "expert";

export default function ConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>("basic");

  const updateConfig = <K extends keyof TrainingConfig>(key: K, value: TrainingConfig[K]) => {
    onChange({
      ...config,
      [key]: value,
    });
  };

  return (
    <div className="bento bento-detail view-config">
      <div
        className="card"
        style={{
          gridColumn: "span 12",
          padding: "0.55rem",
          background:
            "linear-gradient(90deg, rgba(212, 255, 0, 0.08), transparent 28%, transparent 72%, rgba(255, 85, 0, 0.08)), var(--bg-surface)",
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
            {t("projectDetail.hyperparameters")}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              color: "var(--accent-acid)",
              textTransform: "uppercase",
            }}
          >
            {activeTab === "basic"
              ? t("config.tabBasic")
              : activeTab === "advanced"
                ? t("config.tabAdvanced")
                : t("config.tabExpert")}
          </div>
        </div>
        <div className="design-segment-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "basic" ? "active" : ""}`}
            onClick={() => setActiveTab("basic")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Box size={14} /> {t("config.tabBasic")}
          </button>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "advanced" ? "active" : ""}`}
            onClick={() => setActiveTab("advanced")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Settings2 size={14} /> {t("config.tabAdvanced")}
          </button>
          <button
            type="button"
            className={`design-segment-btn ${activeTab === "expert" ? "active" : ""}`}
            onClick={() => setActiveTab("expert")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            <Wrench size={14} /> {t("config.tabExpert")}
          </button>
        </div>
      </div>

      {activeTab === "basic" ? (
        <>
          <SectionCard title={t("config.baseSettings")} icon={<Cpu size={18} />} animationDelay="0s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              <SelectField
                label={t("config.trainingScript")}
                value={config.trainingScript}
                onChange={(value) => updateConfig("trainingScript", value)}
                options={[
                  { label: "SD 1.x / 2.x", value: "train_network.py" },
                  { label: "SDXL", value: "sdxl_train_network.py" },
                ]}
              />
              <TextField
                label={t("config.pretrainedModel")}
                value={config.pretrainedModel}
                onChange={(value) => updateConfig("pretrainedModel", value)}
              />
              <TextField
                label={t("config.resolution")}
                value={config.resolution}
                onChange={(value) => updateConfig("resolution", value)}
                placeholder="1024x1024"
              />
              <TextField
                label={t("config.vaeOptional")}
                value={config.vae}
                placeholder={t("config.vaePlaceholder")}
                onChange={(value) => updateConfig("vae", value)}
              />
              <NumberField
                label={t("config.clipSkip")}
                value={config.clipSkip}
                onChange={(value) => updateConfig("clipSkip", value)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.coreTraining")} icon={<Zap size={18} />} animationDelay="0.04s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label={t("config.batchSize")}
                value={config.batchSize}
                onChange={(value) => updateConfig("batchSize", value)}
              />
              <NumberField
                label={t("config.epochs")}
                value={config.epochs}
                onChange={(value) => updateConfig("epochs", value)}
              />
              <NumberField
                label={t("config.stepsPerEpoch")}
                value={config.stepsPerEpoch}
                onChange={(value) => updateConfig("stepsPerEpoch", value)}
              />
              <NumberField
                label={t("config.saveEveryNEpochs")}
                value={config.saveEveryNEpochs}
                onChange={(value) => updateConfig("saveEveryNEpochs", value)}
              />
              <SelectField
                label={t("config.optimizer")}
                value={config.optimizer}
                onChange={(value) => updateConfig("optimizer", value)}
                options={["AdamW8bit", "Lion", "DAdaptation", "Prodigy"]}
              />
              <TextField
                label={t("config.baseLr")}
                value={config.baseLr}
                onChange={(value) => updateConfig("baseLr", value)}
              />
              <SelectField
                label={t("config.lrScheduler")}
                value={config.lrScheduler}
                onChange={(value) => updateConfig("lrScheduler", value)}
                options={["constant", "cosine", "cosine_with_restarts"]}
              />
              <NumberField
                label={t("config.lrWarmupSteps")}
                value={config.lrWarmupSteps}
                onChange={(value) => updateConfig("lrWarmupSteps", value)}
              />
              <SelectField
                label={t("config.mixedPrecision")}
                value={config.mixedPrecision}
                onChange={(value) => updateConfig("mixedPrecision", value)}
                options={["no", "fp16", "bf16"]}
              />
              <NumberField
                label={t("config.seed")}
                value={config.seed}
                onChange={(value) => updateConfig("seed", value)}
              />
              <SelectField
                label={t("config.savePrecision")}
                value={config.savePrecision}
                onChange={(value) => updateConfig("savePrecision", value)}
                options={[
                  { label: "default", value: "" },
                  { label: "float", value: "float" },
                  { label: "fp16", value: "fp16" },
                  { label: "bf16", value: "bf16" },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.loraCore")} icon={<Network size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label={t("config.networkDimRank")}
                value={config.networkDim}
                onChange={(value) => updateConfig("networkDim", value)}
              />
              <NumberField
                label={t("config.networkAlpha")}
                value={config.networkAlpha}
                onChange={(value) => updateConfig("networkAlpha", value)}
              />
              <TextField
                label={t("config.unetLr")}
                value={config.unetLr}
                onChange={(value) => updateConfig("unetLr", value)}
              />
              <TextField
                label={t("config.textEncoderLr")}
                value={config.textEncoderLr}
                onChange={(value) => updateConfig("textEncoderLr", value)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.performanceMemory")} icon={<Gauge size={18} />} animationDelay="0.12s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <ToggleSwitch
                label={t("config.gradientCheckpointing")}
                active={config.gradientCheckpointing}
                onToggle={() => updateConfig("gradientCheckpointing", !config.gradientCheckpointing)}
              />
              <ToggleSwitch
                label={t("config.xformers")}
                active={config.xformers}
                onToggle={() => updateConfig("xformers", !config.xformers)}
              />
              <ToggleSwitch
                label={t("config.cacheLatents")}
                active={config.cacheLatents}
                onToggle={() => updateConfig("cacheLatents", !config.cacheLatents)}
              />
              <ToggleSwitch
                label={t("config.cacheLatentsToDisk")}
                active={config.cacheLatentsToDisk}
                onToggle={() => updateConfig("cacheLatentsToDisk", !config.cacheLatentsToDisk)}
              />
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeTab === "advanced" ? (
        <>
          <SectionCard title={t("config.trainingTechniques")} icon={<Sliders size={18} />} animationDelay="0s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <TextField
                label={t("config.minSnrGamma")}
                value={config.minSnrGamma}
                onChange={(value) => updateConfig("minSnrGamma", value)}
              />
              <TextField
                label={t("config.noiseOffset")}
                value={config.noiseOffset}
                onChange={(value) => updateConfig("noiseOffset", value)}
              />
              <TextField
                label={t("config.maxGradNorm")}
                value={config.maxGradNorm}
                onChange={(value) => updateConfig("maxGradNorm", value)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.datasetLayout")} icon={<Box size={18} />} animationDelay="0.04s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label={t("config.datasetRepeats")}
                value={config.datasetRepeats}
                onChange={(value) => updateConfig("datasetRepeats", value)}
              />
              <NumberField
                label={t("config.minBucketReso")}
                value={config.minBucketReso}
                onChange={(value) => updateConfig("minBucketReso", value)}
              />
              <NumberField
                label={t("config.maxBucketReso")}
                value={config.maxBucketReso}
                onChange={(value) => updateConfig("maxBucketReso", value)}
              />
              <NumberField
                label={t("config.bucketResoSteps")}
                value={config.bucketResoSteps}
                onChange={(value) => updateConfig("bucketResoSteps", value)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "0.35rem" }}>
              <ToggleSwitch
                label={t("config.enableBucket")}
                active={config.enableBucket}
                onToggle={() => updateConfig("enableBucket", !config.enableBucket)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.captionStrategy")} icon={<Sliders size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField
                label={t("config.keepTokens")}
                value={config.keepTokens}
                onChange={(value) => updateConfig("keepTokens", value)}
              />
              <TextField
                label={t("config.captionDropoutRate")}
                value={config.captionDropoutRate}
                onChange={(value) => updateConfig("captionDropoutRate", value)}
              />
              <TextField
                label={t("config.captionTagDropoutRate")}
                value={config.captionTagDropoutRate}
                onChange={(value) => updateConfig("captionTagDropoutRate", value)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "0.35rem" }}>
              <ToggleSwitch
                label={t("config.shuffleCaptions")}
                active={config.shuffleCaptions}
                onToggle={() => updateConfig("shuffleCaptions", !config.shuffleCaptions)}
              />
              <ToggleSwitch
                label={t("config.colorJitter")}
                active={config.colorJitter}
                onToggle={() => updateConfig("colorJitter", !config.colorJitter)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.networkExpansion")} icon={<Network size={18} />} animationDelay="0.12s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField
                label={t("config.convDim")}
                value={config.convDim}
                onChange={(value) => updateConfig("convDim", value)}
              />
              <NumberField
                label={t("config.convAlpha")}
                value={config.convAlpha}
                onChange={(value) => updateConfig("convAlpha", value)}
              />
              <TextField
                label={t("config.networkDropout")}
                value={config.networkDropout}
                onChange={(value) => updateConfig("networkDropout", value)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.optimizerAndLr")} icon={<Zap size={18} />} animationDelay="0.16s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <TextField
                label={t("config.optimizerArgs")}
                value={config.optimizerArgs}
                onChange={(value) => updateConfig("optimizerArgs", value)}
              />
              <TextField
                label={t("config.lrSchedulerNumCycles")}
                value={config.lrSchedulerNumCycles}
                onChange={(value) => updateConfig("lrSchedulerNumCycles", value)}
              />
              <TextField
                label={t("config.lrSchedulerPower")}
                value={config.lrSchedulerPower}
                onChange={(value) => updateConfig("lrSchedulerPower", value)}
              />
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeTab === "expert" ? (
        <>
          <SectionCard title={t("config.systemWorkers")} icon={<Cpu size={18} />} animationDelay="0s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <NumberField
                label={t("config.maxDataLoaderWorkers")}
                value={config.maxDataLoaderWorkers}
                onChange={(value) => updateConfig("maxDataLoaderWorkers", value)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "0.35rem" }}>
              <ToggleSwitch
                label={t("config.persistentDataLoaderWorkers")}
                active={config.persistentDataLoaderWorkers}
                onToggle={() =>
                  updateConfig("persistentDataLoaderWorkers", !config.persistentDataLoaderWorkers)
                }
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.checkpointResume")} icon={<FolderOpen size={18} />} animationDelay="0.04s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              <NumberField
                label={t("config.saveEveryNSteps")}
                value={config.saveEveryNSteps}
                onChange={(value) => updateConfig("saveEveryNSteps", value)}
              />
              <NumberField
                label={t("config.saveLastNEpochs")}
                value={config.saveLastNEpochs}
                onChange={(value) => updateConfig("saveLastNEpochs", value)}
              />
              <NumberField
                label={t("config.saveLastNSteps")}
                value={config.saveLastNSteps}
                onChange={(value) => updateConfig("saveLastNSteps", value)}
              />
              <NumberField
                label={t("config.initialEpoch")}
                value={config.initialEpoch}
                onChange={(value) => updateConfig("initialEpoch", value)}
              />
              <NumberField
                label={t("config.initialStep")}
                value={config.initialStep}
                onChange={(value) => updateConfig("initialStep", value)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: "0.35rem" }}>
              <TextField
                label={t("config.networkWeights")}
                value={config.networkWeights}
                onChange={(value) => updateConfig("networkWeights", value)}
              />
              <TextField
                label={t("config.resume")}
                value={config.resume}
                onChange={(value) => updateConfig("resume", value)}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("config.trainerRuntime")} icon={<FolderOpen size={18} />} animationDelay="0.08s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <TextField
                label={t("config.sdScriptsPath")}
                value={config.sdScriptsPath}
                placeholder={t("config.sdScriptsPathPlaceholder")}
                onChange={(value) => updateConfig("sdScriptsPath", value)}
              />
              <TextField
                label={t("config.pythonExecutable")}
                value={config.pythonExecutable}
                placeholder={t("config.pythonExecutablePlaceholder")}
                onChange={(value) => updateConfig("pythonExecutable", value)}
              />
            </div>
            <div
              style={{
                marginTop: "0.85rem",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <TerminalSquare size={14} />
              {t("config.runtimeHint")}
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  animationDelay,
  children,
}: {
  title: string;
  icon: ReactNode;
  animationDelay: string;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ gridColumn: "span 12", animationDelay }}>
      <div className="card-header">
        <span className="card-title-icon">
          {icon} {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type="text"
        className="form-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type="number"
        className="form-input"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { label: string; value: string }>;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select className="form-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const normalized = typeof option === "string" ? { label: option, value: option } : option;
          return (
            <option key={normalized.value || normalized.label} value={normalized.value}>
              {normalized.label}
            </option>
          );
        })}
      </select>
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
