import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/Garminator/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Garmin Calorie Tracker",
        short_name: "Calories",
        description: "Weight and calorie tracking on top of Garmin data",
        theme_color: "#0e1116",
        background_color: "#0e1116",
        display: "standalone",
        start_url: "/Garminator/",
        icons: [
          // Placeholder: a single inline-generatable icon is enough for the
          // skeleton. Real icons are a later polish step. vite-plugin-pwa
          // will still emit a valid manifest without icons listed.
        ],
      },
    }),
  ],
});
