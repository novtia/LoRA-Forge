import { Routes, Route } from "react-router-dom";
import { AmbientBackground } from "./components/AmbientBackground";
import { AgentLauncherFab } from "./components/AgentLauncherFab";
import { DesignSettingsProvider } from "./components/DesignSettingsProvider";
import { Titlebar } from "./components/Titlebar";
import DashboardPage from "./pages/DashboardPage";
import DesignSettingsPage from "./pages/DesignSettingsPage";
import MoyanAgentPage from "./pages/MoyanAgentPage";
import ProjectListPage from "./pages/ProjectListPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";

export default function App() {
  return (
    <DesignSettingsProvider>
      <Routes>
        <Route path="/agent/*" element={<MoyanAgentPage />} />
        <Route path="*" element={<LoraAppShell />} />
      </Routes>
    </DesignSettingsProvider>
  );
}

function LoraAppShell() {
  return (
    <>
      <div className="scan-flash" id="scan-fx" />
      <Titlebar />
      <AmbientBackground />
      <div className="app-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/design" element={<DesignSettingsPage />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
        </Routes>
      </div>
      <AgentLauncherFab />
    </>
  );
}
