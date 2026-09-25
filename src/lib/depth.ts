// 写真1枚から奥行き(深度)を推定する。推論はすべてブラウザ内で行い、写真は外部に送信しない。
// 初回のみ AI モデル(Depth Anything V2 small)を Hugging Face Hub からダウンロードし、以降はブラウザにキャッシュされる。

import type { DepthEstimationPipeline, ProgressInfo } from '@huggingface/transformers'

export const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small'

export interface DepthMap {
  /** 相対的な視差(大きいほど手前)。0〜1に正規化済み */
  data: Float32Array
  width: number
  height: number
}

export type DepthProgress =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'init' }
  | { stage: 'infer' }

let pipelinePromise: Promise<DepthEstimationPipeline> | null = null

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

function loadPipeline(onProgress: (p: DepthProgress) => void) {
  pipelinePromise ??= (async () => {
    // transformers.js(約2MB)と ONNX Runtime は使うときだけ読み込む
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

    // pipeline() の型はタスク全体の共用体になり TypeScript が扱えないため、深度推定用に絞る
    const createPipeline = pipeline as (
      task: 'depth-estimation',
      model: string,
      options: Record<string, unknown>,
    ) => Promise<DepthEstimationPipeline>
    const create = (device: 'webgpu' | 'wasm') =>
      createPipeline('depth-estimation', DEPTH_MODEL_ID, {
        device,
        // WebGPU は fp16、CPU(wasm)は8bit量子化版で軽くする
        dtype: device === 'webgpu' ? 'fp16' : 'q8',
        progress_callback,
      })

    if (await hasWebGPU()) {
      try {
        return await create('webgpu')
      } catch (e) {
        console.warn('WebGPU での初期化に失敗したため CPU で実行します', e)
      }
    }
    return create('wasm')
  })().catch((e: unknown) => {
    pipelinePromise = null
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`AIモデルを読み込めませんでした。インターネット接続を確認してください(${message})`)
  })
  return pipelinePromise
}

/** 画像(canvas)から奥行きマップを推定する */
export async function estimateDepth(image: HTMLCanvasElement, onProgress: (p: DepthProgress) => void): Promise<DepthMap> {
  const estimator = await loadPipeline(onProgress)
  onProgress({ stage: 'infer' })

  const { RawImage } = await import('@huggingface/transformers')
  const result = await estimator(RawImage.fromCanvas(image))
  const output = Array.isArray(result) ? result[0] : result
  const tensor = output.predicted_depth
  const [height, width] = tensor.dims.slice(-2)
  const raw = tensor.data as Float32Array

  let min = Infinity
  let max = -Infinity
  for (const v of raw) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  const data = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = (raw[i] - min) / range
  return { data, width, height }
}
