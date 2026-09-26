// 写真に写っている家具を検出する(RT-DETR, COCO の80クラス)。
import type { ObjectDetectionPipeline } from '@huggingface/transformers'
import { runModel, type ModelProgress } from './ai'

export const DETECTION_MODEL_ID = 'onnx-community/rtdetr_r18vd'

export interface Detection {
  label: string
  score: number
  /** 画像上の位置(px) */
  box: { xmin: number; ymin: number; xmax: number; ymax: number }
}

export async function detectObjects(image: HTMLCanvasElement, onProgress: (p: ModelProgress) => void): Promise<Detection[]> {
  const { RawImage } = await import('@huggingface/transformers')
  const result = await runModel(
    'object-detection',
    DETECTION_MODEL_ID,
    onProgress,
    (detector: ObjectDetectionPipeline) => detector(RawImage.fromCanvas(image), { threshold: 0.4 }),
    // RT-DETR は ceil_mode の AveragePool を含み、ONNX Runtime の WebGPU 版では動かないため CPU で動かす
    { gpu: false },
  )
  return (Array.isArray(result) ? result.flat() : [result]) as Detection[]
}
