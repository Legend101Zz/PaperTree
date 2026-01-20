// apps/web/src/lib/api.ts
import axios from "axios";

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

  generateBook: async (paperId: string, force = false) =>
    (
      await api.post(`/papers/${paperId}/generate-book`, {
        force_regenerate: force,
      })
    ).data,
};

// Highlights API
export const highlightsApi = {
  list: async (paperId: string) => {
    console.log("Fetching highlights for paper:", paperId);
    const result = await fetchApi<any[]>(
      `/highlight/papers/${paperId}/highlights`,
    );
    console.log("Highlights API response:", result);
    return result;
  },

  create: async (
    paperId: string,
    data: {
      mode: "pdf" | "book";
      selected_text: string;
      page_number?: number;
      section_id?: string;
      rects?: Array<{ x: number; y: number; w: number; h: number }>;
    },
  ) => {
    console.log("Creating highlight:", data);
    const result = await fetchApi<any>(
      `/highlight/papers/${paperId}/highlights`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    console.log("Created highlight response:", result);
    return result;
  },

  delete: async (highlightId: string) => {
    console.log("Deleting highlight:", highlightId);
    return fetchApi<void>(`/highlight/highlights/${highlightId}`, {
      method: "DELETE",
    });
  },
};

// Explanations API
export const explanationsApi = {
  list: async (paperId: string) => {
    console.log("Fetching explanations for paper:", paperId);
    const result = await fetchApi<any[]>(`/explanations/papers/${paperId}`); // ✅
    console.log("Explanations API response:", result);
    return result;
  },

  create: async (
    paperId: string,
    data: {
      highlight_id: string;
      question: string;
      parent_id?: string;
    },
  ) => {
    console.log("Creating explanation:", data);
    const result = await fetchApi<any>(`/explanations/papers/${paperId}`, {
      // ✅
      method: "POST",
      body: JSON.stringify(data),
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
      // ✅
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  summarize: async (explanationId: string) =>
    (
      await api.post("/explanations/summarize", {
        // ✅
        explanation_id: explanationId,
      })
    ).data,
};

// Canvas
export const canvasApi = {
  get: async (paperId: string) =>
    (await api.get(`/papers/${paperId}/canvas`)).data,
  update: async (paperId: string, elements: any) =>
    (await api.put(`/papers/${paperId}/canvas`, { elements })).data,
};
