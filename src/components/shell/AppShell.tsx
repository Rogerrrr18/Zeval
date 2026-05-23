/**
 * @fileoverview Unified app shell: top navigation + content frame for all consoles.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ZevalLogo } from "@/components/brand/ZevalLogo";
import styles from "./appShell.module.css";

const NAV_ITEMS = [
  { label: "Chat", href: "/chat", match: "/chat" },
  { label: "工作台", href: "/workbench", match: "/workbench" },
  { label: "案例池", href: "/datasets", match: "/datasets" },
  { label: "在线评测", href: "/online-eval", match: "/online-eval" },
  { label: "调优包", href: "/remediation-packages", match: "/remediation-packages" },
  { label: "合成", href: "/synthesize", match: "/synthesize" },
];

type AppShellProps = {
  children: ReactNode;
  /** Optional slot rendered directly under the top header (e.g. Stepper). */
  subheader?: ReactNode;
};

/**
 * Render the unified application shell with left sidebar navigation.
 */
export function AppShell({ children, subheader }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="Zeval home">
          <ZevalLogo subtitle="Eval OS" />
        </Link>
        <nav className={styles.nav} aria-label="primary">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname?.startsWith(item.match) || (item.href === "/chat" && pathname?.startsWith("/copilot"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              >
                <span className={styles.navDot} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <Link href="/" className={styles.homeLink}>
            产品首页
          </Link>
        </div>
      </aside>
      <div className={styles.content}>
        {subheader ? <div className={styles.subheader}>{subheader}</div> : null}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
