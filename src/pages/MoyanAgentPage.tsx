/**
 * @file MoyanAgentPage.tsx
 * @description 路由 `/agent` 全屏渲染 MoyanAgent 前端（用于 Webview 子窗口）。
 */

import MoyanAgentApp from "../moyan-agent/agent-entry";

export default function MoyanAgentPage() {
  return <MoyanAgentApp />;
}
