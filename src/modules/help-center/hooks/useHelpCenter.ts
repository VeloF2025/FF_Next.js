/**
 * Help Center Hook
 * 
 * Manages help center state, search, and content navigation
 */

import { useState, useEffect, useMemo } from 'react';
import { parseManualSections, searchManual, type ManualSection, type SearchResult } from '../data/manual-content';

export interface NavItem {
  sectionId: string;
  subsectionId?: string;
  title: string;
}

export interface UseHelpCenterReturn {
  sections: ManualSection[];
  currentSection: ManualSection | null;
  currentSubsection: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  prevItem: NavItem | null;
  nextItem: NavItem | null;
  breadcrumbs: { label: string; sectionId?: string; subsectionId?: string }[];
  setCurrentSection: (sectionId: string, subsectionId?: string) => void;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  goBack: () => void;
  goNext: () => void;
}

export function useHelpCenter(): UseHelpCenterReturn {
  const [sections, setSections] = useState<ManualSection[]>([]);
  const [currentSectionId, setCurrentSectionId] = useState<string>('getting-started');
  const [currentSubsectionId, setCurrentSubsectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Load and parse manual sections on mount
  useEffect(() => {
    try {
      const parsedSections = parseManualSections();
      setSections(parsedSections);
      
      // Set initial section if available
      if (parsedSections.length > 0 && !parsedSections.find(s => s.id === currentSectionId)) {
        setCurrentSectionId(parsedSections[0].id);
      }
    } catch (error) {
      // Silently fail and show empty sections — manual content optional for app function
      setSections([]);
    }
  }, [currentSectionId]);

  // Get current section object
  const currentSection = useMemo(() => {
    return sections.find(s => s.id === currentSectionId) || null;
  }, [sections, currentSectionId]);

  // Perform search with debouncing
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    setIsSearching(true);
    const results = searchManual(searchQuery, sections);
    setIsSearching(false);
    
    return results;
  }, [searchQuery, sections]);

  // Set current section and optional subsection
  const setCurrentSection = (sectionId: string, subsectionId?: string) => {
    setCurrentSectionId(sectionId);
    setCurrentSubsectionId(subsectionId || null);
    
    // Clear search when navigating
    if (searchQuery) {
      setSearchQuery('');
    }
  };

  // Clear search and return to previous section
  const clearSearch = () => {
    setSearchQuery('');
  };

  // Build flat navigation list (section overviews + subsections)
  const flatNav = useMemo((): NavItem[] => {
    const items: NavItem[] = [];
    for (const section of sections) {
      items.push({ sectionId: section.id, title: section.title });
      for (const sub of section.subsections) {
        items.push({ sectionId: section.id, subsectionId: sub.id, title: sub.title });
      }
    }
    return items;
  }, [sections]);

  // Current position in flat nav
  const currentNavIndex = useMemo(() => {
    return flatNav.findIndex(item =>
      item.sectionId === currentSectionId &&
      (item.subsectionId || null) === (currentSubsectionId || null)
    );
  }, [flatNav, currentSectionId, currentSubsectionId]);

  const prevItem = currentNavIndex > 0 ? flatNav[currentNavIndex - 1] : null;
  const nextItem = currentNavIndex >= 0 && currentNavIndex < flatNav.length - 1 ? flatNav[currentNavIndex + 1] : null;

  const goBack = () => {
    if (prevItem) setCurrentSection(prevItem.sectionId, prevItem.subsectionId);
  };

  const goNext = () => {
    if (nextItem) setCurrentSection(nextItem.sectionId, nextItem.subsectionId);
  };

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; sectionId?: string; subsectionId?: string }[] = [
      { label: 'Help Center' }
    ];
    if (currentSection) {
      crumbs.push({ label: currentSection.title, sectionId: currentSection.id });
      if (currentSubsectionId) {
        const sub = currentSection.subsections.find(s => s.id === currentSubsectionId);
        if (sub) {
          crumbs.push({ label: sub.title, sectionId: currentSection.id, subsectionId: sub.id });
        }
      }
    }
    return crumbs;
  }, [currentSection, currentSubsectionId]);

  return {
    sections,
    currentSection,
    currentSubsection: currentSubsectionId,
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
  };
}