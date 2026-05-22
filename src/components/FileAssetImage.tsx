import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { Image as ImageIcon } from "lucide-react";
import { toFileAssetUrl } from "../lib/desktopApi";

interface FileAssetImageProps {
  filePath?: string | null;
  alt: string;
  className?: string;
  title?: string;
  fit?: CSSProperties["objectFit"];
  style?: CSSProperties;
  imageStyle?: CSSProperties;
  placeholderIconSize?: number;
  showOverlay?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export default function FileAssetImage({
  filePath,
  alt,
  className,
  title,
  fit = "cover",
  style,
  imageStyle,
  placeholderIconSize = 18,
  showOverlay = false,
  onClick,
}: FileAssetImageProps) {
  const [hasError, setHasError] = useState(false);
  const src = useMemo(() => (filePath ? toFileAssetUrl(filePath) : null), [filePath]);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const canRenderImage = Boolean(src) && !hasError;

  return (
    <div
      className={className}
      title={title}
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-base)",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {canRenderImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setHasError(true)}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: fit,
            ...imageStyle,
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--border-dim)",
          }}
        >
          <ImageIcon size={placeholderIconSize} />
        </div>
      )}
      {showOverlay ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
