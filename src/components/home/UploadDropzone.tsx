/**
 * @fileoverview Upload dropzone for raw chatlog ingestion.
 */

import type { ChangeEvent, DragEvent, RefObject } from "react";
import { FeatherIcon } from "@/components/home/FeatherIcon";
import styles from "./evalConsole.module.css";

/**
 * Render upload dropzone and action controls.
 * @param props Dropzone props.
 * @returns Upload panel content.
 */
export function UploadDropzone(props: {
  dragActive: boolean;
  uploading: boolean;
  fileName: string;
  maxUploadSizeMb: number;
  canRunEvaluate: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onRunEvaluate: () => Promise<void>;
  processing: boolean;
}) {
  const {
    dragActive,
    uploading,
    fileName,
    maxUploadSizeMb,
    canRunEvaluate,
    fileInputRef,
    onDragOver,
    onDragLeave,
    onDrop,
    onFileInputChange,
    onRunEvaluate,
    processing,
  } = props;

  return (
    <div className={styles.uploadRow}>
      <label
        className={`${styles.uploadZone} ${dragActive ? styles.uploadZoneActive : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          className={styles.fileInputHidden}
          type="file"
          accept=".csv,.json,.jsonl,.txt,.md"
          onChange={onFileInputChange}
        />
        <button
          className={styles.iconButton}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            fileInputRef.current?.click();
          }}
          aria-label="上传文件"
        >
          <FeatherIcon name="upload" />
        </button>
        <div className={styles.uploadContent}>
          <div className={styles.uploadText}>
            <strong>拖拽日志文件到这里，或点击选择上传</strong>
            <span>
              {uploading
                ? "正在上传并解析..."
                : fileName
                  ? `当前文件：${fileName}`
                  : `支持 csv/json/jsonl/txt/md，单文件不超过 ${maxUploadSizeMb}MB`}
            </span>
          </div>
          <div className={styles.uploadHintRow}>
            {["CSV", "JSON", "JSONL", "TXT", "MD"].map((item) => (
              <span className={styles.formatPill} key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </label>

      <button
        className={styles.processButton}
        onClick={() => {
          void onRunEvaluate();
        }}
        type="button"
        disabled={!canRunEvaluate}
        title={!canRunEvaluate ? "请先完成日志上传与解析" : ""}
      >
        <FeatherIcon name="play" />
        <span className={styles.processButtonText}>
          <strong>{processing ? "评估执行中..." : "开始评估"}</strong>
          <small>{canRunEvaluate ? "调用完整评估链路" : "需先完成日志接入"}</small>
        </span>
      </button>
    </div>
  );
}
