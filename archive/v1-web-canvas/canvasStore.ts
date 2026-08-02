// apps/web/src/store/canvasStore.ts
import { create } from "zustand";
import type {
  CanvasNode,
  CanvasEdge,
  CanvasNodeData,
  CanvasNodePosition,
} from "@/types/canvas";

interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  isLoading: boolean;
  isDirty: boolean;
  lastSaved: Date | null;

  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition: (id: string, position: CanvasNodePosition) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  toggleNodeCollapse: (id: string) => void;
  setLoading: (loading: boolean) => void;
  markDirty: () => void;
  markSaved: () => void;
  resetCanvas: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isLoading: false,
  isDirty: false,
  lastSaved: null,

  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),

  addNode: (node) =>
    set((s) => {
      // Avoid duplicates
      if (s.nodes.some((n) => n.id === node.id)) return s;
      return { nodes: [...s.nodes, node], isDirty: true };
    }),

  updateNode: (id, updates) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      isDirty: true,
    })),

  updateNodeData: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                ...data,
                updated_at: new Date().toISOString(),
              },
            }
          : n,
      ),
      isDirty: true,
    })),

  updateNodePosition: (id, position) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
      isDirty: true,
    })),

  removeNode: (id) =>
    set((s) => {
      // Recursive: remove node + all descendants
      const toDelete = new Set<string>();
      const collect = (nid: string) => {
        toDelete.add(nid);
        s.nodes
          .filter((n) => n.parent_id === nid)
          .forEach((n) => collect(n.id));
      };
      collect(id);

      return {
        nodes: s.nodes.filter((n) => !toDelete.has(n.id)),
        edges: s.edges.filter(
          (e) => !toDelete.has(e.source) && !toDelete.has(e.target),
        ),
        isDirty: true,
      };
    }),
  addEdge: (edge) =>
    set((s) => {
      if (s.edges.some((e) => e.id === edge.id)) return s;
      return { edges: [...s.edges, edge], isDirty: true };
    }),
  removeEdge: (id) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      isDirty: true,
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleNodeCollapse: (id) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, is_collapsed: !n.data.is_collapsed } }
          : n,
      ),
      isDirty: true,
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, lastSaved: new Date() }),
  resetCanvas: () =>
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isLoading: false,
      isDirty: false,
      lastSaved: null,
    }),
}));
