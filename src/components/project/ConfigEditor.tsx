import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Save, Upload } from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { TrainingConfig } from "../../lib/types";
import {
  previewSdScriptsConfig,
  readTextFile,
  writeTextFile,
} from "../../lib/desktopApi";
import {
  DEFAULT_PRESETS,
  PRESET_GROUPS,
  applyPreset,
  createUserTrainingPreset,
  loadCustomPresetsFromStorage,
  resolveTrainingPresetSelection,
  saveCustomPresetsToStorage,
  saveTrainingPresetSelection,
  type TrainingPreset,
} from "../../lib/presets";
import { sdScriptsSections } from "../../lib/trainerSchema/sdScriptsSchema";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";
import TrainingConfigWorkbench from "./TrainingConfigWorkbench";

interface ConfigEditorProps {
  projectId: string;
  config: TrainingConfig;
  onChange: (next: TrainingConfig) => void;
}

export default function ConfigEditor({ projectId, config, onChange }: ConfigEditorProps) {
  const [customPresets, setCustomPresets] = useState<TrainingPreset[]>(loadCustomPresetsFromStorage);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const allPresets = useMemo(() => [...DEFAULT_PRESETS, ...customPresets], [customPresets]);

  useEffect(() => {
    setSelectedPresetId(
      resolveTrainingPresetSelection(projectId, "sd-scripts", allPresets.map((preset) => preset.id)),
    );
  }, [allPresets, projectId]);

  const groups = useMemo<PresetMenuGroup[]>(() => {
    const result = PRESET_GROUPS.map((group) => ({
      label: group.labelZh,
      items: DEFAULT_PRESETS
        .filter((preset) => preset.script === group.scriptMatch)
        .map((preset) => ({ id: preset.id, label: preset.labelZh })),
    }));
    if (customPresets.length) {
      result.push({
        label: "自定义",
        items: customPresets.map((preset) => ({ id: preset.id, label: preset.labelZh })),
      });
    }
    return result;
  }, [customPresets]);

  const requestPreview = useCallback(
    (next: TrainingConfig) => previewSdScriptsConfig(projectId, next),
    [projectId],
  );

  const applySelected = () => {
    const preset = allPresets.find((item) => item.id === selectedPresetId);
    if (preset) onChange(applyPreset(config, preset));
  };

  const savePreset = () => {
    if (!saveName.trim()) {
      setError("请输入预设名称");
      return;
    }
    const preset = createUserTrainingPreset(saveName, config);
    const next = [...customPresets, preset];
    setCustomPresets(next);
    saveCustomPresetsToStorage(next);
    setSelectedPresetId(preset.id);
    saveTrainingPresetSelection(projectId, "sd-scripts", preset.id);
    setSaveOpen(false);
    setSaveName("");
    setError("");
  };

  const importConfig = async () => {
    try {
      const path = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      const parsed = JSON.parse(await readTextFile(path as string)) as Partial<TrainingConfig>;
      onChange({ ...config, ...parsed });
      setError("");
    } catch (cause) {
      setError(`配置导入失败：${String(cause)}`);
    }
  };

  const exportConfig = async () => {
    const path = await saveDialog({
      defaultPath: "sd-scripts-training-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path) await writeTextFile(path as string, JSON.stringify(config, null, 2));
  };

  return (
    <>
      <TrainingConfigWorkbench
        title="sd-scripts / kohya 全量训练参数"
        config={config}
        sections={sdScriptsSections}
        onChange={onChange}
        preview={requestPreview}
        toolbar={
          <>
            <PresetDropdownMenu
              value={selectedPresetId}
              onChange={(value) => {
                setSelectedPresetId(value);
                saveTrainingPresetSelection(projectId, "sd-scripts", value);
              }}
              placeholder="— 选择预设 —"
              groups={groups}
              allowEmptyValue
            />
            <button type="button" className="btn" disabled={!selectedPresetId} onClick={applySelected}>应用</button>
            <button type="button" className="btn btn-primary" onClick={() => setSaveOpen(true)}>
              <Save size={12} /> 保存预设
            </button>
            <button type="button" className="btn" onClick={() => void importConfig()}>
              <Upload size={12} /> 导入
            </button>
            <button type="button" className="btn" onClick={() => void exportConfig()}>
              <Download size={12} /> 导出
            </button>
          </>
        }
      />
      {error ? <div className="training-workbench-preview-error">{error}</div> : null}
      {saveOpen ? createPortal(
        <div className="training-preset-backdrop" onClick={() => setSaveOpen(false)}>
          <div className="card training-preset-dialog" onClick={(event) => event.stopPropagation()}>
            <strong>保存训练参数预设</strong>
            <input
              className="form-input"
              autoFocus
              value={saveName}
              placeholder="预设名称"
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") savePreset(); }}
            />
            {error ? <div className="training-workbench-preview-error">{error}</div> : null}
            <div>
              <button type="button" className="btn" onClick={() => setSaveOpen(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={savePreset}>保存</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
