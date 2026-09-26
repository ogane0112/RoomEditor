// 写真に写っている家具を検出する(RT-DETR, COCO の80クラス)。
import type { ObjectDetectionPipeline } from '@huggingface/transformers'
import { loadModel, type ModelProgress } from './ai'

export const DETECTION_MODEL_ID = 'onnx-community/rtdetr_r18vd'

export interface Detection {
  label: string
  score: number
  /** 画像上の位置(px) */
  box: { xmin: number; ymin: number; xmax: number; ymax: number }
}

export async function detectObjects(image: HTMLCanvasElement, onProgress: (p: ModelProgress) => void): Promise<Detection[]> {
  const detector = await loadModel<ObjectDetectionPipeline>('object-detection', DETECTION_MODEL_ID, onProgress)
  const { RawImage } = await import('@huggingface/transformers')
  const result = await detector(RawImage.fromCanvas(image), { threshold: 0.4 })
  return (Array.isArray(result) ? result.flat() : [result]) as Detection[]
}
