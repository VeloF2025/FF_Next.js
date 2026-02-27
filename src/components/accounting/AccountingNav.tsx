/**
 * Sage-style horizontal navigation bar for accounting pages
 * Tabs with dropdown menus; Customers/Suppliers use flyout sub-menus
 * that expand to the right on hover (matching Sage's UX pattern)
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  TABS, getActiveTabId, isLinkActive, isFlyout,
  type Tab, type DropdownItem,
} from './accountingNavConfig';

/** Simple flat dropdown (Banking, Accounts, VAT, etc.) */
function FlatDropdown({ items, asPath, onClose }: { items: DropdownItem[]; asPath: string; onClose: () => void }) {
  return (
    <div className="absolute top-full left-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-b-lg shadow-xl min-w-[220px] py-1 z-40">
      {items.map(item => (
        <Link key={item.href} href={item.href} onClick={onClose}
          className={`block px-4 py-2 text-sm transition-colors ${
            isLinkActive(item.href, asPath)
              ? 'text-emerald-400 bg-emerald-500/10'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)]'
          }`}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** Sage-style flyout: left panel with sections, sub-menu appears aligned to hovered row */
function FlyoutDropdown({ tab, asPath, onClose }: { tab: Tab; asPath: string; onClose: () => void }) {
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  const delayedClose = () => { timeoutRef.current = setTimeout(() => setHoveredSection(null), 150); };

  useEffect(() => () => clearTimer(), []);

  const sections = (tab.items || []).filter(isFlyout);
  const activeSection = sections.find(s =>
    s.items.some(item => isLinkActive(item.href, asPath))
  );

  return (
    <div className="absolute top-full left-0 z-40">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-b-lg shadow-xl min-w-[200px] py-1">
        {/* Top-level actions (Add a Customer, etc.) */}
        {tab.topItems?.map(item => (
          <Link key={item.href} href={item.href} onClick={onClose}
            className="block px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)] transition-colors">
            {item.label}
          </Link>
        ))}
        {tab.topItems && tab.topItems.length > 0 && (
          <div className="border-t border-[var(--ff-border-light)] my-1" />
        )}

        {/* Section rows — each is relative so sub-menu anchors to it */}
        {sections.map(section => {
          const isHovered = hoveredSection === section.section;
          const isActive = activeSection?.section === section.section && !hoveredSection;
          return (
            <div
              key={section.section}
              className="relative"
              onMouseEnter={() => { clearTimer(); setHoveredSection(section.section); }}
              onMouseLeave={delayedClose}
            >
              <div
                className={`flex items-center justify-between px-4 py-2.5 text-sm cursor-default transition-colors ${
                  isHovered
                    ? 'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]'
                    : isActive ? 'text-emerald-400' : 'text-[var(--ff-text-secondary)]'
                }`}
              >
                <span className="font-medium">{section.section}</span>
                <ChevronRight className="h-3.5 w-3.5 ml-6 flex-shrink-0" />
              </div>

              {/* Sub-menu: positioned to the right, top-aligned with this row */}
              {isHovered && (
                <div
                  onMouseEnter={clearTimer}
                  onMouseLeave={delayedClose}
                  className="absolute left-full top-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-r-lg shadow-xl min-w-[210px] py-1"
                >
                  {section.items.map(item => (
                    <Link key={item.href} href={item.href} onClick={onClose}
                      className={`block px-4 py-2 text-sm whitespace-nowrap transition-colors ${
                        isLinkActive(item.href, asPath)
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)]'
                      }`}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AccountingNav() {
  const router = useRouter();
  const [openTab, setOpenTab] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const activeTab = getActiveTabId(router.pathname, router.query);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenTab(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setOpenTab(null); }, [router.pathname]);

  const hasFlyout = (t: Tab) => t.items?.some(isFlyout) ?? false;

  return (
    <nav ref={navRef} className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] relative z-30">
      <div className="flex items-center gap-0 px-2">
        {TABS.map(t => (
          <div key={t.id} className="relative">
            {t.href ? (
              <Link href={t.href}
                className={`block px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {t.label}
              </Link>
            ) : (
              <button
                onClick={() => setOpenTab(openTab === t.id ? null : t.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1 ${
                  activeTab === t.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {t.label}
                <ChevronDown className={`h-3 w-3 transition-transform ${openTab === t.id ? 'rotate-180' : ''}`} />
              </button>
            )}

            {t.items && openTab === t.id && (
              hasFlyout(t)
                ? <FlyoutDropdown tab={t} asPath={router.asPath} onClose={() => setOpenTab(null)} />
                : <FlatDropdown items={t.items as DropdownItem[]} asPath={router.asPath} onClose={() => setOpenTab(null)} />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
