/**
 * @file openAgentWindow.ts
 * @description 在前端通过 Tauri WebviewWindow 打开 MoyanAgent 子窗口（不经过 Rust 建窗）。
 */

import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** MoyanAgent 子窗口固定 label，重复点击时聚焦已有窗口。 */
const AGENT_WINDOW_LABEL = "moyan-agent";

/** 子窗口加载的路由（与 `App.tsx` 中 `/agent` 一致）。 */
const AGENT_ROUTE = "/agent";

/**
 * 打开或聚焦 MoyanAgent 子窗口。
 */
export async function openAgentWindow(): Promise<void> {
  if (!isTauri()) {
    window.open(AGENT_ROUTE, "_blank", "noopener,noreferrer");
    return;
  }

  const existing = await WebviewWindow.getByLabel(AGENT_WINDOW_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  const webview = new WebviewWindow(AGENT_WINDOW_LABEL, {
    url: AGENT_ROUTE,
    title: "MoyanAgent",
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    center: true,
    decorations: false,
    resizable: true,
  });

  webview.once("tauri://error", (event) => {
    console.error("[MoyanAgent] WebviewWindow create failed:", event);
  });
}
