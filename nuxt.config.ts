import { resolve } from "node:path";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxt/ui'],

  css: ['~/assets/css/main.css'],

  alias: {
    "@core": resolve(__dirname, "app/core"),
  },

  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: {
          "@core/*": ["../app/core/*"],
        }
      }
    }
  }
})
