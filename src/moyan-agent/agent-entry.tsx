/**
 * @file agent-entry.tsx
 * @description MoyanAgent 子窗口入口：挂载独立样式与 i18n，再渲染 Agent App。
 */

import MoyanAgentApp from "./App";
import "./i18n";
import "./styles/globals.css";

export default MoyanAgentApp;
