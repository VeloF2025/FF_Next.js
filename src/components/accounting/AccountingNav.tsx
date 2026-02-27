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

/** Sage-style flyout dropdown with section rows that expand sub-menus to the right */
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
    <div className="absolute top-full left-0 flex z-40">
      {/* Left panel: top actions + section names */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-bl-lg shadow-xl min-w-[200px] py-1">
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
          const isActive = activeSection?.section === section.section && !hoveredSection;
          return (
            <div
              key={section.section}
              onMouseEnter={() => { clearTimer(); setHoveredSection(section.section); }}
              onMouseLeave={delayedClose}
              className={`flex items-center justify-between px-4 py-2.5 text-sm cursor-default transition-colors ${
                isHovered
                  ? 'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]'
                  : isActive ? 'text-emerald-400' : 'text-[var(--ff-text-secondary)]'
              }`}
            >
              <span className="font-medium">{section.section}</span>
              <ChevronRight className="h-3.5 w-3.5 ml-4 flex-shrink-0" />
            </div>
          );
        })}
      </div>

      {/* Right panel: sub-items for hovered section */}
      {hoveredSection && (
        <div
          onMouseEnter={clearTimer}
          onMouseLeave={delayedClose}
          className="bg-[var(--ff-bg-secondary)] border border-l-0 border-[var(--ff-border-light)] rounded-br-lg shadow-xl min-w-[200px] py-1"
        >
          {sections
            .find(s => s.section === hoveredSection)
            ?.items.map(item => (
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
      )}
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

  const hasFlyout = (tab: Tab) => tab.items?.some(isFlyout) ?? false;

  return (
    <nav ref={navRef} className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] relative z-30">
      <div className="flex items-center gap-0 px-2">
        {TABS.map(tab => (
          <div key={tab.id} className="relative">
            {tab.href ? (
              <Link href={tab.href}
                className={`block px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {tab.label}
              </Link>
            ) : (
              <button
                onClick={() => setOpenTab(openTab === tab.id ? null : tab.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1 ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}>
                {tab.label}
                <ChevronDown className={`h-3 w-3 transition-transform ${openTab === tab.id ? 'rotate-180' : ''}`} />
              </button>
            )}

            {tab.items && openTab === tab.id && (
              hasFlyout(tab)
                ? <FlyoutDropdown tab={tab} asPath={router.asPath} onClose={() => setOpenTab(null)} />
                : <FlatDropdown items={tab.items as DropdownItem[]} asPath={router.asPath} onClose={() => setOpenTab(null)} />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
