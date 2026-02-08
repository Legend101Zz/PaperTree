import { create } from "zustand";
import type { Highlight, HighlightCategory } from "@/types/highlight";

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextSelection {
  text: string;
  pageNumber: number;
  rects: SelectionRect[];
  textStart: number;
  textEnd: number;
}

interface HighlightUIState {
  // Current text selection
  selection: TextSelection | null;
  setSelection: (selection: TextSelection | null) => void;

  // Active highlight (for popover)
  activeHighlightId: string | null;
  setActiveHighlightId: (id: string | null) => void;

  // Popover position
  popoverPosition: { x: number; y: number } | null;
  setPopoverPosition: (pos: { x: number; y: number } | null) => void;

  // Selected category for new highlight
  selectedCategory: HighlightCategory;
  setSelectedCategory: (category: HighlightCategory) => void;

  // Filter state
  filterCategory: HighlightCategory | null;
  setFilterCategory: (category: HighlightCategory | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Explanation loading state
  explanationLoading: Record<string, boolean>;
  setExplanationLoading: (highlightId: string, loading: boolean) => void;

  // Reset
  reset: () => void;
}

export const useHighlightStore = create<HighlightUIState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),

  activeHighlightId: null,
  setActiveHighlightId: (id) => set({ activeHighlightId: id }),

  popoverPosition: null,
  setPopoverPosition: (pos) => set({ popoverPosition: pos }),

  selectedCategory: "important",
  setSelectedCategory: (category) => set({ selectedCategory: category }),

  filterCategory: null,
  setFilterCategory: (category) => set({ filterCategory: category }),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),

  explanationLoading: {},
  setExplanationLoading: (highlightId, loading) =>
    set((state) => ({
      explanationLoading: {
        ...state.explanationLoading,
        [highlightId]: loading,
      },
    })),

  reset: () =>
    set({
      selection: null,
      activeHighlightId: null,
      popoverPosition: null,
      selectedCategory: "important",
      filterCategory: null,
      searchQuery: "",
      explanationLoading: {},
    }),
}));
