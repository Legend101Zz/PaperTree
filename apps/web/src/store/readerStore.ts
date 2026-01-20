// apps/web/src/store/readerStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Highlight, Explanation } from "@/types";

export interface ReaderSettings {
  theme: "light" | "dark" | "sepia";
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  mode: "pdf" | "book";
  fontFamily: "serif" | "sans" | "mono";
  minimapSize: "small" | "medium" | "large" | "hidden";
  invertPdf: boolean;
  invertMinimap: boolean;
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
  highlights: Highlight[];
  explanations: Explanation[];
  activeHighlightId: string | null;
  selectedText: string | null;
  selectionPosition: { x: number; y: number } | null;
  currentSectionId: string | null;
  currentPdfPage: number;
  currentPdfRegion: PDFRegion | null;
  figureViewerOpen: boolean;
  figureViewerPage: number;
  figureViewerNote: string;
  inlineExplanation: InlineExplanationState;
  minimapWasVisible: boolean;
}

interface ReaderActions {
  setTheme: (theme: ReaderSettings["theme"]) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setPageWidth: (width: number) => void;
  setMode: (mode: ReaderSettings["mode"]) => void;
  setFontFamily: (family: ReaderSettings["fontFamily"]) => void;
  setMinimapSize: (size: ReaderSettings["minimapSize"]) => void;
  setInvertPdf: (invert: boolean) => void;
  setInvertMinimap: (invert: boolean) => void;

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

  openFigureViewer: (page: number) => void;
  closeFigureViewer: () => void;
  setFigureNote: (note: string) => void;

  openInlineExplanation: (
    highlightId: string,
    position: { x: number; y: number },
  ) => void;
  closeInlineExplanation: () => void;

  resetReaderState: () => void;
}

const initialSettings: ReaderSettings = {
  theme: "light",
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  mode: "book",
  fontFamily: "serif",
  minimapSize: "medium",
  invertPdf: false,
  invertMinimap: false,
};

const initialState: ReaderState = {
  settings: initialSettings,
  highlights: [],
  explanations: [],
  activeHighlightId: null,
  selectedText: null,
  selectionPosition: null,
  currentSectionId: null,
  currentPdfPage: 0,
  currentPdfRegion: null,
  figureViewerOpen: false,
  figureViewerPage: 0,
  figureViewerNote: "",
  inlineExplanation: {
    isOpen: false,
    highlightId: null,
    position: null,
  },
  minimapWasVisible: true,
};

export const useReaderStore = create<ReaderState & ReaderActions>()(
  persist(
    (set, get) => ({
      ...initialState,

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
      setMinimapSize: (minimapSize) =>
        set((s) => ({ settings: { ...s.settings, minimapSize } })),
      setInvertPdf: (invertPdf) =>
        set((s) => ({ settings: { ...s.settings, invertPdf } })),
      setInvertMinimap: (invertMinimap) =>
        set((s) => ({ settings: { ...s.settings, invertMinimap } })),

      setHighlights: (highlights) => set({ highlights }),
      addHighlight: (highlight) =>
        set((s) => ({ highlights: [...s.highlights, highlight] })),
      setActiveHighlight: (activeHighlightId) => set({ activeHighlightId }),

      setSelection: (selectedText, selectionPosition) =>
        set({ selectedText, selectionPosition }),
      clearSelection: () =>
        set({ selectedText: null, selectionPosition: null }),

      setExplanations: (explanations) => set({ explanations }),
      addExplanation: (explanation) =>
        set((s) => ({ explanations: [...s.explanations, explanation] })),
      updateExplanation: (id, updates) =>
        set((s) => ({
          explanations: s.explanations.map((e) =>
            e.id === id ? { ...e, ...updates } : e,
          ),
        })),

      // FIXED: Always update PDF page when section changes
      setCurrentSection: (sectionId, pdfPage, region) => {
        const currentState = get();
        // Only update if something actually changed
        if (
          currentState.currentSectionId !== sectionId ||
          currentState.currentPdfPage !== pdfPage
        ) {
          console.log("Store: setCurrentSection", { sectionId, pdfPage });
          set({
            currentSectionId: sectionId,
            currentPdfPage: pdfPage,
            currentPdfRegion: region || null,
          });
        }
      },

      setCurrentPdfPage: (page) => {
        console.log("Store: setCurrentPdfPage", page);
        set({ currentPdfPage: page });
      },

      openFigureViewer: (page) =>
        set({
          figureViewerOpen: true,
          figureViewerPage: page,
          figureViewerNote: "",
        }),
      closeFigureViewer: () => set({ figureViewerOpen: false }),
      setFigureNote: (note) => set({ figureViewerNote: note }),

      openInlineExplanation: (highlightId, position) => {
        const state = get();
        const wasVisible = state.settings.minimapSize !== "hidden";
        console.log("Store: openInlineExplanation", { highlightId, position });
        set({
          inlineExplanation: {
            isOpen: true,
            highlightId,
            position,
          },
          activeHighlightId: highlightId,
          minimapWasVisible: wasVisible,
          settings: {
            ...state.settings,
            minimapSize: "hidden",
          },
        });
      },

      closeInlineExplanation: () => {
        const state = get();
        console.log("Store: closeInlineExplanation");
        set({
          inlineExplanation: {
            isOpen: false,
            highlightId: null,
            position: null,
          },
          activeHighlightId: null,
          settings: {
            ...state.settings,
            minimapSize: state.minimapWasVisible ? "medium" : "hidden",
          },
        });
      },

      resetReaderState: () =>
        set({
          highlights: [],
          explanations: [],
          activeHighlightId: null,
          selectedText: null,
          selectionPosition: null,
          currentSectionId: null,
          currentPdfPage: 0,
          currentPdfRegion: null,
          figureViewerOpen: false,
          figureViewerPage: 0,
          figureViewerNote: "",
          inlineExplanation: {
            isOpen: false,
            highlightId: null,
            position: null,
          },
          minimapWasVisible: true,
        }),
    }),
    {
      name: "reader-settings-v5",
      partialize: (state) => ({ settings: state.settings }),
    },
  ),
);
