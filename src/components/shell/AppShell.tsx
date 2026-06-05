/**
 * @fileoverview Unified app shell: top navigation + content frame for all consoles.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ZevalLogo } from "@/components/brand/ZevalLogo";
import { useProject } from "./ProjectContext";
import { ProjectSwitcher } from "./ProjectSwitcher";
import styles from "./appShell.module.css";

const NAV_ITEMS = [
  { label: "总览", href: "/", match: "/", group: "工作台" },
  { label: "评测工作台", href: "/benchmark", match: "/benchmark", group: "工作台" },
  { label: "案例校准", href: "/datasets", match: "/datasets", group: "数据" },
  { label: "合成补样本", href: "/synthesize", match: "/synthesize", group: "数据" },
  { label: "修复验证", href: "/remediation-packages", match: "/remediation-packages", group: "数据" },
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
  const { activeProject } = useProject();
  const activeItem = NAV_ITEMS.find((item) => {
    if (item.href === "/") return pathname === "/";
    return pathname?.startsWith(item.match) || (item.href === "/chat" && pathname?.startsWith("/copilot"));
  }) ?? NAV_ITEMS[0];
  const navGroups = NAV_ITEMS.reduce<Array<{ label: string; items: typeof NAV_ITEMS }>>((groups, item) => {
    const group = groups.find((candidate) => candidate.label === item.group);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ label: item.group, items: [item] });
    }
    return groups;
  }, []);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.brand} aria-label="Zeval home">
            <ZevalLogo subtitle="Eval OS" />
          </Link>
        </div>
        {/* Project switcher */}
        <div className={styles.projectSwitcherWrap}>
          <ProjectSwitcher />
        </div>
        <nav className={styles.nav} aria-label="primary">
          {navGroups.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <span className={styles.navGroupLabel}>{group.label}</span>
              {group.items.map((item) => {
                const active =
                  (item.href === "/" ? pathname === "/" : pathname?.startsWith(item.match)) ||
                  (item.href === "/chat" && pathname?.startsWith("/copilot"));
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
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <Link href="/online-eval" className={styles.homeLink}>
            快速回放
          </Link>
        </div>
      </aside>
      <div className={`${styles.content} ${subheader ? styles.contentWithSubheader : ""}`}>
        <header className={styles.topBar}>
          <div className={styles.topBarTitle}>
            <span>Zeval Quality OS</span>
            <strong>{activeItem.label}</strong>
          </div>
          <div className={styles.topBarActions}>
            <span className={styles.projectBadge} title={activeProject.description ?? activeProject.name}>{activeProject.name}</span>
            <Link href="/benchmark" className={styles.evaluateButton}>
              Benchmark
            </Link>
          </div>
        </header>
        {subheader ? <div className={styles.subheader}>{subheader}</div> : null}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
