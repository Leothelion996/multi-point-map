import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    // Legacy assets/ still exists at the server root during the transition;
    // a distinct dir guarantees no path collisions between the two.
    assetsDir: 'app-assets'
  }
});
