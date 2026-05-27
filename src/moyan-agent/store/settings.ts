import { create } from "zustand";
import type { Settings, SettingsPatch } from "../types";
import { setActiveLlmSelection } from "../../lib/desktopApi";
import { api } from "../api/tauri";

interface SettingsStore {
  settings: Settings | null;
  loading: boolean;
  load: () => Promise<void>;
  update: (patch: SettingsPatch) => Promise<void>;
}

/**
 * Agent 设置：供应商数据来自 lora 全局库，本地仅存 Agent 偏好项。
 */
export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const settings = await api.getSettings();
      set({ settings, loading: false });
    } catch (error) {
      console.error(error);
      set({ loading: false });
    }
  },
  update: async (patch) => {
    const current = get().settings;
    const providerId = patch.active_provider_id ?? current?.active_provider_id ?? "";
    const modelId = patch.model ?? current?.model ?? "";

    if (
      (patch.active_provider_id !== undefined || patch.model !== undefined) &&
      providerId.trim() &&
      modelId.trim()
    ) {
      await setActiveLlmSelection({ providerId, modelId });
    }

    const {
      active_provider_id: _providerId,
      model: _model,
      model_services: _services,
      api_key: _apiKey,
      endpoint: _endpoint,
      ...localPatch
    } = patch;

    const hasLocalPatch = Object.values(localPatch).some((value) => value !== undefined);
    if (hasLocalPatch) {
      await api.updateSettings(localPatch);
    }

    await get().load();
  },
}));
