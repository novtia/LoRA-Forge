import { useTranslation } from "react-i18next";
import type { AttachmentDraft } from "../../types";
import { Composer } from "./Composer";

interface EmptyChatProps {
  onEditAttachment: (a: AttachmentDraft) => void;
  needsSetup: boolean;
  hasProjects: boolean;
}

export function EmptyChat({
  onEditAttachment,
  needsSetup,
  hasProjects,
}: EmptyChatProps) {
  const { t } = useTranslation();

  return (
    <div className="empty-chat" role="region" aria-labelledby="empty-chat-title">
      <div className="empty-chat-inner">
        <h1 id="empty-chat-title" className="empty-chat-title">
          {hasProjects ? t("chat.heroTitle") : "请先在主窗口创建 LoRA 训练项目"}
        </h1>
        {hasProjects && (
          <Composer
            onEditAttachment={onEditAttachment}
            needsSetup={needsSetup}
          />
        )}
      </div>
    </div>
  );
}
