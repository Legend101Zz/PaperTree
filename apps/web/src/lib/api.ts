// apps/web/src/lib/api.ts
import axios from "axios";
import {
  Highlight,
  HighlightCategory,
  CanvasNode,
  CanvasEdge,
  AskMode,
  CanvasNodeType,
  CanvasNodePosition,
  CanvasNodeData,
  CanvasElements,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }

  return res.json();
}

const getToken = () =>
  typeof window !== "undefined" ? localStorage.getItem("token") : "";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

// Auth
export const authApi = {
  register: async (email: string, password: string) =>
    (await api.post("/auth/register", { email, password })).data,
  login: async (email: string, password: string) =>
    (await api.post("/auth/login", { email, password })).data,
  getMe: async () => (await api.get("/auth/me")).data,
};

// Papers
export const papersApi = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return (
      await api.post("/papers/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    ).data;
  },
  list: async () => (await api.get("/papers")).data,
  get: async (paperId: string) => (await api.get(`/papers/${paperId}`)).data,
  delete: async (paperId: string) =>
    (await api.delete(`/papers/${paperId}`)).data,

  getFileUrl: (paperId: string) =>
    `${API_URL}/papers/${paperId}/file?token=${getToken()}`,

  getPageImageUrl: (
    paperId: string,
    page: number,
    region?: { x0: number; y0: number; x1: number; y1: number },
    scale = 2,
  ) => {
    const params = new URLSearchParams({
      token: getToken() || "",
      scale: String(scale),
    });
    if (region) {
      params.set("x0", String(region.x0));
      params.set("y0", String(region.y0));
      params.set("x1", String(region.x1));
      params.set("y1", String(region.y1));
    }
    return `${API_URL}/papers/${paperId}/page/${page}/image?${params}`;
  },

  generateBook: async (paperId: string, force = false, generateAll = false) =>
    (
      await api.post(`/papers/${paperId}/generate-book`, {
        force_regenerate: force,
        generate_all: generateAll,
      })
    ).data,

  generatePages: async (paperId: string, pages: number[]) =>
    (
      await api.post(`/papers/${paperId}/generate-pages`, {
        pages,
      })
    ).data,
};

