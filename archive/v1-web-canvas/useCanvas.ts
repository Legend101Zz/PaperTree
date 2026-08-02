import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { canvasApi } from "@/lib/api";
import type {
  Canvas,
  CanvasNode,
  CreateNodeInput,
  UpdateNodeInput,
  AIQueryInput,
  BranchInput,
} from "@/types/canvas";
import { useCanvasStore } from "@/store/canvasStore";

export function useBookCanvases(bookId: string) {
  return useQuery({
    queryKey: ["canvases", bookId],
    queryFn: () => canvasApi.getBookCanvases(bookId),
  });
}

export function useCanvas(canvasId: string) {
  return useQuery({
    queryKey: ["canvas", canvasId],
    queryFn: () => canvasApi.getCanvas(canvasId),
    enabled: !!canvasId,
  });
}

export function useCanvasNodes(canvasId: string) {
  return useQuery({
    queryKey: ["canvas-nodes", canvasId],
    queryFn: () => canvasApi.getCanvasNodes(canvasId),
    enabled: !!canvasId,
    refetchInterval: 5000, // Poll for updates
  });
}

export function useCreateCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookId, title }: { bookId: string; title?: string }) =>
      canvasApi.createCanvas(bookId, title),
    onSuccess: (canvas) => {
      queryClient.invalidateQueries({ queryKey: ["canvases", canvas.book_id] });
    },
  });
}

export function useCreateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateNodeInput) => canvasApi.createNode(input),
    onSuccess: (node) => {
      queryClient.invalidateQueries({
        queryKey: ["canvas-nodes", node.canvas_id],
      });
    },
  });
}

export function useUpdateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      nodeId,
      input,
    }: {
      nodeId: string;
      input: UpdateNodeInput;
    }) => canvasApi.updateNode(nodeId, input),
    onMutate: async ({ nodeId, input }) => {
      // Optimistic update for position changes
      if (input.position) {
        await queryClient.cancelQueries({ queryKey: ["canvas-nodes"] });
        queryClient.setQueriesData<CanvasNode[]>(
          { queryKey: ["canvas-nodes"] },
          (old) =>
            old?.map((n) =>
              n.id === nodeId ? { ...n, position: input.position! } : n,
            ),
        );
      }
    },
  });
}

export function useDeleteNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: canvasApi.deleteNode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas-nodes"] });
    },
  });
}

export function useRunAIQuery() {
  const queryClient = useQueryClient();
  const { setAIQueryInProgress } = useCanvasStore();

  return useMutation({
    mutationFn: (input: AIQueryInput) => {
      setAIQueryInProgress(input.node_id, true);
      return canvasApi.runAIQuery(input);
    },
    onSuccess: (node) => {
      queryClient.invalidateQueries({
        queryKey: ["canvas-nodes", node.canvas_id],
      });
      setAIQueryInProgress(node.id, false);
    },
    onError: (_, variables) => {
      setAIQueryInProgress(variables.node_id, false);
    },
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  const { setAIQueryInProgress } = useCanvasStore();

  return useMutation({
    mutationFn: ({ nodeId, input }: { nodeId: string; input: BranchInput }) => {
      setAIQueryInProgress(nodeId, true);
      return canvasApi.createBranch(nodeId, input);
    },
    onSuccess: (node) => {
      queryClient.invalidateQueries({
        queryKey: ["canvas-nodes", node.canvas_id],
      });
      setAIQueryInProgress(node.parent_node_id || "", false);
    },
    onError: (_, variables) => {
      setAIQueryInProgress(variables.nodeId, false);
    },
  });
}

export function useCreateFromHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (highlightId: string) =>
      canvasApi.createFromHighlight(highlightId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["canvases"] });
      queryClient.invalidateQueries({
        queryKey: ["canvas-nodes", result.canvas_id],
      });
    },
  });
}

export function useAutoSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (canvasId: string) => canvasApi.generateAutoSummary(canvasId),
    onSuccess: (node) => {
      queryClient.invalidateQueries({
        queryKey: ["canvas-nodes", node.canvas_id],
      });
    },
  });
}
