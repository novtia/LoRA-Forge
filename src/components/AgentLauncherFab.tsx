/**
 * @file AgentLauncherFab.tsx
 * @description 全局悬浮按钮，点击后在前端创建 MoyanAgent Webview 子窗口。
 */

import { Bot } from "lucide-react";
import { useCallback, useState } from "react";

import { openAgentWindow } from "../lib/openAgentWindow";

/**
 * 右下角悬浮启动器。
 */
export function AgentLauncherFab() {
  const [opening, setOpening] = useState(false);

  const handleClick = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openAgentWindow();
    } catch (error) {
      console.error("[AgentLauncherFab] failed to open MoyanAgent window:", error);
    } finally {
      setOpening(false);
    }
  }, [opening]);

  return (
    <button
      type="button"
      className="agent-launcher-fab"
      aria-label="打开 MoyanAgent"
      title="MoyanAgent"
      disabled={opening}
      onClick={() => {
        void handleClick();
      }}
    >
      <Bot size={22} strokeWidth={2.2} />
      <span className="agent-launcher-fab__label">Agent</span>
    </button>
  );
}
