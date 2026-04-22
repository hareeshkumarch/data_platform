import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(({ mode }) => {
  // Load env from /app/frontend/.env* AND forward REACT_APP_* + VITE_* vars.
  const env = loadEnv(mode, process.cwd(), ["REACT_APP_", "VITE_"]);
  const BACKEND_URL =
    env.REACT_APP_BACKEND_URL ||
    env.VITE_BACKEND_URL ||
    process.env.REACT_APP_BACKEND_URL ||
    process.env.VITE_BACKEND_URL ||
    "http://localhost:8001";

  return {
    server: {
      host: "0.0.0.0",
      port: Number(process.env.PORT) || 3000,
      strictPort: false,
      allowedHosts: true,
      hmr: { overlay: false, clientPort: 443 },
      proxy: {
        "/api": {
          target: BACKEND_URL,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
    define: {
      "import.meta.env.VITE_BACKEND_URL": JSON.stringify(BACKEND_URL),
    },
  };
});
