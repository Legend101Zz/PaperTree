import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ReaderSettings, Highlight, Explanation } from "@/types";

export type FontFamily = "serif" | "sans" | "mono";

export interface ExtendedReaderSettings extends ReaderSettings {
  fontFamily: FontFamily;
  marginSize: "compact" | "normal" | "wide";
  invertPdf: boolean;
}

interface ReaderState {
  settings: ExtendedReaderSettings;
  highlights: Highlight[];
  explanations: Explanation[];
  activeHighlightId: string | null;
  selectedText: string | null;
  selectionPosition: { x: number; y: number } | null;
}

interface ReaderActions {
  // Settings actions
  setTheme: (theme: ExtendedReaderSettings["theme"]) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setPageWidth: (width: number) => void;
  setMode: (mode: ExtendedReaderSettings["mode"]) => void;
  setFontFamily: (family: FontFamily) => void;
  setMarginSize: (margin: "compact" | "normal" | "wide") => void;
  setInvertPdf: (invert: boolean) => void;

  // Highlight actions
  setHighlights: (highlights: Highlight[]) => void;
  addHighlight: (highlight: Highlight) => void;
  setActiveHighlight: (id: string | null) => void;

  // Selection actions
  setSelection: (
    text: string | null,
    position: { x: number; y: number } | null
  ) => void;
  clearSelection: () => void;

  // Explanation actions
  setExplanations: (explanations: Explanation[]) => void;
  addExplanation: (explanation: Explanation) => void;
  updateExplanation: (id: string, updates: Partial<Explanation>) => void;

  // Reset
  resetReaderState: () => void;
}

const initialState: ReaderState = {
  settings: {
    theme: "light",
    fontSize: 18,
    lineHeight: 1.8,
    pageWidth: 720,
    mode: "pdf",
    fontFamily: "serif",
    marginSize: "normal",
    invertPdf: false,
  },
  highlights: [],
  explanations: [],
  activeHighlightId: null,
  selectedText: null,
  selectionPosition: null,
};

export const useReaderStore = create<ReaderState & ReaderActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setTheme: (theme) =>
        set((state) => ({ settings: { ...state.settings, theme } })),

      setFontSize: (fontSize) =>
        set((state) => ({ settings: { ...state.settings, fontSize } })),

      setLineHeight: (lineHeight) =>
        set((state) => ({ settings: { ...state.settings, lineHeight } })),

      setPageWidth: (pageWidth) =>
        set((state) => ({ settings: { ...state.settings, pageWidth } })),

      setMode: (mode) =>
        set((state) => ({ settings: { ...state.settings, mode } })),

      setFontFamily: (fontFamily) =>
        set((state) => ({ settings: { ...state.settings, fontFamily } })),

      setMarginSize: (marginSize) =>
        set((state) => ({ settings: { ...state.settings, marginSize } })),

      setInvertPdf: (invertPdf) =>
        set((state) => ({ settings: { ...state.settings, invertPdf } })),

      setHighlights: (highlights) => {
        const current = get().highlights;
        if (JSON.stringify(current) !== JSON.stringify(highlights)) {
          set({ highlights });
        }
      },

      addHighlight: (highlight) =>
        set((state) => ({ highlights: [...state.highlights, highlight] })),

      setActiveHighlight: (activeHighlightId) => set({ activeHighlightId }),

      setSelection: (selectedText, selectionPosition) =>
        set({ selectedText, selectionPosition }),

      clearSelection: () =>
        set({ selectedText: null, selectionPosition: null }),

      setExplanations: (explanations) => {
        const current = get().explanations;
        if (JSON.stringify(current) !== JSON.stringify(explanations)) {
          set({ explanations });
        }
      },

      addExplanation: (explanation) =>
        set((state) => ({
          explanations: [...state.explanations, explanation],
        })),

      updateExplanation: (id, updates) =>
        set((state) => ({
          explanations: state.explanations.map((exp) =>
            exp.id === id ? { ...exp, ...updates } : exp
          ),
        })),

      resetReaderState: () =>
        set({
          highlights: [],
          explanations: [],
          activeHighlightId: null,
          selectedText: null,
          selectionPosition: null,
        }),
    }),
    {
      name: "reader-settings",
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
