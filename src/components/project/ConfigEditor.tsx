import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Cpu,
  Download,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Network,
  Save,
  Settings2,
  Sliders,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { TrainingConfig } from "../../lib/types";
import { useI18n } from "../../lib/i18n";
import {
  DEFAULT_PRESETS,
  PRESET_GROUPS,
  applyPreset,
  createUserTrainingPreset,
  loadCustomPresetsFromStorage,
  saveCustomPresetsToStorage,
  type TrainingPreset,
} from "../../lib/presets";
import { readTextFile, writeTextFile } from "../../lib/desktopApi";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";

interface ConfigEditorProps {
  config: TrainingConfig;
  onChange: (next: TrainingConfig) => void;
}

type TabKey = "basic" | "advanced" | "expert";

export default function ConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t, language } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<TrainingPreset[]>(() => loadCustomPresetsFromStorage());
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetError, setSavePresetError] = useState<string | null>(null);
  const isAnimaTraining = config.trainingScript === "anima_train_network.py";

  const allPresets = useMemo(
    () => [...DEFAULT_PRESETS, ...customPresets],
    [customPresets],
  );

  const trainingPresetMenuGroups = useMemo((): PresetMenuGroup[] => {
    const groups: PresetMenuGroup[] = PRESET_GROUPS.map((group) => ({
      label: language === "zh-CN" ? group.labelZh : group.label,
      items: DEFAULT_PRESETS.filter((p) => p.script === group.scriptMatch).map((p) => ({
        id: p.id,
        label: language === "zh-CN" ? p.labelZh : p.label,
      })),
    }));
    if (customPresets.length > 0) {
      groups.push({
        label: t("config.presetGroupCustom"),
        items: customPresets.map((p) => ({
          id: p.id,
          label: language === "zh-CN" ? p.labelZh : p.label,
        })),
      });
    }
    return groups;
  }, [customPresets, language, t]);

  const updateConfig = <K extends keyof TrainingConfig>(key: K, value: TrainingConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const handleApplyPreset = () => {
    if (!selectedPresetId) return;
    const preset = allPresets.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    onChange(applyPreset(config, preset));
    setPresetError(null);
  };

  const confirmSaveNewPreset = () => {
    const name = savePresetName.trim();
    if (!name) {
      setSavePresetError(t("config.presetNameRequired"));
      return;
    }
    setSavePresetError(null);
    const nextPreset = createUserTrainingPreset(name, config);
    const nextList = [...customPresets, nextPreset];
    setCustomPresets(nextList);
    saveCustomPresetsToStorage(nextList);
    setSelectedPresetId(nextPreset.id);
    setSavePresetOpen(false);
    setSavePresetName("");
    setPresetError(null);
  };

  const openSavePresetDialog = () => {
    setSavePresetName("");
    setSavePresetError(null);
    setSavePresetOpen(true);
  };

  const handleExportPreset = async () => {
    try {
      const savePath = await saveDialog({
        title: t("config.presetExport"),
        defaultPath: t("config.presetExportFilename"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!savePath) return;
      await writeTextFile(savePath as string, JSON.stringify(config, null, 2));
    } catch {
      // user cancelled or write failed — silent
    }
  };

  const handleImportPreset = async () => {
    try {
      const filePath = await openDialog({
        title: t("config.presetImport"),
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const text = await readTextFile(filePath as string);
      const parsed = JSON.parse(text) as Partial<TrainingConfig>;
      onChange({ ...config, ...parsed });
      setPresetError(null);
    } catch {
      setPresetError(t("config.presetImportError"));
    }
  };

  const selectedPreset: TrainingPreset | undefined = allPresets.find(
    (p) => p.id === selectedPresetId,
  );

  useEffect(() => {
    if (!savePresetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSavePresetOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [savePresetOpen]);

  return (
    <>
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
            {t("config.preset")}
          </span>

          <PresetDropdownMenu
            value={selectedPresetId}
            onChange={(v) => {
              setSelectedPresetId(v);
              setPresetError(null);
            }}
            placeholder={t("config.presetPlaceholder")}
            groups={trainingPresetMenuGroups}
            allowEmptyValue
          />

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.75rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}
            disabled={!selectedPresetId}
            onClick={handleApplyPreset}
            title={
              selectedPreset
                ? language === "zh-CN"
                  ? selectedPreset.descriptionZh
                  : selectedPreset.description
                : undefined
            }
          >
            {t("config.presetApply")}
          </button>

          <button
            type="button"
            className="btn btn-primary"
            style={{
              height: "1.85rem",
              padding: "0 0.6rem",
              fontSize: "0.78rem",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
            onClick={openSavePresetDialog}
            title={t("config.presetSaveNew")}
          >
            <Save size={12} /> {t("config.presetSaveNew")}
          </button>

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            onClick={() => void handleImportPreset()}
            title={t("config.presetImport")}
          >
            <Upload size={12} /> {t("config.presetImport")}
          </button>

          <button
            type="button"
            className="btn"
            style={{ height: "1.85rem", padding: "0 0.6rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            onClick={() => void handleExportPreset()}
            title={t("config.presetExport")}
          >
            <Download size={12} /> {t("config.presetExport")}
          </button>
        </div>

        {/* preset description hint */}
        {selectedPreset ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              color: "var(--text-muted)",
              marginBottom: "0.4rem",
              padding: "0 0.1rem",
              lineHeight: 1.4,
            }}
          >
            {language === "zh-CN" ? selectedPreset.descriptionZh : selectedPreset.description}
          </div>
        ) : null}
        {presetError ? (
          <div
            style={{
              fontSize: "0.62rem",
              color: "var(--accent-danger, #f55)",
              marginBottom: "0.4rem",
              padding: "0 0.1rem",
            }}
          >
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
                  { label: t("config.trainNetworkScript"), value: "train_network.py" },
                  { label: t("config.sdxlTrainNetworkScript"), value: "sdxl_train_network.py" },
                  { label: t("config.animaTrainNetworkScript"), value: "anima_train_network.py" },
                ]}
              />
              <FilePickerField
                label={t("config.pretrainedModel")}
                value={config.pretrainedModel}
                onChange={(value) => updateConfig("pretrainedModel", value)}
                placeholder={isAnimaTraining ? t("config.animaPretrainedPlaceholder") : "runwayml/stable-diffusion-v1-5"}
                filters={[{ name: "Model", extensions: ["safetensors", "ckpt", "pt"] }]}
              />
              <TextField
                label={t("config.resolution")}
                value={config.resolution}
                onChange={(value) => updateConfig("resolution", value)}
                placeholder="1024x1024"
              />
              <FilePickerField
                label={t("config.vaeOptional")}
                value={config.vae}
                placeholder={isAnimaTraining ? t("config.animaVaePlaceholder") : t("config.vaePlaceholder")}
                onChange={(value) => updateConfig("vae", value)}
                filters={[{ name: "VAE", extensions: ["safetensors", "pt", "pth"] }]}
              />
              {!isAnimaTraining ? (
                <NumberField
                  label={t("config.clipSkip")}
                  value={config.clipSkip}
                  onChange={(value) => updateConfig("clipSkip", value)}
                />
              ) : (
                <FilePickerField
                  label={t("config.animaQwen3")}
                  value={config.animaQwen3}
                  placeholder={t("config.animaQwen3Placeholder")}
                  onChange={(value) => updateConfig("animaQwen3", value)}
                  filters={[{ name: "Qwen3", extensions: ["safetensors"] }]}
                  allowDirectory
                />
              )}
            </div>
            {isAnimaTraining ? (
              <div className="config-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginTop: "0.5rem" }}>
                <TextField
                  label={t("config.animaLlmAdapterLr")}
                  value={config.animaLlmAdapterLr}
                  placeholder="0"
                  onChange={(value) => updateConfig("animaLlmAdapterLr", value)}
                />
              </div>
            ) : null}
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

          <SectionCard title={t("config.sampleImages")} icon={<ImageIcon size={18} />} animationDelay="0.02s">
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <TextAreaField
                label={t("config.samplePrompts")}
                value={config.samplePrompts}
                placeholder={t("config.samplePromptsPlaceholder")}
                rows={4}
                onChange={(value) => updateConfig("samplePrompts", value)}
              />
              <TextAreaField
                label={t("config.sampleNegativePrompt")}
                value={config.sampleNegativePrompt}
                placeholder={t("config.sampleNegativePromptPlaceholder")}
                rows={4}
                onChange={(value) => updateConfig("sampleNegativePrompt", value)}
              />
            </div>
            <div
              style={{
                marginTop: "0.45rem",
                fontFamily: "var(--font-mono)",
                fontSize: "0.72rem",
                color: "var(--text-muted)",
              }}
            >
              {t("config.samplePromptsHint")}
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <NumberField
                label={t("config.sampleEveryNSteps")}
                value={config.sampleEveryNSteps}
                onChange={(value) => updateConfig("sampleEveryNSteps", value)}
              />
              <NumberField
                label={t("config.sampleEveryNEpochs")}
                value={config.sampleEveryNEpochs}
                onChange={(value) => updateConfig("sampleEveryNEpochs", value)}
              />
              <SelectField
                label={t("config.sampleSampler")}
                value={config.sampleSampler}
                onChange={(value) => updateConfig("sampleSampler", value)}
                options={[
                  "ddim",
                  "pndm",
                  "lms",
                  "euler",
                  "euler_a",
                  "heun",
                  "dpm_2",
                  "dpm_2_a",
                  "dpmsolver",
                  "dpmsolver++",
                  "dpmsingle",
                  "k_lms",
                  "k_euler",
                  "k_euler_a",
                  "k_dpm_2",
                  "k_dpm_2_a",
                ]}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: "0.35rem" }}>
              <NumberField
                label={t("config.sampleWidth")}
                value={config.sampleWidth}
                onChange={(value) => updateConfig("sampleWidth", value)}
              />
              <NumberField
                label={t("config.sampleHeight")}
                value={config.sampleHeight}
                onChange={(value) => updateConfig("sampleHeight", value)}
              />
              <NumberField
                label={t("config.sampleSteps")}
                value={config.sampleSteps}
                onChange={(value) => updateConfig("sampleSteps", value)}
              />
              <NumberField
                label={t("config.sampleSeed")}
                value={config.sampleSeed}
                onChange={(value) => updateConfig("sampleSeed", value)}
              />
            </div>
            <div className="config-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: "0.35rem" }}>
              <TextField
                label={t("config.sampleCfgScale")}
                value={config.sampleCfgScale}
                onChange={(value) => updateConfig("sampleCfgScale", value)}
              />
              <ToggleSwitch
                label={t("config.sampleAtFirst")}
                active={config.sampleAtFirst}
                onToggle={() => updateConfig("sampleAtFirst", !config.sampleAtFirst)}
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

          <SectionCard title={t("config.checkpointResume")} icon={<FolderOpen size={18} />} animationDelay="0.18s">
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
              <FilePickerField
                label={t("config.networkWeights")}
                value={config.networkWeights}
                onChange={(value) => updateConfig("networkWeights", value)}
                filters={[{ name: "LoRA weights", extensions: ["safetensors", "pt"] }]}
              />
              <FilePickerField
                label={t("config.resume")}
                value={config.resume}
                onChange={(value) => updateConfig("resume", value)}
                allowDirectory
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

        </>
      ) : null}
    </div>
    {savePresetOpen
      ? createPortal(
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={() => setSavePresetOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="preset-save-title"
              className="card"
              style={{
                width: "100%",
                maxWidth: "420px",
                padding: "1.25rem",
                background: "var(--bg-card, #1a1a1a)",
                border: "1px solid var(--border-dim)",
                borderRadius: "8px",
                boxShadow: "0 20px 48px rgba(0,0,0,0.65)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                id="preset-save-title"
                style={{ fontWeight: 700, marginBottom: "0.85rem", fontSize: "0.95rem" }}
              >
                {t("config.presetSaveDialogTitle")}
              </div>
              <label className="form-label" style={{ display: "block", marginBottom: "0.35rem" }}>
                {t("config.presetNameLabel")}
              </label>
              <input
                className="form-input"
                style={{ width: "100%", marginBottom: savePresetError ? "0.35rem" : "1rem" }}
                placeholder={t("config.presetNamePlaceholder")}
                value={savePresetName}
                onChange={(e) => {
                  setSavePresetName(e.target.value);
                  setSavePresetError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmSaveNewPreset();
                  }
                }}
                autoFocus
              />
              {savePresetError ? (
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--accent-orange)",
                    marginBottom: "0.75rem",
                  }}
                >
                  {savePresetError}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setSavePresetOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void confirmSaveNewPreset()}>
                  {t("common.save")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

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

function FilePickerField({
  label,
  value,
  onChange,
  placeholder,
  filters,
  allowDirectory = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  allowDirectory?: boolean;
}) {
  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: allowDirectory && !filters,
        filters: filters,
        title: label,
      });
      if (selected) {
        onChange(selected as string);
      }
    } catch {
      // user cancelled or dialog error — keep existing value
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
          onChange={(event) => onChange(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          onClick={() => void handleBrowse()}
          title={label}
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

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <textarea
        className="form-input"
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        style={{ resize: "vertical", minHeight: `${rows * 1.8}rem` }}
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
