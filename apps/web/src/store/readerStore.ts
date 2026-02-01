// apps/web/src/store/readerStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Highlight, Explanation } from "@/types";

export type BookViewMode = "scroll" | "flip";

export interface ReaderSettings {
  theme: "light" | "dark" | "sepia";
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  mode: "pdf" | "book";
  fontFamily: "serif" | "sans" | "mono";
  minimapWidth: number;
  invertPdf: boolean;
  invertMinimap: boolean;
  bookViewMode: BookViewMode; // NEW
}

export interface PDFRegion {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface InlineExplanationState {
  isOpen: boolean;
  highlightId: string | null;
  position: { x: number; y: number } | null;
}

interface ReaderState {
  settings: ReaderSettings;
  sidebarCollapsed: boolean;
  minimapCollapsed: boolean;
  highlights: Highlight[];
  explanations: Explanation[];
  activeHighlightId: string | null;
  selectedText: string | null;
  selectionPosition: { x: number; y: number } | null;
  currentSectionId: string | null;
  currentBlockId: string | null;
  currentPdfPage: number;
  currentPdfRegion: PDFRegion | null;
  figureViewerOpen: boolean;
  figureViewerPage: number;
  figureViewerNote: string;
  inlineExplanation: InlineExplanationState;
  generatingPages: Set<number>;
  visiblePage: number;
  currentBookPage: number; // NEW: for flip mode
}

interface ReaderActions {
  setTheme: (theme: ReaderSettings["theme"]) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setPageWidth: (width: number) => void;
  setMode: (mode: ReaderSettings["mode"]) => void;
  setFontFamily: (family: ReaderSettings["fontFamily"]) => void;
  setMinimapWidth: (width: number) => void;
  setInvertPdf: (invert: boolean) => void;
  setInvertMinimap: (invert: boolean) => void;
  setBookViewMode: (mode: BookViewMode) => void; // NEW
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMinimapCollapsed: (collapsed: boolean) => void;
  setHighlights: (highlights: Highlight[]) => void;
  addHighlight: (highlight: Highlight) => void;
  setActiveHighlight: (id: string | null) => void;
  setSelection: (
    text: string | null,
    position: { x: number; y: number } | null,
  ) => void;
  clearSelection: () => void;
  setExplanations: (explanations: Explanation[]) => void;
  addExplanation: (explanation: Explanation) => void;
  updateExplanation: (id: string, updates: Partial<Explanation>) => void;
  setCurrentSection: (
    sectionId: string | null,
    pdfPage: number,
    region?: PDFRegion,
  ) => void;
  setCurrentPdfPage: (page: number) => void;
  setVisiblePage: (page: number) => void;
  setCurrentBookPage: (page: number) => void; // NEW
  openFigureViewer: (page: number) => void;
  closeFigureViewer: () => void;
  setFigureNote: (note: string) => void;
  openInlineExplanation: (
    highlightId: string,
    position: { x: number; y: number },
  ) => void;
  closeInlineExplanation: () => void;
  setGeneratingPages: (pages: number[]) => void;
  addGeneratingPage: (page: number) => void;
  removeGeneratingPage: (page: number) => void;
  resetReaderState: () => void;
}

const initialSettings: ReaderSettings = {
  theme: "light",
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  mode: "book",
  fontFamily: "serif",
  minimapWidth: 300,
  invertPdf: false,
  invertMinimap: false,
  bookViewMode: "scroll", // Default to scroll
};

const initialSessionState = {
  highlights: [] as Highlight[],
  explanations: [] as Explanation[],
  activeHighlightId: null as string | null,
  selectedText: null as string | null,
  selectionPosition: null as { x: number; y: number } | null,
  currentSectionId: null as string | null,
  currentBlockId: null as string | null,
  currentPdfPage: 0,
  currentPdfRegion: null as PDFRegion | null,
  figureViewerOpen: false,
  figureViewerPage: 0,
  figureViewerNote: "",
  inlineExplanation: {
    isOpen: false,
    highlightId: null,
    position: null,
  } as InlineExplanationState,
  generatingPages: new Set<number>(),
  visiblePage: 0,
  currentBookPage: 0,
};

const initialState: ReaderState = {
  settings: initialSettings,
  sidebarCollapsed: false,
  minimapCollapsed: false,
  ...initialSessionState,
};

export const useReaderStore = create<ReaderState & ReaderActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Settings
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setFontSize: (fontSize) =>
        set((s) => ({ settings: { ...s.settings, fontSize } })),
      setLineHeight: (lineHeight) =>
        set((s) => ({ settings: { ...s.settings, lineHeight } })),
      setPageWidth: (pageWidth) =>
        set((s) => ({ settings: { ...s.settings, pageWidth } })),
      setMode: (mode) => set((s) => ({ settings: { ...s.settings, mode } })),
      setFontFamily: (fontFamily) =>
        set((s) => ({ settings: { ...s.settings, fontFamily } })),
      setMinimapWidth: (minimapWidth) =>
        set((s) => ({ settings: { ...s.settings, minimapWidth } })),
      setInvertPdf: (invertPdf) =>
        set((s) => ({ settings: { ...s.settings, invertPdf } })),
      setInvertMinimap: (invertMinimap) =>
        set((s) => ({ settings: { ...s.settings, invertMinimap } })),
      setBookViewMode: (bookViewMode) =>
        set((s) => ({ settings: { ...s.settings, bookViewMode } })),

