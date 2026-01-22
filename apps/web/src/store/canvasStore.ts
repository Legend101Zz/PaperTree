// apps/web/src/store/canvasStore.ts
import { create } from "zustand";
import {
  CanvasNode,
  CanvasEdge,
  CanvasNodeData,
  CanvasNodePosition,
  CanvasNodeType,
} from "@/types";

interface CanvasState {
  // Data
  nodes: CanvasNode[];
  edges: CanvasEdge[];

  // Selection
  selectedNodeId: string | null;
  hoveredNodeId: string | null;

  // UI State
  isLoading: boolean;
  isDirty: boolean;
  lastSaved: Date | null;

  // Viewport
  zoom: number;
  panX: number;
  panY: number;

  // Actions
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition: (id: string, position: CanvasNodePosition) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (id: string) => void;

  // Selection
  selectNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;

  // Toggle collapse
  toggleNodeCollapse: (id: string) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;

  // State management
  setLoading: (loading: boolean) => void;
  markDirty: () => void;
  markSaved: () => void;

  // Reset
  resetCanvas: () => void;
}

const initialState = {
  nodes: [] as CanvasNode[],
  edges: [] as CanvasEdge[],
  selectedNodeId: null as string | null,
  hoveredNodeId: null as string | null,
  isLoading: false,
  isDirty: false,
  lastSaved: null as Date | null,
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ...initialState,

  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
      isDirty: true,
    })),

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...updates } : node,
      ),
      isDirty: true,
    })),

  updateNodeData: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...data,
                updated_at: new Date().toISOString(),
              },
            }
          : node,
      ),
      isDirty: true,
    })),

  updateNodePosition: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, position } : node,
      ),
      isDirty: true,
    })),

  removeNode: (id) =>
    set((state) => {
      // Also remove children and edges
      const idsToRemove = new Set<string>([id]);

      const collectChildren = (nodeId: string) => {
        for (const node of state.nodes) {
          if (node.parent_id === nodeId) {
            idsToRemove.add(node.id);
            collectChildren(node.id);
          }
        }
      };
      collectChildren(id);

      return {
        nodes: state.nodes.filter((node) => !idsToRemove.has(node.id)),
        edges: state.edges.filter(
          (edge) =>
            !idsToRemove.has(edge.source) && !idsToRemove.has(edge.target),
        ),
        isDirty: true,
        selectedNodeId:
          state.selectedNodeId && idsToRemove.has(state.selectedNodeId)
            ? null
            : state.selectedNodeId,
      };
    }),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, edge],
      isDirty: true,
    })),

  removeEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== id),
      isDirty: true,
    })),

  selectNode: (id) => set({ selectedNodeId: id }),
  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  toggleNodeCollapse: (id) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, is_collapsed: !node.data.is_collapsed },
            }
          : node,
      ),
      isDirty: true,
    })),

  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(2, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),

  setLoading: (isLoading) => set({ isLoading }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, lastSaved: new Date() }),

  resetCanvas: () => set(initialState),
}));
