import { create } from "zustand";
import { User } from "@/types";
import { authApi } from "@/lib/api";
import { setToken, removeToken, getToken } from "@/lib/auth";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setToken(response.access_token);
    const user = await authApi.getMe();
    set({ user, isAuthenticated: true });
  },

  register: async (email: string, password: string) => {
    const response = await authApi.register(email, password);
    setToken(response.access_token);
    const user = await authApi.getMe();
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    removeToken();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = getToken();
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const user = await authApi.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      removeToken();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
