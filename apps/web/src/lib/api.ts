// apps/web/src/lib/api.ts
import axios from "axios";

import type {
  Highlight,
  CreateHighlightInput,
  UpdateHighlightInput,
  HighlightExplanation,
  ExplanationMode,
} from "@/types/highlight";
import type {
  Canvas,
  CanvasElements,
  CanvasNode,
  CanvasEdge,
  ExploreRequest,
  ExploreResponse,
  AskFollowupRequest,
  AddNoteRequest,
  AskMode,
} from "@/types/canvas";

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

// ============ Highlights API ============

export const highlightsApi = {
  // ─── NEW: Paper-based methods (used by reader page) ───

  list: async (paperId: string): Promise<Highlight[]> => {
    const { data } = await api.get(`/highlights/papers/${paperId}`);
    return data;
  },

  create: async (paperId: string, input: any): Promise<Highlight> => {
    const { data } = await api.post(`/highlights/papers/${paperId}`, input);
    return data;
  },

  delete: async (highlightId: string): Promise<void> => {
    // Use the legacy route which works for any highlight
    await api.delete(`/highlights/${highlightId}`);
  },

  getBookHighlights: async (
    bookId: string,
    page?: number,
  ): Promise<Highlight[]> => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("page", String(page));
    const { data } = await api.get(`/highlights/book/${bookId}?${params}`);
    return data;
  },

  getHighlight: async (highlightId: string): Promise<Highlight> => {
    const { data } = await api.get(`/highlights/${highlightId}`);
    return data;
  },

  createHighlight: async (input: CreateHighlightInput): Promise<Highlight> => {
    const { data } = await api.post("/highlights/", input);
    return data;
  },

  updateHighlight: async (
    highlightId: string,
    input: UpdateHighlightInput,
  ): Promise<Highlight> => {
    const { data } = await api.patch(`/highlights/${highlightId}`, input);
    return data;
  },

  deleteHighlight: async (highlightId: string): Promise<void> => {
    await api.delete(`/highlights/${highlightId}`);
  },

  explainHighlight: async (
    highlightId: string,
    mode: ExplanationMode = "explain",
    customPrompt?: string,
  ): Promise<HighlightExplanation> => {
    const { data } = await api.post(`/highlights/${highlightId}/explain`, {
      highlight_id: highlightId,
      mode,
      custom_prompt: customPrompt,
    });
    return data;
  },

  getExplanations: async (
    highlightId: string,
  ): Promise<HighlightExplanation[]> => {
    const { data } = await api.get(`/highlights/${highlightId}/explanations`);
    return data;
  },

  searchHighlights: async (query: {
    book_id?: string;
    category?: string;
    tags?: string[];
    search_text?: string;
  }): Promise<Highlight[]> => {
    const { data } = await api.post("/highlights/search", query);
    return data;
  },

  exportHighlights: async (
    bookId: string,
    format: "json" | "markdown" | "csv" = "json",
  ): Promise<{ content: string; filename: string }> => {
    const { data } = await api.get(
      `/highlights/export/${bookId}?format=${format}`,
    );
    return data;
  },
};

// ============ Canvas API ============

export const canvasApi = {
  // ── Core CRUD ──

  get: async (paperId: string): Promise<Canvas> =>
    fetchApi<Canvas>(`/papers/${paperId}/canvas`),

  save: async (paperId: string, elements: CanvasElements): Promise<void> =>
    fetchApi<void>(`/papers/${paperId}/canvas`, {
      method: "PUT",
      body: JSON.stringify({ elements }),
    }),

  // ── Explore: Highlight → Canvas ──

  explore: async (
    paperId: string,
    data: ExploreRequest,
  ): Promise<ExploreResponse> =>
    fetchApi<ExploreResponse>(`/papers/${paperId}/canvas/explore`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Ask Follow-up ──

  ask: async (
    paperId: string,
    data: AskFollowupRequest,
  ): Promise<{ node: CanvasNode; edge: CanvasEdge }> =>
    fetchApi<{ node: CanvasNode; edge: CanvasEdge }>(
      `/papers/${paperId}/canvas/ask`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  // ── Notes ──

  addNote: async (
    paperId: string,
    data: AddNoteRequest,
  ): Promise<{ node: CanvasNode; edge?: CanvasEdge }> =>
    fetchApi<{ node: CanvasNode; edge?: CanvasEdge }>(
      `/papers/${paperId}/canvas/note`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  // ── Page expansion ──

  expandPage: async (
    paperId: string,
    pageNumber: number,
  ): Promise<{ page_node: CanvasNode; was_created: boolean }> =>
    fetchApi<{ page_node: CanvasNode; was_created: boolean }>(
      `/papers/${paperId}/canvas/expand-page`,
      { method: "POST", body: JSON.stringify({ page_number: pageNumber }) },
    ),

  // ── Layout ──

  autoLayout: async (paperId: string, algorithm: "tree" | "grid" = "tree") =>
    fetchApi<{ status: string }>(`/papers/${paperId}/canvas/layout`, {
      method: "POST",
      body: JSON.stringify({ algorithm }),
    }),

  // ── Node operations ──

  updateNode: async (
    paperId: string,
    nodeId: string,
    data: {
      position?: { x: number; y: number };
      data?: Partial<CanvasNode["data"]>;
    },
  ) =>
    fetchApi<CanvasNode>(`/papers/${paperId}/canvas/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteNode: async (paperId: string, nodeId: string) =>
    fetchApi<{ deleted: string[] }>(
      `/papers/${paperId}/canvas/nodes/${nodeId}`,
      {
        method: "DELETE",
      },
    ),

  // ── Populate (auto-create page nodes + explanation branches) ──

  populate: async (
    paperId: string,
  ): Promise<{
    id: string;
    paper_id: string;
    elements: CanvasElements;
    pages_created: number;
    explorations_created: number;
  }> => fetchApi(`/papers/${paperId}/canvas/populate`, { method: "POST" }),
};