// Highlights API
export const highlightsApi = {
  list: async (
    paperId: string,
    params?: { category?: string; search?: string },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set("category", params.category);
    if (params?.search) searchParams.set("search", params.search);
    const qs = searchParams.toString();
    const url = `/highlight/papers/${paperId}/highlights${qs ? `?${qs}` : ""}`;
    return fetchApi<Highlight[]>(url);
  },

  create: async (
    paperId: string,
    data: {
      mode: "pdf" | "book";
      selected_text: string;
      page_number?: number;
      section_id?: string;
      rects?: Array<{ x: number; y: number; w: number; h: number }>;
      category?: HighlightCategory;
      color?: string;
      note?: string;
    },
  ) => {
    return fetchApi<Highlight>(`/highlight/papers/${paperId}/highlights`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update: async (
    highlightId: string,
    data: {
      category?: HighlightCategory;
      color?: string;
      note?: string;
    },
  ) => {
    return fetchApi<Highlight>(`/highlight/highlights/${highlightId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  delete: async (highlightId: string) => {
    return fetchApi<void>(`/highlight/highlights/${highlightId}`, {
      method: "DELETE",
    });
  },
};

// Explanations API (Enhanced with ask_mode)
export const explanationsApi = {
  list: async (paperId: string) => {
    console.log("Fetching explanations for paper:", paperId);
    const result = await fetchApi<any[]>(`/explanations/papers/${paperId}`);
    console.log("Explanations API response:", result);
    return result;
  },

  create: async (
    paperId: string,
    data: {
      highlight_id: string;
      question: string;
      parent_id?: string;
      ask_mode?: AskMode;
      auto_add_to_canvas?: boolean;
    },
  ) => {
    console.log("Creating explanation:", data);
    const result = await fetchApi<any>(`/explanations/papers/${paperId}`, {
      method: "POST",
      body: JSON.stringify({
        ...data,
        ask_mode: data.ask_mode || "explain_simply",
        auto_add_to_canvas: data.auto_add_to_canvas ?? true,
      }),
    });
    console.log("Created explanation response:", result);
    return result;
  },

  update: async (
    explanationId: string,
    data: {
      is_pinned?: boolean;
      is_resolved?: boolean;
    },
  ) => {
    return fetchApi<any>(`/explanations/${explanationId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  summarize: async (explanationId: string) =>
    (
      await api.post("/explanations/summarize", {
        explanation_id: explanationId,
      })
    ).data,
};

// Canvas API (Enhanced)
export const canvasApi = {
  get: async (paperId: string) =>
    (await api.get(`/papers/${paperId}/canvas`)).data,

  update: async (paperId: string, elements: CanvasElements) =>
    (await api.put(`/papers/${paperId}/canvas`, { elements })).data,

  // Node operations
  createNode: async (
    paperId: string,
    data: {
      type: CanvasNodeType;
      position: CanvasNodePosition;
      data: CanvasNodeData;
      parent_id?: string;
    },
  ) =>
    (await api.post(`/canvas/papers/${paperId}/canvas/nodes`, data))
      .data as CanvasNode,

  updateNode: async (
    paperId: string,
    nodeId: string,
    data: {
      position?: CanvasNodePosition;
      data?: Partial<CanvasNodeData>;
      is_collapsed?: boolean;
    },
  ) =>
    (await api.patch(`/canvas/papers/${paperId}/canvas/nodes/${nodeId}`, data))
      .data as CanvasNode,

  deleteNode: async (paperId: string, nodeId: string) =>
    (await api.delete(`/canvas/papers/${paperId}/canvas/nodes/${nodeId}`)).data,

  // Auto-create from explanation
  autoCreateNode: async (
    paperId: string,
    data: {
      highlight_id: string;
      explanation_id: string;
      position?: CanvasNodePosition;
    },
  ) =>
    (await api.post(`/canvas/papers/${paperId}/canvas/auto-create`, data))
      .data as CanvasNode,

  // Layout
  autoLayout: async (
    paperId: string,
    algorithm: "tree" | "force" | "grid" = "tree",
    rootNodeId?: string,
  ) =>
    (
      await api.post(`/canvas/papers/${paperId}/canvas/layout`, {
        algorithm,
        root_node_id: rootNodeId,
      })
    ).data,

  // Batch export highlights to canvas
  batchExport: async (
    paperId: string,
    data: {
      highlight_ids: string[];
      layout?: "tree" | "grid" | "radial";
      include_explanations?: boolean;
    },
  ) =>
    (
      await api.post(`/papers/${paperId}/canvas/batch-export`, {
        highlight_ids: data.highlight_ids,
        layout: data.layout ?? "tree",
        include_explanations: data.include_explanations ?? true,
      })
    ).data as {
      nodes_created: number;
      edges_created: number;
      root_node_ids: string[];
    },

  // AI query from canvas node
  aiQuery: async (
    paperId: string,
    data: {
      parent_node_id: string;
      question: string;
      ask_mode?: AskMode;
      include_paper_context?: boolean;
    },
  ) =>
    (
      await api.post(`/papers/${paperId}/canvas/ai-query`, {
        parent_node_id: data.parent_node_id,
        question: data.question,
        ask_mode: data.ask_mode ?? "explain_simply",
        include_paper_context: data.include_paper_context ?? true,
      })
    ).data as { node: CanvasNode; edge: CanvasEdge },

  // Create template starter
  createTemplate: async (
    paperId: string,
    template:
      | "summary_tree"
      | "question_branch"
      | "critique_map"
      | "concept_map",
  ) =>
    (await api.post(`/papers/${paperId}/canvas/template`, { template }))
      .data as { nodes_created: number; template: string },
};
