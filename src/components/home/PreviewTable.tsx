/**
 * @fileoverview Canonical CSV preview table.
 */

import styles from "./evalConsole.module.css";

/**
 * Render canonical preview with sticky header.
 * @param props Preview props.
 * @returns Preview table or empty state.
 */
export function PreviewTable(props: { header: string[]; rows: string[][] }) {
  if (props.rows.length === 0) {
    return <div className={styles.emptyState}>上传日志后展示标准化后的数据预览</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.previewTable}>
        <thead>
          <tr>
            {props.header.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={`preview-row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`preview-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
