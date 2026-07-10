import { defineConfig, type Connect, type Plugin } from "vite"
import desktopPlugin from "./vite"

/** ASR proxy handler: forwards audio to provider's chat completions API, bypassing CORS */
function asrProxyHandler(req: Connect.IncomingMessage, res: Connect.ServerResponse, next: Connect.NextFunction) {
  const isTranscribe = req.url === "/api/transcribe" && req.method === "POST"
  if (!isTranscribe) {
    if (req.url?.startsWith("/api/transcribe")) {
      res.statusCode = 405
      res.end()
      return
    }
    next()
    return
  }

  const buffers: Buffer[] = []
  let bodyStr = ""
  req.on("data", (chunk: Buffer) => buffers.push(chunk))
  req.on("end", async () => {
    bodyStr = Buffer.concat(buffers).toString()
    const { audio, apiKey, baseUrl, model = "mimo-v2.5-asr" } = JSON.parse(bodyStr)

    if (!audio || !apiKey) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: "Missing audio or apiKey" }))
      return
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      const base = (baseUrl || "https://api.xiaomimimo.com/v1").replace(/\/+$/, "")
      const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Mimo-Source": "mimocode-web",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: audio } }] }],
          asr_options: { language: "auto" },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const errText = await response.text().catch(() => "")
        res.statusCode = response.status
        res.end(JSON.stringify({ error: `ASR failed: ${errText}` }))
        return
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const text = data.choices?.[0]?.message?.content?.trim() || ""
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ text }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}

/** Vite plugin: registers /api/transcribe proxy in dev and preview servers */
const asrProxy: Plugin = {
  name: "asr-proxy",
  configureServer(server) {
    server.middlewares.use(asrProxyHandler)
  },
  configurePreviewServer(server) {
    server.middlewares.use(asrProxyHandler)
  },
}

export default defineConfig({
  plugins: [desktopPlugin, asrProxy] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
