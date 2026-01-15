import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ReaderSettings, Highlight, Explanation } from "@/types";

interface ReaderState {
  settings: ReaderSettings;
  highlights: Highlight[];
  explanations: Explanation[];
  activeHighlightId: string | null;
  selectedText: string | null;
  selectionPosition: { x: number; y: number } | null;

  // Settings actions
  setTheme: (theme: ReaderSettings["theme"]) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setPageWidth: (width: number) => void;
  setMode: (mode: ReaderSettings["mode"]) => void;

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
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      settings: {
        theme: "light",
        fontSize: 16,
        lineHeight: 1.6,
        pageWidth: 800,
        mode: "pdf",
      },
      highlights: [],
      explanations: [],
      activeHighlightId: null,
      selectedText: null,
      selectionPosition: null,

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

      setHighlights: (highlights) => set({ highlights }),

      addHighlight: (highlight) =>
        set((state) => ({ highlights: [...state.highlights, highlight] })),

      setActiveHighlight: (activeHighlightId) => set({ activeHighlightId }),

      setSelection: (selectedText, selectionPosition) =>
        set({ selectedText, selectionPosition }),

      clearSelection: () =>
        set({ selectedText: null, selectionPosition: null }),

      setExplanations: (explanations) => set({ explanations }),

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
    }),
    {
      name: "reader-settings",
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
