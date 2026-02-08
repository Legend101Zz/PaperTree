import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { canvasHighlightsApi as highlightsApi } from "@/lib/api";
import type {
  Highlight,
  CreateHighlightInput,
  UpdateHighlightInput,
  ExplanationMode,
} from "@/types/highlight";
import { useHighlightStore } from "@/store/highlightStore";

export function useBookHighlights(bookId: string, page?: number) {
  return useQuery({
    queryKey: ["highlights", bookId, page],
    queryFn: () => highlightsApi.getBookHighlights(bookId, page),
    staleTime: 30000,
  });
}

export function useHighlight(highlightId: string) {
  return useQuery({
    queryKey: ["highlight", highlightId],
    queryFn: () => highlightsApi.getHighlight(highlightId),
    enabled: !!highlightId,
  });
}

export function useCreateHighlight() {
  const queryClient = useQueryClient();
  const { setSelection, setPopoverPosition } = useHighlightStore();

  return useMutation({
    mutationFn: (input: CreateHighlightInput) =>
      highlightsApi.createHighlight(input),
    onSuccess: (highlight) => {
      queryClient.invalidateQueries({
        queryKey: ["highlights", highlight.book_id],
      });
      setSelection(null);
      setPopoverPosition(null);
    },
  });
}

export function useUpdateHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      highlightId,
      input,
    }: {
      highlightId: string;
      input: UpdateHighlightInput;
    }) => highlightsApi.updateHighlight(highlightId, input),
    onSuccess: (highlight) => {
      queryClient.invalidateQueries({
        queryKey: ["highlights", highlight.book_id],
      });
      queryClient.invalidateQueries({ queryKey: ["highlight", highlight.id] });
    },
  });
}

export function useDeleteHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: highlightsApi.deleteHighlight,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["highlights"] });
    },
  });
}

export function useExplainHighlight() {
  const queryClient = useQueryClient();
  const { setExplanationLoading } = useHighlightStore();

  return useMutation({
    mutationFn: ({
      highlightId,
      mode,
      customPrompt,
    }: {
      highlightId: string;
      mode: ExplanationMode;
      customPrompt?: string;
    }) => {
      setExplanationLoading(highlightId, true);
      return highlightsApi.explainHighlight(highlightId, mode, customPrompt);
    },
    onSuccess: (explanation) => {
      queryClient.invalidateQueries({
        queryKey: ["highlight-explanations", explanation.highlight_id],
      });
      setExplanationLoading(explanation.highlight_id, false);
    },
    onError: (_, variables) => {
      setExplanationLoading(variables.highlightId, false);
    },
  });
}

export function useHighlightExplanations(highlightId: string) {
  return useQuery({
    queryKey: ["highlight-explanations", highlightId],
    queryFn: () => highlightsApi.getExplanations(highlightId),
    enabled: !!highlightId,
  });
}

export function useSearchHighlights() {
  return useMutation({
    mutationFn: highlightsApi.searchHighlights,
  });
}

export function useExportHighlights() {
  return useMutation({
    mutationFn: ({
      bookId,
      format,
    }: {
      bookId: string;
      format: "json" | "markdown" | "csv";
    }) => highlightsApi.exportHighlights(bookId, format),
  });
}
