/**
 * Table of Contents Component
 * 
 * Sidebar navigation for the help center with collapsible subsections
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManualSection } from '../data/manual-content';

interface TableOfContentsProps {
  sections: ManualSection[];
  currentSectionId?: string;
  currentSubsectionId?: string;
  onSectionClick: (sectionId: string, subsectionId?: string) => void;
  className?: string;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({
  sections,
  currentSectionId,
  currentSubsectionId,
  onSectionClick,
  className
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set([currentSectionId])
  );

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const handleSectionClick = (section: ManualSection) => {
    if (section.subsections.length > 0) {
      // If section has subsections, toggle expansion
      toggleSection(section.id);
      
      // If section is not expanded, also navigate to it
      if (!expandedSections.has(section.id)) {
        onSectionClick(section.id);
      }
    } else {
      // If no subsections, navigate directly
      onSectionClick(section.id);
    }
  };

  const handleSubsectionClick = (sectionId: string, subsectionId: string) => {
    onSectionClick(sectionId, subsectionId);
  };

  if (sections.length === 0) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex items-center gap-2 text-[var(--ff-text-tertiary)]">
          <BookOpen className="w-4 h-4" />
          <span className="text-sm">Loading manual...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('h-full overflow-y-auto', className)}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-[var(--ff-primary)]" />
          <h2 className="font-semibold text-[var(--ff-text-primary)]">User Manual</h2>
        </div>
        
        <nav className="space-y-1">
          {sections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const isCurrentSection = section.id === currentSectionId;
            const hasSubsections = section.subsections.length > 0;

            return (
              <div key={section.id}>
                {/* Main Section */}
                <button
                  onClick={() => handleSectionClick(section)}
                  className={cn(
                    'w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors group',
                    isCurrentSection && !currentSubsectionId
                      ? 'bg-[var(--ff-primary)]/20 text-[var(--ff-primary)]'
                      : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)]'
                  )}
                >
                  {hasSubsections ? (
                    isExpanded ? (
                      <ChevronDown className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 flex-shrink-0" />
                    )
                  ) : (
                    <FileText className="w-4 h-4 flex-shrink-0" />
                  )}
                  
                  <span className="text-sm font-medium truncate">
                    {section.title}
                  </span>
                  
                  {hasSubsections && (
                    <span className="ml-auto text-xs text-[var(--ff-text-tertiary)] bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded-full">
                      {section.subsections.length}
                    </span>
                  )}
                </button>

                {/* Subsections */}
                {hasSubsections && isExpanded && (
                  <div className="ml-6 mt-1 space-y-1 border-l border-[var(--ff-border-light)] pl-3">
                    {section.subsections.map((subsection) => {
                      const isCurrentSubsection = 
                        section.id === currentSectionId && 
                        subsection.id === currentSubsectionId;

                      return (
                        <button
                          key={subsection.id}
                          onClick={() => handleSubsectionClick(section.id, subsection.id)}
                          className={cn(
                            'w-full flex items-start gap-2 p-2 rounded-md text-left transition-colors',
                            isCurrentSubsection
                              ? 'bg-[var(--ff-primary)]/10 text-[var(--ff-primary)]'
                              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
                          )}
                        >
                          <div className="w-2 h-2 rounded-full bg-current mt-1.5 flex-shrink-0 opacity-60" />
                          <span className="text-sm leading-relaxed">
                            {subsection.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        
        {/* PDF Download */}
        <div className="mt-6 pt-4 border-t border-[var(--ff-border-light)]">
          <a
            href="/docs/user-manuals/fibreflow-complete.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span>Download PDF</span>
          </a>
        </div>
      </div>
    </div>
  );
};