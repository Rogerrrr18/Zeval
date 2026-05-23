"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ZevalLogo } from "@/components/brand/ZevalLogo";
import { LANDING_COPY, type Locale } from "@/i18n/landing";
import styles from "./landingPage.module.css";

const LOCALE_STORAGE_KEY = "zeval:locale";
const LEGACY_LOCALE_STORAGE_KEY = "zerore:locale";

/**
 * Read the persisted landing page locale, falling back to Chinese for first-time visitors.
 *
 * @returns The initial locale used by the client component.
 */
function getInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "zh";
  }

  const stored =
    window.localStorage.getItem(LOCALE_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
  return stored === "zh" || stored === "en" ? stored : "zh";
}

/**
 * Render the public-facing bilingual landing page (zh default, en switchable).
 */
export function LandingPage() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);

  /**
   * Toggle locale and persist it to localStorage.
   */
  function handleToggleLocale() {
    setLocale((current) => {
      const next: Locale = current === "zh" ? "en" : "zh";
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      if (typeof document !== "undefined") {
        document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
      }
      return next;
    });
  }

  const copy = LANDING_COPY[locale];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Zeval home">
          <ZevalLogo compact />
        </Link>
        <nav className={styles.nav} aria-label="primary">
          {copy.nav.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.langToggle}
            onClick={handleToggleLocale}
            aria-label={`Switch to ${copy.langSwitch.switchTo}`}
          >
            <span>{copy.langSwitch.label}</span>
            <span aria-hidden>/</span>
            <span>{copy.langSwitch.switchTo}</span>
          </button>
          <Link href="/workbench" className={styles.primaryButton}>
            {copy.ctaPrimary}
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{copy.hero.eyebrow}</p>
            <h1>{copy.hero.headline}</h1>
            <p className={styles.heroLead}>{copy.hero.lead}</p>
            <div className={styles.heroActions}>
              <Link href="/workbench" className={styles.primaryButton}>
                {copy.ctaPrimary}
              </Link>
              <Link href="/online-eval" className={styles.secondaryButton}>
                {copy.ctaSecondary}
              </Link>
            </div>
            <dl className={styles.heroStats}>
              {copy.hero.stats.map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={styles.productVisual} aria-label={copy.hero.previewLabel}>
            <div className={styles.visualTopbar}>
              <span />
              <span />
              <span />
              <strong>Zeval Workbench</strong>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.ingestPanel}>
                <span className={styles.panelLabel}>{copy.hero.preview.ingestLabel}</span>
                <strong>{copy.hero.preview.ingestTitle}</strong>
                <p>{copy.hero.preview.ingestText}</p>
                <div className={styles.fileChips}>
                  {copy.hero.preview.formats.map((format) => (
                    <span key={format}>{format}</span>
                  ))}
                </div>
              </div>
              <div className={styles.scorePanel}>
                <span className={styles.panelLabel}>{copy.hero.preview.scoreLabel}</span>
                <strong>{copy.hero.preview.score}</strong>
                <p>{copy.hero.preview.scoreText}</p>
                <div className={styles.scoreBars}>
                  <span style={{ "--bar": "82%" } as CSSProperties} />
                  <span style={{ "--bar": "64%" } as CSSProperties} />
                  <span style={{ "--bar": "48%" } as CSSProperties} />
                </div>
              </div>
              <div className={styles.tracePanel}>
                <span className={styles.panelLabel}>{copy.hero.preview.traceLabel}</span>
                <ol>
                  {copy.hero.preview.trace.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
              <div className={styles.packagePanel}>
                <span className={styles.panelLabel}>{copy.hero.preview.packageLabel}</span>
                <strong>{copy.hero.preview.packageTitle}</strong>
                <p>{copy.hero.preview.packageText}</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} id="capabilities">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{copy.capabilitiesSection.eyebrow}</p>
            <h2>{copy.capabilitiesSection.title}</h2>
            <p>{copy.capabilitiesSection.lead}</p>
          </div>
          <div className={styles.capabilityGrid}>
            {copy.capabilities.map((item) => (
              <article className={styles.capabilityCard} key={item.title}>
                <span>{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <ul>
                  {item.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.loopSection} id="loop">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{copy.loopSection.eyebrow}</p>
            <h2>{copy.loopSection.title}</h2>
          </div>
          <div className={styles.loopGrid}>
            {copy.loopSteps.map((item, index) => (
              <article className={styles.loopCard} key={item.step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.step}</strong>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.integrationSection} id="integration">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{copy.integrationSection.eyebrow}</p>
            <h2>{copy.integrationSection.title}</h2>
            <p>{copy.integrationSection.lead}</p>
          </div>
          <div className={styles.integrationGrid}>
            {copy.integrations.map((item) => (
              <article className={styles.integrationCard} key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <code>{item.code}</code>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} id="outcomes">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{copy.outcomesSection.eyebrow}</p>
            <h2>{copy.outcomesSection.title}</h2>
          </div>
          <div className={styles.outcomeGrid}>
            {copy.outcomes.map((item) => (
              <article className={styles.outcomeCard} key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.faqSection} id="faq">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{copy.faqSection.eyebrow}</p>
            <h2>{copy.faqSection.title}</h2>
          </div>
          <div className={styles.faqList}>
            {copy.faq.map((item) => (
              <details className={styles.faqItem} key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.ctaSection}>
          <div>
            <p className={styles.eyebrow}>{copy.cta.eyebrow}</p>
            <h2>{copy.cta.title}</h2>
            <p>{copy.cta.lead}</p>
          </div>
          <div className={styles.ctaActions}>
            <Link href="/workbench" className={styles.primaryButton}>
              {copy.ctaPrimary}
            </Link>
            <Link href="/remediation-packages" className={styles.secondaryButton}>
              {copy.ctaTertiary}
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <ZevalLogo compact />
            <p>{copy.footer.tagline}</p>
          </div>
          <div className={styles.footerLinks}>
            {copy.footer.columns.map((column) => (
              <div key={column.title}>
                <h4>{column.title}</h4>
                {column.links.map((link) => (
                  <Link key={link.href} href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>{copy.footer.copyright(new Date().getFullYear())}</span>
          <span>{copy.footer.builtFor}</span>
        </div>
      </footer>
    </div>
  );
}
