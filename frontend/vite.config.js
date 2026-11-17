import { defineConfig } from 'vite';

// Cổng backend lấy từ src/Warehouse.Api/Properties/launchSettings.json (profile http).
const API_URL = 'http://localhost:5251';

export default defineConfig({
  server: {
    // Khi dev: mọi request /api chuyển sang backend .NET.
    proxy: { '/api': API_URL },
  },
  build: {
    // Khi demo: build thẳng vào wwwroot để chỉ cần chạy dotnet run.
    outDir: '../src/Warehouse.Api/wwwroot',
    emptyOutDir: true,
  },
});
