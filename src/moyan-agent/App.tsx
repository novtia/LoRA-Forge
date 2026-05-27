import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatView } from "./components/chat/ChatView";
import { Dropzone } from "./components/media/Dropzone";
import { ImageEditor } from "./components/editor/ImageEditor";
import { ImagePreview } from "./components/media/ImagePreview";
import { ContextMenuHost } from "./components/context-menu";
import { ToastHost, DialogHost } from "./components/ui";
import { SearchDialog } from "./components/search/SearchDialog";
import { TitleBar } from "./components/layout/TitleBar";
import { useSettings } from "./store/settings";
import { useSession } from "./store/session";
import { useProject } from "./store/project";
import { collectSessionGalleryImages, indexOfImageInGallery } from "./sessionGallery";
import type { AttachmentDraft, ImageRefAbs } from "./types";

export default function App() {
  const loadSettings = useSettings((s) => s.load);
  const settings = useSettings((s) => s.settings);
  const refreshList = useSession((s) => s.refreshList);
  const refreshProjects = useProject((s) => s.refreshList);
  const setAspectRatio = useSession((s) => s.setAspectRatio);
  const setImageSize = useSession((s) => s.setImageSize);

  const [editorTarget, setEditorTarget] = useState<AttachmentDraft | null>(null);
  const [preview, setPreview] = useState<{ items: ImageRefAbs[]; index: number } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    loadSettings();
    refreshList();
    refreshProjects();
  }, [loadSettings, refreshList, refreshProjects]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (settings.default_aspect_ratio) setAspectRatio(settings.default_aspect_ratio);
    if (settings.default_image_size) setImageSize(settings.default_image_size);
  }, [settings, setAspectRatio, setImageSize]);

  const activeProvider = settings?.model_services?.find(
    (provider) => provider.id === settings.active_provider_id,
  );
  const activeModel =
    activeProvider && activeProvider.enabled !== false
      ? activeProvider.models.find((model) => model.id === settings?.model)
      : undefined;
  const needsSetup =
    !activeProvider ||
    activeProvider.enabled === false ||
    !activeProvider.api_key?.trim() ||
    !activeProvider.endpoint?.trim() ||
    !activeModel;

  const onNewChat = async () => {
    const projects = useProject.getState().projects;
    if (projects.length === 0) return;
    await useSession.getState().createNew(projects[0].id);
  };

  return (
    <>
      <div className="ambient-bg" aria-hidden="true" />
      <div className="overlay" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <TitleBar
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          sidebarCollapsed={sidebarCollapsed}
          onNewChat={onNewChat}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <div className="stage">
          <Sidebar onOpenSearch={() => setSearchOpen(true)} />
          <ChatView
            onEditAttachment={(attachment) => setEditorTarget(attachment)}
            onPreviewImage={(img: ImageRefAbs) => {
              const session = useSession.getState().active;
              const items = collectSessionGalleryImages(session);
              const idx = indexOfImageInGallery(items, img);
              if (idx >= 0) {
                setPreview({ items, index: idx });
              } else {
                setPreview({ items: [img], index: 0 });
              }
            }}
            needsSetup={needsSetup}
          />
        </div>
      </div>
      <Dropzone />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onOpenChat={() => {}} />
      {editorTarget && (
        <ImageEditor
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onApplied={(newDraft) => {
            useSession.getState().replaceAttachment(editorTarget.image_id, newDraft);
            setEditorTarget(null);
          }}
        />
      )}
      {preview && (
        <ImagePreview
          items={preview.items}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}
      <ContextMenuHost />
      <ToastHost />
      <DialogHost />
    </>
  );
}
