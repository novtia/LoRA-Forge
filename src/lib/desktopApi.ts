import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ActiveJobSummary,
  ApiLogEntry,
  BaiduTranslateSettings,
  DatasetAsset,
  DatasetPreviewAsset,
  DatasetEntry,
  DiffusionPipeConfig,
  LlmGlobalSettings,
  LlmProvider,
  LlmProviderModelEntry,
  LlmProviderSummary,
  LlmSettings,
  ProjectRecord,
  SampleImageEntry,
  SystemStats,
  TrainingConfig,
  TrainingEnvSettings,
  TrainingLogEvent,
  TrainingProgressEvent,
  TrainingStateChangedEvent,
} from "./types";
import type { CaptionTagMode } from "./types";

export function listProjects(): Promise<ProjectRecord[]> {
  return invoke("list_projects");
}

export function getProject(projectId: string): Promise<ProjectRecord> {
  return invoke("get_project", { projectId });
}

export function createProject(name: string, rootPath: string): Promise<ProjectRecord> {
  return invoke("create_project", {
    input: {
      name,
      rootPath,
    },
  });
}

export function loadTrainingConfig(projectId: string): Promise<TrainingConfig> {
  return invoke("load_training_config", { projectId });
}

export function saveTrainingConfig(
  projectId: string,
  config: TrainingConfig,
): Promise<TrainingConfig> {
  return invoke("save_training_config", {
    input: {
      projectId,
      config,
    },
  });
}

export function loadTrainingEnv(): Promise<TrainingEnvSettings> {
  return invoke("load_training_env");
}

export function saveTrainingEnv(settings: TrainingEnvSettings): Promise<TrainingEnvSettings> {
  return invoke("save_training_env", {
    input: {
      settings,
    },
  });
}

export function loadLlmSettings(): Promise<LlmSettings> {
  return invoke("load_llm_settings");
}

export function saveLlmSettings(settings: LlmSettings): Promise<LlmSettings> {
  return invoke("save_llm_settings", {
    input: {
      settings,
    },
  });
}

export function listLlmProviders(): Promise<LlmProviderSummary[]> {
  return invoke("list_llm_providers");
}

export function getLlmProvider(providerId: string): Promise<LlmProvider> {
  return invoke("get_llm_provider", { providerId });
}

export function createLlmProvider(input: {
  name: string;
  endpointUrl: string;
  apiKey: string;
  endpointKind: LlmProvider["endpointKind"];
  initialModelId?: string;
}): Promise<LlmProvider> {
  return invoke("create_llm_provider", { input });
}

export function updateLlmProvider(input: {
  providerId: string;
  name: string;
  endpointUrl: string;
  apiKey: string;
  endpointKind: LlmProvider["endpointKind"];
}): Promise<LlmProvider> {
  return invoke("update_llm_provider", { input });
}

export function deleteLlmProvider(providerId: string): Promise<void> {
  return invoke("delete_llm_provider", { input: { providerId } });
}

export function addLlmProviderModel(input: {
  providerId: string;
  modelId: string;
  label?: string;
  source?: "manual" | "fetched";
}): Promise<LlmProvider> {
  return invoke("add_llm_provider_model", { input });
}

export function deleteLlmProviderModel(input: {
  providerId: string;
  entryId: string;
}): Promise<LlmProvider> {
  return invoke("delete_llm_provider_model", { input });
}

