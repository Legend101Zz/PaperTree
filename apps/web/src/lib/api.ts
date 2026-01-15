import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Create axios instance
export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: async (email: string, password: string) => {
    const response = await api.post("/auth/register", { email, password });
    return response.data;
  },
  login: async (email: string, password: string) => {
    const response = await api.post("/auth/login", { email, password });
    return response.data;
  },
  getMe: async () => {
    const response = await api.get("/auth/me");
    return response.data;
  },
};

// Papers API
export const papersApi = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post("/papers/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },
  list: async () => {
    const response = await api.get("/papers");
    return response.data;
  },
  get: async (paperId: string) => {
    const response = await api.get(`/papers/${paperId}`);
    return response.data;
  },
  getFileUrl: (paperId: string) => {
    // Return URL with token as query param for PDF.js compatibility
    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : "";
    return `${API_URL}/papers/${paperId}/file?token=${token}`;
  },
  getText: async (paperId: string) => {
    const response = await api.get(`/papers/${paperId}/text`);
    return response.data;
  },
  delete: async (paperId: string) => {
    const response = await api.delete(`/papers/${paperId}`);
    return response.data;
  },
  search: async (paperId: string, query: string) => {
    const response = await api.get(`/papers/${paperId}/search`, {
      params: { q: query },
    });
    return response.data;
  },
};

// Highlights API
export const highlightsApi = {
  create: async (
    paperId: string,
    data: {
      mode: "pdf" | "book";
      selected_text: string;
      page_number?: number;
      rects?: { x: number; y: number; w: number; h: number }[];
      anchor?: {
        exact: string;
        prefix: string;
        suffix: string;
        section_path: string[];
      };
    }
  ) => {
    const response = await api.post(`/papers/${paperId}/highlights`, data);
    return response.data;
  },
  list: async (paperId: string) => {
    const response = await api.get(`/papers/${paperId}/highlights`);
    return response.data;
  },
  delete: async (highlightId: string) => {
    const response = await api.delete(`/highlights/${highlightId}`);
    return response.data;
  },
};

// Explanations API
export const explanationsApi = {
  create: async (
    paperId: string,
    data: {
      highlight_id: string;
      question: string;
      parent_id?: string;
    }
  ) => {
    const response = await api.post(`/papers/${paperId}/explain`, data);
    return response.data;
  },
  list: async (paperId: string) => {
    const response = await api.get(`/papers/${paperId}/explanations`);
    return response.data;
  },
  getThread: async (explanationId: string) => {
    const response = await api.get(`/explanations/${explanationId}/thread`);
    return response.data;
  },
  update: async (
    explanationId: string,
    data: {
      is_pinned?: boolean;
      is_resolved?: boolean;
    }
  ) => {
    const response = await api.patch(`/explanations/${explanationId}`, data);
    return response.data;
  },
  summarize: async (explanationId: string) => {
    const response = await api.post("/explanations/summarize", {
      explanation_id: explanationId,
    });
    return response.data;
  },
};

// Canvas API
export const canvasApi = {
  get: async (paperId: string) => {
    const response = await api.get(`/papers/${paperId}/canvas`);
    return response.data;
  },
  update: async (paperId: string, elements: any) => {
    const response = await api.put(`/papers/${paperId}/canvas`, { elements });
    return response.data;
  },
};
