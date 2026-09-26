// ブラウザ内でAIモデル(transformers.js)を動かすための共通処理。
// 推論はすべて端末内で行い、写真は外部に送信しない。モデルは初回のみ Hugging Face Hub から
// ダウンロードされ、以降はブラウザにキャッシュされる。

import type { ProgressInfo } from '@huggingface/transformers'

export type ModelProgress =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'init' }

type Task = 'depth-estimation' | 'object-detection'

const cache = new Map<string, Promise<unknown>>()

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

type Device = 'webgpu' | 'wasm'

/** GPU(WebGPU)で動かせなかったモデル。以降は最初から CPU で動かす */
const cpuOnly = new Set<string>()

/** モデルを指定の方式で読み込む(同じモデル・方式は1回だけ) */
function loadModel<T>(task: Task, modelId: string, device: Device, onProgress: (p: ModelProgress) => void): Promise<T> {
  const key = `${task}:${modelId}:${device}`
  let promise = cache.get(key) as Promise<T> | undefined
  if (promise) return promise

  promise = (async () => {
    // transformers.js(約1MB)と ONNX Runtime は使うときだけ読み込む
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
    if (ort.wasm) {
      // transformers.js は既定で ONNX Runtime の wasm を外部CDNから読み込むため、その設定を外す。
      // 未設定なら、ビルド時にアプリへ同梱された wasm が使われる
      ort.wasm.wasmPaths = undefined
      // GitHub Pages では SharedArrayBuffer が使えないためシングルスレッドで動かす
      ort.wasm.numThreads = 1
    }

    // ファイルごとの進捗を合算してダウンロード率を出す
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (info: ProgressInfo) => {
      if (info.status === 'progress') {
        files.set(info.file, { loaded: info.loaded, total: info.total })
        let loaded = 0
        let total = 0
        files.forEach((f) => {
          loaded += f.loaded
          total += f.total
        })
        onProgress({ stage: 'download', loaded, total })
      } else if (info.status === 'ready') {
        onProgress({ stage: 'init' })
      }
    }

    // pipeline() の型はタスク全体の共用体になり TypeScript が扱えないため、使う形に絞る
    const createPipeline = pipeline as (task: Task, model: string, options: Record<string, unknown>) => Promise<T>
    return createPipeline(task, modelId, {
      device,
      // WebGPU は fp16、CPU(wasm)は8bit量子化版で軽くする
      dtype: device === 'webgpu' ? 'fp16' : 'q8',
      progress_callback,
    })
  })().catch((e: unknown) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, promise)
  return promise
}

/**
 * モデルを読み込んで推論する。WebGPU が使えれば GPU で動かし、
 * GPU での読み込み・推論に失敗したら(GPU版の実行環境が未対応の処理を含むモデルなど)CPU でやり直す。
 */
export async function runModel<T, R>(
  task: Task,
  modelId: string,
  onProgress: (p: ModelProgress) => void,
  run: (model: T) => Promise<R>,
  options: { gpu?: boolean } = {},
): Promise<R> {
  const key = `${task}:${modelId}`
  if (options.gpu !== false && !cpuOnly.has(key) && (await hasWebGPU())) {
    try {
      return await run(await loadModel<T>(task, modelId, 'webgpu', onProgress))
    } catch (e) {
      console.warn(`GPU(WebGPU)で ${modelId} を実行できなかったため CPU でやり直します`, e)
      cpuOnly.add(key)
    }
  }
  let model: T
  try {
    model = await loadModel<T>(task, modelId, 'wasm', onProgress)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`AIモデルを読み込めませんでした。インターネット接続を確認してください(${message})`)
  }
  return run(model)
}
