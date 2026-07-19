// Prefer WebGPU when the runtime exposes it (navigator.gpu); otherwise WASM.
// Pure + injectable so it can be unit-tested without a real worker/GPU.
export type ExecProvider = 'webgpu' | 'wasm'
export function pickExecutionProvider(nav: { gpu?: unknown } | undefined): ExecProvider {
  return nav && typeof nav === 'object' && 'gpu' in nav && nav.gpu ? 'webgpu' : 'wasm'
}
