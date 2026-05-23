/**
 * @fileoverview Shared Zeval wordmark used by the app shell and landing page.
 */

import styles from "./zevalLogo.module.css";

type ZevalLogoProps = {
  subtitle?: string;
  compact?: boolean;
};

/**
 * Render the Zeval brand mark and wordmark.
 *
 * @param props Logo display options.
 */
export function ZevalLogo({ subtitle, compact = false }: ZevalLogoProps) {
  return (
    <span className={`${styles.logo} ${compact ? styles.logoCompact : ""}`}>
      <span className={styles.mark} aria-hidden="true">
        <span className={styles.markGrid} />
        <span className={styles.markGlyph}>Z</span>
      </span>
      <span className={styles.copy}>
        <span className={styles.word}>Zeval</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
    </span>
  );
}
