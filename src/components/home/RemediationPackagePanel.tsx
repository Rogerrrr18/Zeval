/**
 * @fileoverview Viewer and exporter for one generated remediation package.
 */

"use client";

import { useState } from "react";
import type { RemediationPackageSnapshot } from "@/remediation";
import styles from "./remediationPackagePanel.module.css";

type RemediationPackagePanelProps = {
  packageSnapshot: RemediationPackageSnapshot | null;
  loading: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  showGenerateAction?: boolean;
};

/**
 * Render the remediation package panel in the workbench.
 *
 * @param props Panel props.
 * @returns Panel content.
 */
export function RemediationPackagePanel(props: RemediationPackagePanelProps) {
  const [copiedFileName, setCopiedFileName] = useState("");
  const [activePackageTab, setActivePackageTab] = useState<"overview" | "reference" | "readme">("overview");

  /**
   * Copy one package file to clipboard.
   *
   * @param fileName Artifact file name.
   * @param content File content.
   */
  async function handleCopy(fileName: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedFileName(fileName);
      window.setTimeout(() => setCopiedFileName(""), 1600);
    } catch {
      setCopiedFileName("");
    }
  }

  if (!props.packageSnapshot) {
    return (
      <div className={styles.emptyState}>
        <p>先完成一次评估并识别 bad case，再把结果编译成 Claude Code / Codex 可读的 Skill 文件夹。</p>
        {props.showGenerateAction === false ? null : (
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!props.canGenerate || props.loading}
            onClick={props.onGenerate}
          >
            {props.loading ? "生成中…" : "生成调优包"}
          </button>
        )}
      </div>
    );
  }

  const packageSnapshot = props.packageSnapshot;
  const skillBundle = packageSnapshot.skillBundle;
  const overviewFile = skillBundle?.skillFile;
  const readmeFile = skillBundle?.readmeFile;
  const referenceFiles = skillBundle?.referenceFiles ?? packageSnapshot.files.map((file) => ({
    ...file,
    role: "reference" as const,
  }));

  return (
    <div className={styles.stack}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h3>{packageSnapshot.title}</h3>
          <p>
            packageId={packageSnapshot.packageId} · priority={packageSnapshot.priority} · selected=
            {packageSnapshot.selectedCaseCount}
          </p>
        </div>
        {props.showGenerateAction === false ? null : (
          <button className={styles.primaryButton} type="button" disabled={props.loading} onClick={props.onGenerate}>
            {props.loading ? "重新生成中…" : "重新生成"}
          </button>
        )}
      </div>

      <div className={styles.metaGrid}>
        <article className={styles.metaCard}>
          <span>Run</span>
          <strong>{packageSnapshot.runId}</strong>
          <small>本次调优包来源的评估 run</small>
        </article>
        <article className={styles.metaCard}>
          <span>Scenario</span>
          <strong>{packageSnapshot.scenarioId ?? "generic"}</strong>
          <small>当前调优目标绑定的业务场景</small>
        </article>
        <article className={styles.metaCard}>
          <span>Replay Gate</span>
          <strong>{packageSnapshot.acceptanceGate.replay.minWinRate}</strong>
          <small>最低 replay win rate</small>
        </article>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Problem Summary</p>
        <ul className={styles.bulletList}>
          {packageSnapshot.problemSummary.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Dominant Tags</p>
        <div className={styles.tagRow}>
          {packageSnapshot.dominantTags.map((tag) => (
            <span className={styles.tagPill} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Target Metrics</p>
        <div className={styles.metricList}>
          {packageSnapshot.targetMetrics.length > 0 ? (
            packageSnapshot.targetMetrics.map((item) => (
              <article className={styles.metricCard} key={item.metricId}>
                <strong>{item.displayName}</strong>
                <p>
                  {item.currentValue.toFixed(4)} → {item.targetValue.toFixed(4)} ·
                  {item.direction === "increase" ? " 提高" : " 降低"}
                </p>
                <small>{item.reason}</small>
              </article>
            ))
          ) : (
            <div className={styles.emptyInline}>当前未生成额外目标指标，将以 replay / regression gate 为主。</div>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Skill 文件夹</p>
        <div className={styles.packageTabs}>
          <button
            className={`${styles.packageTab} ${activePackageTab === "overview" ? styles.packageTabActive : ""}`}
            type="button"
            onClick={() => setActivePackageTab("overview")}
          >
            概览（SKILL.md）
          </button>
          <button
            className={`${styles.packageTab} ${activePackageTab === "reference" ? styles.packageTabActive : ""}`}
            type="button"
            onClick={() => setActivePackageTab("reference")}
          >
            Reference 文件
          </button>
          <button
            className={`${styles.packageTab} ${activePackageTab === "readme" ? styles.packageTabActive : ""}`}
            type="button"
            onClick={() => setActivePackageTab("readme")}
          >
            使用说明
          </button>
        </div>
        {activePackageTab === "overview" ? (
          <FilePreviewCard
            copiedFileName={copiedFileName}
            file={overviewFile ?? referenceFiles[0]}
            packageId={packageSnapshot.packageId}
            onCopy={handleCopy}
          />
        ) : null}
        {activePackageTab === "reference" ? (
          <div className={styles.fileList}>
            {referenceFiles.map((file) => (
              <FilePreviewCard
                copiedFileName={copiedFileName}
                file={file}
                key={file.relativePath}
                packageId={packageSnapshot.packageId}
                onCopy={handleCopy}
              />
            ))}
          </div>
        ) : null}
        {activePackageTab === "readme" ? (
          <FilePreviewCard
            copiedFileName={copiedFileName}
            file={readmeFile ?? referenceFiles[0]}
            packageId={packageSnapshot.packageId}
            onCopy={handleCopy}
          />
        ) : null}
      </div>

      <p className={styles.footerNote}>
        skillFolder: <code>{packageSnapshot.skillFolder ?? packageSnapshot.artifactDir}</code>。可以直接把这个文件夹交给 Claude Code / Codex 做后续开发与回归。
      </p>
    </div>
  );
}

function FilePreviewCard(props: {
  file?: { fileName: string; relativePath: string; content: string };
  packageId: string;
  copiedFileName: string;
  onCopy: (fileName: string, content: string) => Promise<void>;
}) {
  if (!props.file) {
    return <div className={styles.emptyInline}>当前没有可预览的文件。</div>;
  }
  return (
    <details className={styles.fileCard} open>
      <summary className={styles.fileSummary}>
        <div>
          <strong>{props.file.fileName}</strong>
          <p>{props.file.relativePath}</p>
        </div>
        <div className={styles.fileActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              downloadTextFile(`${props.packageId}.${props.file?.fileName}`, props.file?.content ?? "");
            }}
          >
            下载
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              void props.onCopy(props.file?.fileName ?? "file", props.file?.content ?? "");
            }}
          >
            {props.copiedFileName === props.file.fileName ? "已复制" : "复制"}
          </button>
        </div>
      </summary>
      <pre className={styles.filePreview}>{props.file.content}</pre>
    </details>
  );
}

/**
 * Download one text artifact in the browser.
 *
 * @param fileName Target file name.
 * @param content File content.
 */
function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
