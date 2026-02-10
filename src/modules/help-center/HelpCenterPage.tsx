/**
 * Help Center Page
 * 
 * Complete help center with sidebar TOC, search, and content rendering
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Menu, X, Download, ExternalLink, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHelpCenter } from './hooks/useHelpCenter';
import { TableOfContents } from './components/TableOfContents';
import { SearchBar } from './components/SearchBar';
import { SectionRenderer } from './components/SectionRenderer';

/** Strip markdown syntax from text for clean previews */
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')      // images ![alt](src)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // links [text](url)
    .replace(/#{1,6}\s+/g, '')                   // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
    .replace(/\*([^*]+)\*/g, '$1')               // italic
    .replace(/`([^`]+)`/g, '$1')                 // inline code
    .replace(/^\s*[-*+]\s+/gm, '')               // list markers
    .replace(/^\s*\d+\.\s+/gm, '')               // ordered list markers
    .replace(/^\s*>\s+/gm, '')                    // blockquotes
    .replace(/\|/g, ' ')                          // table pipes
    .replace(/[-:]{3,}/g, '')                     // table separators
    .replace(/\s+/g, ' ')                         // collapse whitespace
    .trim();
}

export const HelpCenterPage: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const {
    sections,
    currentSection,
    currentSubsection,
    searchQuery,
    searchResults,
    isSearching,
    prevItem,
    nextItem,
    breadcrumbs,
    setCurrentSection,
    setSearchQuery,
    clearSearch,
    goBack,
    goNext
  } = useHelpCenter();

  // Handle mobile responsiveness
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Scroll content to top when section/subsection changes
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentSection, currentSubsection]);

  // Close sidebar on mobile when section is selected
  const handleSectionSelect = (sectionId: string, subsectionId?: string) => {
    setCurrentSection(sectionId, subsectionId);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleSearchResultClick = (sectionId: string, subsectionId?: string) => {
    setCurrentSection(sectionId, subsectionId);
    clearSearch();
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Get content to display
  const getContentToDisplay = () => {
    if (!currentSection) return '';
    
    if (currentSubsection) {
      const subsection = currentSection.subsections.find(s => s.id === currentSubsection);
      return subsection ? subsection.content : currentSection.content;
    }
    
    return currentSection.content;
  };

  const getDisplayTitle = () => {
    if (!currentSection) return 'Help Center';
    
    if (currentSubsection) {
      const subsection = currentSection.subsections.find(s => s.id === currentSubsection);
      return subsection ? `${currentSection.title} — ${subsection.title}` : currentSection.title;
    }
    
    return currentSection.title;
  };

  return (
    <div className="flex h-screen bg-[var(--ff-bg-primary)]">
      {/* Sidebar */}
      <div className={cn(
        'relative',
        isMobile 
          ? 'fixed inset-y-0 left-0 z-50'
          : 'flex-shrink-0',
        sidebarOpen 
          ? 'w-80' 
          : isMobile ? 'w-0' : 'w-0'
      )}>
        <div className={cn(
          'h-full bg-[var(--ff-bg-secondary)] border-r border-[var(--ff-border-light)] transition-all duration-300',
          sidebarOpen ? 'w-80' : 'w-0 overflow-hidden'
        )}>
          <TableOfContents
            sections={sections}
            currentSectionId={currentSection?.id}
            currentSubsectionId={currentSubsection}
            onSectionClick={handleSectionSelect}
            className="h-full"
          />
        </div>
        
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 -z-10"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] p-4">
          <div className="flex items-center gap-4 mb-4">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(
                'p-2 rounded-lg text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors',
                isMobile ? '' : 'lg:hidden'
              )}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-[var(--ff-text-primary)] truncate">
                Help Center
              </h1>
              {currentSection && (
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1 truncate">
                  {getDisplayTitle()}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <a
                href="/docs/user-manuals/fibreflow-complete.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download PDF</span>
              </a>
              
              <a
                href="mailto:support@velocityfibre.co.za"
                className="hidden sm:flex items-center gap-2 px-3 py-2 text-sm text-white bg-[var(--ff-primary)] hover:bg-[var(--ff-primary)]/90 rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Contact Support</span>
              </a>
            </div>
          </div>

          {/* Search Bar */}
          <SearchBar
            searchQuery={searchQuery}
            searchResults={searchResults}
            isSearching={isSearching}
            onSearchChange={setSearchQuery}
            onResultClick={handleSearchResultClick}
            onClearSearch={clearSearch}
            className="max-w-2xl"
          />
        </div>

        {/* Content Area */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            {/* Breadcrumbs */}
            {currentSection && (
              <nav className="flex items-center gap-1.5 text-sm mb-6 flex-wrap">
                {breadcrumbs.map((crumb, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)] flex-shrink-0" />}
                    {i < breadcrumbs.length - 1 ? (
                      <button
                        onClick={() => crumb.sectionId ? setCurrentSection(crumb.sectionId, crumb.subsectionId) : setCurrentSection(sections[0]?.id)}
                        className="text-[var(--ff-primary)] hover:underline truncate max-w-[200px]"
                      >
                        {i === 0 ? <Home className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> : null}
                        {crumb.label}
                      </button>
                    ) : (
                      <span className="text-[var(--ff-text-secondary)] truncate max-w-[300px]">{crumb.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}

            {sections.length === 0 ? (
              // Loading state
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="w-12 h-12 border-4 border-[var(--ff-primary)]/20 border-t-[var(--ff-primary)] rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-[var(--ff-text-secondary)]">Loading help content...</p>
                </div>
              </div>
            ) : !currentSection ? (
              // No section selected
              <div className="text-center py-16">
                <h2 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-4">
                  Welcome to FibreFlow Help Center
                </h2>
                <p className="text-[var(--ff-text-secondary)] mb-6 max-w-lg mx-auto">
                  Browse the manual sections in the sidebar or use the search bar to find specific information.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto">
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="flex items-center gap-2 p-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <Menu className="w-4 h-4 text-[var(--ff-primary)]" />
                    <span className="text-sm font-medium">Browse Sections</span>
                  </button>
                  <a
                    href="/docs/user-manuals/fibreflow-complete.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary)]/90 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span className="text-sm font-medium">Download PDF</span>
                  </a>
                </div>
              </div>
            ) : (
              // Section content
              <div className="min-h-full">
                <SectionRenderer
                  content={getContentToDisplay()}
                  sectionId={currentSection.id}
                  className="pb-8"
                />
                
                {/* Section Navigation */}
                {currentSection.subsections.length > 0 && !currentSubsection && (
                  <div className="mt-8 pt-6 border-t border-[var(--ff-border-light)]">
                    <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                      In This Section
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {currentSection.subsections.map((subsection) => (
                        <button
                          key={subsection.id}
                          onClick={() => setCurrentSection(currentSection.id, subsection.id)}
                          className="p-3 text-left bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        >
                          <div className="font-medium text-[var(--ff-text-primary)] mb-1">
                            {subsection.title}
                          </div>
                          <div className="text-sm text-[var(--ff-text-tertiary)] line-clamp-2">
                            {stripMarkdown(subsection.content).substring(0, 120)}...
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prev / Next Navigation */}
                <div className="mt-10 pt-6 border-t border-[var(--ff-border-light)] flex items-stretch gap-4">
                  {prevItem ? (
                    <button
                      onClick={goBack}
                      className="flex-1 group flex items-center gap-3 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-primary)]/50 hover:bg-[var(--ff-bg-tertiary)] transition-colors text-left"
                    >
                      <ChevronLeft className="w-5 h-5 text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-primary)] flex-shrink-0 transition-colors" />
                      <div className="min-w-0">
                        <div className="text-xs text-[var(--ff-text-tertiary)] mb-0.5">Previous</div>
                        <div className="text-sm font-medium text-[var(--ff-text-primary)] truncate">{prevItem.title}</div>
                      </div>
                    </button>
                  ) : <div className="flex-1" />}
                  {nextItem ? (
                    <button
                      onClick={goNext}
                      className="flex-1 group flex items-center justify-end gap-3 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-primary)]/50 hover:bg-[var(--ff-bg-tertiary)] transition-colors text-right"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-[var(--ff-text-tertiary)] mb-0.5">Next</div>
                        <div className="text-sm font-medium text-[var(--ff-text-primary)] truncate">{nextItem.title}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-primary)] flex-shrink-0 transition-colors" />
                    </button>
                  ) : <div className="flex-1" />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};