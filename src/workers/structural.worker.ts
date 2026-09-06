import { detectStructural } from '../lib/anonymize/regexDetectors'

self.onmessage = (event: MessageEvent<{ text: string }>) => {
  try {
    self.postMessage({ matches: detectStructural(event.data.text) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
