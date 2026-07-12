// @ts-check
import { defineConfig } from "astro/config"
import solidJs from "@astrojs/solid-js"
import cloudflare from "@astrojs/cloudflare"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"

export default defineConfig({
  site: config.url,
  base: "/docs",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  devToolbar: { enabled: false },
  server: { host: "0.0.0.0" },
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  integrations: [solidJs()],
})
