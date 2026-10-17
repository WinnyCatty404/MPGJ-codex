import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_DEV_PORT || 5174),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${Number(process.env.VITE_API_PORT || 3101)}` },
  },
});

