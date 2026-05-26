/**
 * @fileoverview Unified app shell: top navigation + content frame for all consoles.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ZevalLogo } from "@/components/brand/ZevalLogo";
import { useProject } from "./ProjectContext";
import { ProjectSwitcher } from "./ProjectSwitcher";
import styles from "./appShell.module.css";

const NAV_ITEMS = [
  { label: "总览", href: "/", match: "/", group: "Project" },
  { label: "评估", href: "/workbench", match: "/workbench", group: "Quality Loop" },
  { label: "案例校准", href: "/datasets", match: "/datasets", group: "Quality Loop" },
  { label: "Benchmark", href: "/benchmark", match: "/benchmark", group: "Quality Loop" },
  { label: "合成补样本", href: "/synthesize", match: "/synthesize", group: "Quality Loop" },
  { label: "修复验证", href: "/remediation-packages", match: "/remediation-packages", group: "Quality Loop" },
  { label: "Copilot", href: "/chat", match: "/chat", group: "Assistants" },
  { label: "集成", href: "/integrations", match: "/integrations", group: "Assistants" },
];

const THEME_STORAGE_KEY = "zeval:theme";

type Theme = "light" | "dark";

const DEFAULT_THEME: Theme = "dark";
const themeListeners = new Set<() => void>();

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitThemeChange() {
  themeListeners.forEach((listener) => listener());
}

function syncDocumentTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function applyThemePreference(theme: Theme) {
  syncDocumentTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage can be unavailable in restricted browsing contexts.
  }

  emitThemeChange();
}

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
  const theme = useSyncExternalStore(subscribeTheme, readStoredTheme, () => DEFAULT_THEME);
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

  useEffect(() => {
    syncDocumentTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    applyThemePreference(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.brand} aria-label="Zeval home">
            <ZevalLogo subtitle="Eval OS" />
          </Link>
          <button
            type="button"
            className={`${styles.themeSwitch} ${theme === "dark" ? styles.themeSwitchDark : ""}`}
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
            title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          >
            <span className={`${styles.themeGlyph} ${styles.themeGlyphSun}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2.4M12 19.6V22M4.93 4.93l1.7 1.7M17.37 17.37l1.7 1.7M2 12h2.4M19.6 12H22M4.93 19.07l1.7-1.7M17.37 6.63l1.7-1.7" />
              </svg>
            </span>
            <span className={`${styles.themeGlyph} ${styles.themeGlyphMoon}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M20.4 14.4A7.7 7.7 0 0 1 9.6 3.6 8.7 8.7 0 1 0 20.4 14.4Z" />
              </svg>
            </span>
            <span className={styles.themeThumb} aria-hidden="true" />
          </button>
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
            <Link href="/workbench" className={styles.evaluateButton}>
              Evaluate
            </Link>
          </div>
        </header>
        {subheader ? <div className={styles.subheader}>{subheader}</div> : null}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