export function fetchLlmProviderModels(input: {
  providerId: string;
  endpointUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  return invoke("fetch_llm_provider_models", { input });
}

export function setActiveLlmSelection(input: {
  providerId: string;
  modelId: string;
}): Promise<LlmGlobalSettings> {
  return invoke("set_active_llm_selection", { input });
}

export function loadBaiduTranslateSettings(): Promise<BaiduTranslateSettings> {
  return invoke("load_baidu_translate_settings");
}

export function saveBaiduTranslateSettings(
  settings: BaiduTranslateSettings,
): Promise<BaiduTranslateSettings> {
  return invoke("save_baidu_translate_settings", {
    input: { settings },
  });
}

/** Baidu language codes, e.g. `auto`, `en`, `zh`. */
export function baiduTranslate(
  text: string,
  from: string = "auto",
  to: string = "zh",
): Promise<string> {
  return invoke("baidu_translate", { text, from, to });
}

export function getRecentApiLogs(limit = 200): Promise<ApiLogEntry[]> {
  return invoke("get_recent_api_logs", { limit });
}

export function clearApiLogs(): Promise<void> {
  return invoke("clear_api_logs");
}

export function listDatasetEntries(projectId: string): Promise<DatasetEntry[]> {
  return invoke("list_dataset_entries", { projectId });
}

export function listSampleImages(projectId: string): Promise<SampleImageEntry[]> {
  return invoke("list_sample_images", { projectId });
}

export function getDatasetAsset(
  projectId: string,
  relativePath?: string,
): Promise<DatasetAsset | null> {
  return invoke("get_dataset_asset", { projectId, relativePath });
}

export function getDatasetPreviewAssets(
  projectId: string,
  relativePaths: string[],
): Promise<DatasetPreviewAsset[]> {
  return invoke("get_dataset_preview_assets", { projectId, relativePaths });
}

export function readCaption(projectId: string, relativePath: string): Promise<string> {
  return invoke("read_caption", { projectId, relativePath });
}

export function writeCaption(
  projectId: string,
  relativePath: string,
  caption: string,
): Promise<string> {
  return invoke("write_caption", {
    input: {
      projectId,
      relativePath,
      caption,
    },
  });
}

export function deleteDatasetImage(
  projectId: string,
  relativePath: string,
): Promise<DatasetEntry[]> {
  return invoke("delete_dataset_image", { projectId, relativePath });
}

export function groupDatasetImages(
  projectId: string,
  relativePaths: string[],
  groupName: string,
  parentRelativePath?: string | null,
): Promise<DatasetEntry[]> {
  return invoke("group_dataset_images", {
    input: {
      projectId,
      relativePaths,
      groupName,
      parentRelativePath: parentRelativePath ?? null,
    },
  });
}

export function moveDatasetImages(
  projectId: string,
  relativePaths: string[],
  targetRelativePath: string,
): Promise<DatasetEntry[]> {
  return invoke("move_dataset_images", {
    input: { projectId, relativePaths, targetRelativePath },
  });
}

export function renameDatasetGroup(
  projectId: string,
  groupRelativePath: string,
  newName: string,
): Promise<DatasetEntry[]> {
  return invoke("rename_dataset_group", {
    input: { projectId, groupRelativePath, newName },
  });
}

export function removeDatasetGroup(
  projectId: string,
  groupRelativePath: string,
  deleteContents: boolean,
): Promise<DatasetEntry[]> {
  return invoke("remove_dataset_group", {
    input: { projectId, groupRelativePath, deleteContents },
  });
}

export function setDatasetGroupType(
  projectId: string,
  groupRelativePath: string,
  groupType: "normal" | "reg",
): Promise<DatasetEntry[]> {
  return invoke("set_dataset_group_type", {
    input: { projectId, groupRelativePath, groupType },
  });
}

/** Returns the subset of `relativePaths` whose caption (.txt) is absent or empty. */
export function listUntaggedImagePaths(
  projectId: string,
  relativePaths: string[],
): Promise<string[]> {
  return invoke("list_untagged_image_paths", {
    input: { projectId, relativePaths },
  });
}

export function autoTagImage(
  projectId: string,
  relativePath: string,
  userMessage?: string | null,
  previousAssistantCaption?: string | null,
  previousImageRelativePath?: string | null,
  tagMode?: CaptionTagMode | null,
  currentCaption?: string | null,
): Promise<string> {
  const trimmed = userMessage?.trim();
  const prev = previousAssistantCaption?.trim();
  const prevImg = previousImageRelativePath?.trim();
  const caption = currentCaption?.trim();
  return invoke("auto_tag_image", {
    projectId,
    relativePath,
    userMessage: trimmed && trimmed.length > 0 ? trimmed : null,
    previousAssistantCaption:
      prev && prev.length > 0 ? prev : null,
    previousImageRelativePath:
      prevImg && prevImg.length > 0 ? prevImg : null,
    tagMode: tagMode ?? "direct",
    currentCaption: caption && caption.length > 0 ? caption : null,
  });
}

export function cancelLlmCaption(): Promise<void> {
  return invoke("cancel_llm_caption");
}

export function loadDiffusionPipeConfig(projectId: string): Promise<DiffusionPipeConfig> {
  return invoke("load_diffusion_pipe_config", { projectId });
}

export function saveDiffusionPipeConfig(
  projectId: string,
  config: DiffusionPipeConfig,
): Promise<DiffusionPipeConfig> {
  return invoke("save_diffusion_pipe_config", {
    input: { projectId, config },
  });
}

export function startDiffusionPipeTraining(projectId: string): Promise<ActiveJobSummary> {
  return invoke("start_diffusion_pipe_training", { projectId });
}

export function startTraining(projectId: string): Promise<ActiveJobSummary> {
  return invoke("start_training", { projectId });
}

export function startTrainingFromLatestWeights(projectId: string): Promise<ActiveJobSummary> {
  return invoke("start_training_from_latest_weights", { projectId });
}

export function getLatestOutputCheckpoint(projectId: string): Promise<string | null> {
  return invoke("get_latest_output_checkpoint", { projectId });
}

export function pauseTraining(projectId: string): Promise<ActiveJobSummary> {
  return invoke("pause_training", { projectId });
}

export function resumeTraining(projectId: string): Promise<ActiveJobSummary> {
  return invoke("resume_training", { projectId });
}

export function abortTraining(projectId: string): Promise<ActiveJobSummary> {
  return invoke("abort_training", { projectId });
}

export function exportCheckpoint(
  projectId: string,
  destinationPath?: string,
): Promise<string> {
  return invoke("export_checkpoint", {
    input: {
      projectId,
      destinationPath,
    },
  });
}

export function getSystemStats(): Promise<SystemStats> {
  return invoke("get_system_stats");
}

export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke("write_text_file", { path, content });
}

export function getActiveJob(projectId?: string): Promise<ActiveJobSummary | null> {
  return invoke("get_active_job", { projectId });
}

function normalizeAssetPath(filePath: string): string {
  if (filePath.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${filePath.slice("\\\\?\\UNC\\".length)}`;
  }
  if (filePath.startsWith("\\\\?\\")) {
    return filePath.slice("\\\\?\\".length);
  }
  return filePath;
}

export function toFileAssetUrl(filePath: string): string {
  return convertFileSrc(normalizeAssetPath(filePath));
}

export function onTrainingProgress(
  handler: (event: TrainingProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<TrainingProgressEvent>("training-progress", (event) => handler(event.payload));
}

export function onTrainingLog(
  handler: (event: TrainingLogEvent) => void,
): Promise<UnlistenFn> {
  return listen<TrainingLogEvent>("training-log-line", (event) => handler(event.payload));
}

export function onTrainingState(
  handler: (event: TrainingStateChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TrainingStateChangedEvent>("training-state-changed", (event) =>
    handler(event.payload),
  );
}

export function onSystemStats(
  handler: (stats: SystemStats) => void,
): Promise<UnlistenFn> {
  return listen<SystemStats>("system-stats-updated", (event) => handler(event.payload));
}
