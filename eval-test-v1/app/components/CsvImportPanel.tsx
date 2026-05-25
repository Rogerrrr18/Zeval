"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useRef, useState } from "react";
import styles from "@/app/experiment.module.css";

export type CsvPreview = {
  columns: string[];
  rows: Record<string, string | number>[];
};

type Props = {
  busy: boolean;
  /** 上传并解析 CSV 文本。 */
  onParse: (csvText: string) => Promise<void>;
  preview: CsvPreview | null;
  selectedSessionId: string | null;
};

const MAX_MB = 8;

/**
 * CSV 拖放 / 点击上传、真实样例一键解析与预览表。
 */
export function CsvImportPanel(props: Props) {
  const { busy, onParse, preview, selectedSessionId } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileLabel, setFileLabel] = useState<string>("");

  const readFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        setFileLabel("请选择 .csv 文件");
        return;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setFileLabel(`文件超过 ${MAX_MB}MB`);
        return;
      }
      const text = await file.text();
      setFileLabel(file.name);
      await onParse(text);
    },
    [onParse],
  );

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await readFile(file);
  };

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = () => setDragActive(false);

  const onDrop = async (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await readFile(file);
  };

  const oneClickMultiwoz = async () => {
    setFileLabel("multiwoz_samples_10.csv（内置）");
    const r = await fetch("/multiwoz_samples_10.csv");
    const text = await r.text();
    await onParse(text);
  };

  const oneClickZh = async () => {
    setFileLabel("multiwoz_samples_10_zh-CN.csv（中文对照）");
    const r = await fetch("/multiwoz_samples_10_zh-CN.csv");
    const text = await r.text();
    await onParse(text);
  };

  const oneClickLegacy = async () => {
    setFileLabel("sample-sessions.csv（legacy）");
    const r = await fetch("/sample-sessions.csv");
    const text = await r.text();
    await onParse(text);
  };

  const filteredRows =
    preview?.rows.filter((row) => !selectedSessionId || String(row.session_id) === selectedSessionId) ?? [];

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        支持首期冻结 MultiWOZ 7 列或 legacy 四列。字段说明见 <code>docs/CSV_INPUT_FROZEN_V1.md</code>。
      </p>

      <div className={styles.uploadRow}>
        <label
          className={`${styles.uploadZone} ${dragActive ? styles.uploadZoneActive : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={(e) => void onDrop(e)}
        >
          <input ref={inputRef} type="file" accept=".csv,text/csv" className={styles.fileInputHidden} onChange={(e) => void onFileChange(e)} />
          <button
            type="button"
            className={styles.uploadIconBtn}
            aria-label="选择 CSV 文件"
            onClick={(ev) => {
              ev.preventDefault();
              inputRef.current?.click();
            }}
          >
            ↑
          </button>
          <div className={styles.uploadText}>
            <strong>拖拽 CSV 到此处，或点击左侧按钮选择文件</strong>
            <span>
              {busy
                ? "正在解析并写入会话…"
                : fileLabel
                  ? `当前：${fileLabel}`
                  : `单文件不超过 ${MAX_MB}MB · UTF-8`}
            </span>
            <div className={styles.pillRow}>
              <span className={styles.formatPill}>CSV</span>
            </div>
          </div>
        </label>

        <div className={styles.actionStack}>
          <button type="button" className="secondary" disabled={busy} onClick={() => void oneClickMultiwoz()}>
            一键解析真实样例（10 条）
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void oneClickZh()}>
            一键解析中文对照样例
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void oneClickLegacy()}>
            一键解析 legacy 样例
          </button>
        </div>
      </div>

      {preview && preview.columns.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>解析预览 {selectedSessionId ? `· ${selectedSessionId}` : "· 全部会话"}</h3>
          <div className={styles.tableWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr key={i}>
                    {preview.columns.map((c) => (
                      <td key={c}>{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            共 {filteredRows.length} 行{selectedSessionId ? "（已按当前 session 筛选）" : ""}。
          </p>
        </>
      ) : null}
    </div>
  );
}
