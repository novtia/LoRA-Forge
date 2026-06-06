import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  HardDrive,
  Loader2,
  RefreshCw,
  TerminalSquare,
  Layers,
} from "lucide-react";
import { inspectEnvironment } from "../../lib/desktopApi";
import type { TranslateFn } from "../../lib/i18n";
import type { EnvironmentReport } from "../../lib/types";

interface EnvironmentInspectorPanelProps {
  t: TranslateFn;
  onError: (message: string | null) => void;
}

export function EnvironmentInspectorPanel({ t, onError }: EnvironmentInspectorPanelProps) {
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setReport(await inspectEnvironment());
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.loadEnvironment"));
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="card fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.2s" }}>
      <div className="card-header">
        <span className="card-title-icon">
          <Cpu size={18} /> {t("env.environment")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t("env.environmentDesc")}</span>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 size={16} className="lf-icon-spin" /> : <RefreshCw size={16} />}{" "}
            {loading ? t("env.refreshing") : t("env.refresh")}
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "1.5rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1.25rem",
        }}
      >
        {/* Python */}
        <EnvCard icon={<TerminalSquare size={14} />} title={t("env.python")}>
          {report && report.pythons.length > 0 ? (
            report.pythons.map((py, index) => (
              <div key={`${py.source}-${index}`} className="env-kv">
                <span className="env-kv-key">{py.label}</span>
                <span className="env-kv-val">{py.version || t("env.notDetected")}</span>
                {py.path ? <span className="env-kv-path">{py.path}</span> : null}
              </div>
            ))
          ) : (
            <EmptyHint text={t("env.noPython")} />
          )}
        </EnvCard>

        {/* WSL */}
        <EnvCard icon={<Layers size={14} />} title={t("env.wslDistros")}>
          {report && report.wslDistros.length > 0 ? (
            report.wslDistros.map((distro) => (
              <div key={distro.name} className="env-kv">
                <span className="env-kv-key">
                  {distro.name}
                  {distro.isDefault ? ` (${t("env.defaultDistro")})` : ""}
                </span>
                <span className="env-kv-val">
                  {distro.state} · WSL{distro.version}
                </span>
              </div>
            ))
          ) : (
            <EmptyHint text={t("env.noWsl")} />
          )}
        </EnvCard>

        {/* Git */}
        <EnvCard icon={<TerminalSquare size={14} />} title={t("env.gitVersion")}>
          <div className="env-kv">
            <span className="env-kv-val">{report?.gitVersion || t("env.notDetected")}</span>
          </div>
        </EnvCard>

        {/* CUDA / GPU */}
        <EnvCard icon={<Cpu size={14} />} title={t("env.cudaGpu")}>
          {report?.cuda.available ? (
            <>
              <div className="env-kv">
                <span className="env-kv-key">{t("env.gpu")}</span>
                <span className="env-kv-val">{report.cuda.gpuName || t("env.notDetected")}</span>
              </div>
              <div className="env-kv">
                <span className="env-kv-key">{t("env.driver")}</span>
                <span className="env-kv-val">{report.cuda.driverVersion || "-"}</span>
              </div>
              <div className="env-kv">
                <span className="env-kv-key">{t("env.cudaVersion")}</span>
                <span className="env-kv-val">{report.cuda.cudaVersion || "-"}</span>
              </div>
              {report.cuda.nvccVersion ? (
                <div className="env-kv">
                  <span className="env-kv-key">{t("env.nvcc")}</span>
                  <span className="env-kv-val">{report.cuda.nvccVersion}</span>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyHint text={t("env.notDetected")} />
          )}
        </EnvCard>

        {/* Disks */}
        <EnvCard icon={<HardDrive size={14} />} title={t("env.disks")}>
          {report && report.disks.length > 0 ? (
            report.disks.map((disk) => {
              const pct = disk.totalGb > 0 ? Math.round((disk.usedGb / disk.totalGb) * 100) : 0;
              return (
                <div key={disk.name} style={{ marginBottom: "0.6rem" }}>
                  <div className="env-kv" style={{ marginBottom: "0.25rem" }}>
                    <span className="env-kv-key">{disk.name}:</span>
                    <span className="env-kv-val">
                      {disk.usedGb.toFixed(1)} / {disk.totalGb.toFixed(1)} GB
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyHint text={t("env.notDetected")} />
          )}
        </EnvCard>
      </div>
    </section>
  );
}

function EnvCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.75rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        minHeight: "120px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.72rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        {icon}
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{text}</span>;
}