      // Layout
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMinimapCollapsed: (minimapCollapsed) => set({ minimapCollapsed }),

      // Highlights
      setHighlights: (highlights) => set({ highlights }),
      addHighlight: (highlight) =>
        set((s) => ({ highlights: [...s.highlights, highlight] })),
      setActiveHighlight: (activeHighlightId) => set({ activeHighlightId }),

      // Selection
      setSelection: (selectedText, selectionPosition) =>
        set({ selectedText, selectionPosition }),
      clearSelection: () =>
        set({ selectedText: null, selectionPosition: null }),

      // Explanations
      setExplanations: (explanations) => set({ explanations }),
      addExplanation: (explanation) =>
        set((s) => ({ explanations: [...s.explanations, explanation] })),
      updateExplanation: (id, updates) =>
        set((s) => ({
          explanations: s.explanations.map((e) =>
            e.id === id ? { ...e, ...updates } : e,
          ),
        })),

      // Navigation
      setCurrentSection: (sectionId, pdfPage, region) => {
        const currentState = get();
        if (
          currentState.currentSectionId !== sectionId ||
          currentState.currentPdfPage !== pdfPage
        ) {
          set({
            currentSectionId: sectionId,
            currentPdfPage: pdfPage,
            currentPdfRegion: region || null,
            visiblePage: pdfPage,
          });
        }
      },
      setCurrentPdfPage: (page) =>
        set({ currentPdfPage: page, visiblePage: page }),
      setVisiblePage: (page) =>
        set({ visiblePage: page, currentPdfPage: page }),
      setCurrentBookPage: (page) =>
        set({ currentBookPage: page, visiblePage: page, currentPdfPage: page }),

      // Figure viewer
      openFigureViewer: (page) =>
        set({
          figureViewerOpen: true,
          figureViewerPage: page,
          figureViewerNote: "",
        }),
      closeFigureViewer: () => set({ figureViewerOpen: false }),
      setFigureNote: (note) => set({ figureViewerNote: note }),

      // Inline explanation
      openInlineExplanation: (highlightId, position) => {
        set({
          inlineExplanation: { isOpen: true, highlightId, position },
          activeHighlightId: highlightId,
        });
      },
      closeInlineExplanation: () => {
        set({
          inlineExplanation: {
            isOpen: false,
            highlightId: null,
            position: null,
          },
          activeHighlightId: null,
        });
      },

      // Page generation
      setGeneratingPages: (pages) => set({ generatingPages: new Set(pages) }),
      addGeneratingPage: (page) =>
        set((s) => {
          const newSet = new Set(s.generatingPages);
          newSet.add(page);
          return { generatingPages: newSet };
        }),
      removeGeneratingPage: (page) =>
        set((s) => {
          const newSet = new Set(s.generatingPages);
          newSet.delete(page);
          return { generatingPages: newSet };
        }),

      // Reset
      resetReaderState: () =>
        set({ ...initialSessionState, generatingPages: new Set() }),
    }),
    {
      name: "reader-settings-v9",
      partialize: (state) => ({
        settings: state.settings,
        sidebarCollapsed: state.sidebarCollapsed,
        minimapCollapsed: state.minimapCollapsed,
      }),
    },
  ),
);
