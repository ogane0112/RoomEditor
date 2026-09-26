// 写真1枚から奥行き(深度)を推定する(Depth Anything V2 small)。
import type { DepthEstimationPipeline } from '@huggingface/transformers'
import { loadModel, type ModelProgress } from './ai'

export const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small'

export interface DepthMap {
  /** 相対的な視差(大きいほど手前)。0〜1に正規化済み */
  data: Float32Array
  width: number
  height: number
}

/** 画像(canvas)から奥行きマップを推定する */
export async function estimateDepth(image: HTMLCanvasElement, onProgress: (p: ModelProgress) => void): Promise<DepthMap> {
  const estimator = await loadModel<DepthEstimationPipeline>('depth-estimation', DEPTH_MODEL_ID, onProgress)
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
