import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Save, Upload } from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { DiffusionPipeConfig } from "../../lib/types";
import {
  previewDiffusionPipeConfig,
  readTextFile,
  writeTextFile,
} from "../../lib/desktopApi";
import {
  createDpPreset,
  loadDpPresetsFromStorage,
  resolveTrainingPresetSelection,
  saveDpPresetsToStorage,
  saveTrainingPresetSelection,
  type DiffusionPipePreset,
} from "../../lib/presets";
import { diffusionPipeSections } from "../../lib/trainerSchema/diffusionPipeSchema";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";
import TrainingConfigWorkbench from "./TrainingConfigWorkbench";

interface Props {
  projectId: string;
  config: DiffusionPipeConfig | null;
  onChange: (next: DiffusionPipeConfig) => void;
}

export default function DiffusionPipeConfigPanel({ projectId, config, onChange }: Props) {
  const [presets, setPresets] = useState<DiffusionPipePreset[]>(loadDpPresetsFromStorage);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedPresetId(
      resolveTrainingPresetSelection(projectId, "diffusion-pipe", presets.map((preset) => preset.id)),
    );
  }, [presets, projectId]);

  const groups = useMemo<PresetMenuGroup[]>(
    () => presets.length
      ? [{ label: "已保存预设", items: presets.map((preset) => ({ id: preset.id, label: preset.label })) }]
      : [],
    [presets],
  );
  const requestPreview = useCallback(
    (next: DiffusionPipeConfig) => previewDiffusionPipeConfig(projectId, next),
    [projectId],
  );

  if (!config) {
    return <div className="card" style={{ margin: "1rem", padding: "2rem", textAlign: "center" }}>配置加载中…</div>;
  }

  const applySelected = () => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (preset) onChange({ ...config, ...preset.config });
  };
  const savePreset = () => {
    if (!saveName.trim()) {
      setError("请输入预设名称");
      return;
    }
    const preset = createDpPreset(saveName, config);
    const next = [...presets, preset];
    setPresets(next);
    saveDpPresetsToStorage(next);
    setSelectedPresetId(preset.id);
    saveTrainingPresetSelection(projectId, "diffusion-pipe", preset.id);
    setSaveOpen(false);
    setSaveName("");
    setError("");
  };
  const deletePreset = () => {
    const next = presets.filter((preset) => preset.id !== selectedPresetId);
    setPresets(next);
    saveDpPresetsToStorage(next);
    setSelectedPresetId("");
    saveTrainingPresetSelection(projectId, "diffusion-pipe", "");
  };
  const importConfig = async () => {
    try {
      const path = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      const parsed = JSON.parse(await readTextFile(path as string)) as Partial<DiffusionPipeConfig>;
      onChange({ ...config, ...parsed });
      setError("");
    } catch (cause) {
      setError(`配置导入失败：${String(cause)}`);
    }
  };
  const exportConfig = async () => {
    const path = await saveDialog({
      defaultPath: "diffusion-pipe-training-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path) await writeTextFile(path as string, JSON.stringify(config, null, 2));
  };

  return (
    <>
      <TrainingConfigWorkbench
        title="diffusion-pipe 全量训练参数"
        config={config}
        sections={diffusionPipeSections}
        onChange={onChange}
        preview={requestPreview}
        toolbar={
          <>
            <PresetDropdownMenu
              value={selectedPresetId}
              onChange={(value) => {
                setSelectedPresetId(value);
                saveTrainingPresetSelection(projectId, "diffusion-pipe", value);
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
            {selectedPresetId ? <button type="button" className="btn" onClick={deletePreset}>删除</button> : null}
          </>
        }
      />
      {error ? <div className="training-workbench-preview-error">{error}</div> : null}
      {saveOpen ? createPortal(
        <div className="training-preset-backdrop" onClick={() => setSaveOpen(false)}>
          <div className="card training-preset-dialog" onClick={(event) => event.stopPropagation()}>
            <strong>保存 diffusion-pipe 预设</strong>
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
