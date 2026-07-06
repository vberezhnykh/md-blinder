import mammoth from 'mammoth'

self.onmessage = async (e: MessageEvent<{ arrayBuffer: ArrayBuffer }>) => {
  try {
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: e.data.arrayBuffer })
    self.postMessage({ ok: true, html })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
