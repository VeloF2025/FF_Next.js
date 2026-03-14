/**
 * Sage-style horizontal navigation bar for procurement pages
 * Tabs with dropdown menus; supports up to three-level flyout nesting
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  TABS, getActiveTabId, isLinkActive, isFlyout,
  type Tab, type DropdownItem, type NavItem,
} from './procurementNavConfig';

const linkCls = (active: boolean) =>
  `block px-4 py-2 text-sm whitespace-nowrap transition-colors ${
    active
      ? 'text-blue-400 bg-blue-500/10'
      : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)]'
  }`;

const sectionCls = (hovered: boolean, active: boolean) =>
  `flex items-center justify-between px-4 py-2.5 text-sm cursor-default transition-colors ${
    hovered
      ? 'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]'
      : active ? 'text-blue-400' : 'text-[var(--ff-text-secondary)]'
  }`;

const panelCls = 'absolute left-full top-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-r-lg shadow-xl min-w-[210px] py-1';

/** Renders a list of NavItems — links for DropdownItem, hoverable sub-sections for FlyoutSection */
function SubMenuItems({ items, asPath, onClose }: { items: NavItem[]; asPath: string; onClose: () => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timerRef.current) clearTimeout(timerRef.current); };
  const delayed = () => { timerRef.current = setTimeout(() => setHovered(null), 150); };
  useEffect(() => () => clear(), []);

  return (
    <>
      {items.map(item => {
        if (!isFlyout(item)) {
          return (
            <Link key={item.href} href={item.href} onClick={onClose} className={linkCls(isLinkActive(item.href, asPath))}>
              {item.label}
            </Link>
          );
        }
        const isHov = hovered === item.section;
        return (
          <div key={item.section} className="relative"
            onMouseEnter={() => { clear(); setHovered(item.section); }}
            onMouseLeave={delayed}>
            <div className={sectionCls(isHov, false)}>
              <span className="font-medium">{item.section}</span>
              <ChevronRight className="h-3.5 w-3.5 ml-6 flex-shrink-0" />
            </div>
            {isHov && (
              <div onMouseEnter={clear} onMouseLeave={delayed} className={panelCls}>
                <SubMenuItems items={item.items} asPath={asPath} onClose={onClose} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Simple flat dropdown (no flyout sections) */
function FlatDropdown({ items, asPath, onClose }: { items: DropdownItem[]; asPath: string; onClose: () => void }) {
  return (
    <div className="absolute top-full left-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-b-lg shadow-xl min-w-[220px] py-1 z-40">
      {items.map(item => (
        <Link key={item.href} href={item.href} onClick={onClose} className={linkCls(isLinkActive(item.href, asPath))}>
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

  return (
    <div className="absolute top-full left-0 z-40">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-b-lg shadow-xl min-w-[200px] py-1">
        {tab.topItems?.map(item => (
          <Link key={item.href} href={item.href} onClick={onClose}
            className="block px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-primary)] transition-colors">
            {item.label}
          </Link>
        ))}
        {tab.topItems && tab.topItems.length > 0 && (
          <div className="border-t border-[var(--ff-border-light)] my-1" />
        )}

        {sections.map(section => {
          const isHovered = hoveredSection === section.section;
          return (
            <div key={section.section} className="relative"
              onMouseEnter={() => { clearTimer(); setHoveredSection(section.section); }}
              onMouseLeave={delayedClose}>
              <div className={sectionCls(isHovered, false)}>
                <span className="font-medium">{section.section}</span>
                <ChevronRight className="h-3.5 w-3.5 ml-6 flex-shrink-0" />
              </div>
              {isHovered && (
                <div onMouseEnter={clearTimer} onMouseLeave={delayedClose} className={panelCls}>
                  <SubMenuItems items={section.items} asPath={asPath} onClose={onClose} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProcurementNav() {
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
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {t.label}
              </Link>
            ) : (
              <button
                onClick={() => setOpenTab(openTab === t.id ? null : t.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1 ${
                  activeTab === t.id
                    ? 'border-blue-500 text-blue-400'
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
