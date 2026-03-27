import { Routes, Route } from "react-router-dom";
import { AmbientBackground } from "./components/AmbientBackground";
import { CustomCursor } from "./components/CustomCursor";
import { DesignSettingsProvider, useDesignSettings } from "./components/DesignSettingsProvider";
import { Titlebar } from "./components/Titlebar";
import DashboardPage from "./pages/DashboardPage";
import DesignSettingsPage from "./pages/DesignSettingsPage";
import ProjectListPage from "./pages/ProjectListPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";

export default function App() {
  return (
    <DesignSettingsProvider>
      <AppShell />
    </DesignSettingsProvider>
  );
}

function AppShell() {
  const { settings } = useDesignSettings();

  return (
    <>
      <div className="scan-flash" id="scan-fx" />
      <Titlebar />
      <AmbientBackground />
      {settings.cursorMode === "radar" ? <CustomCursor /> : null}
      <div className="app-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/design" element={<DesignSettingsPage />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
        </Routes>
      </div>
    </>
  );
}
