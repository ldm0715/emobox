import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages 项目页部署在 https://ldm0715.github.io/emobox/ 子路径下。
export default defineConfig({
  base: "/emobox/",
  plugins: [react()],
  build: {
    target: "chrome105",
    chunkSizeWarningLimit: 1600,
  },
});
