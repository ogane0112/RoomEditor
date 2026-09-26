// 一時的なデバッグ用: 目の高さで描画したサンプル部屋の写真に対して、実際のAIの出力(奥行き・家具検出)を保存する
import { mkdirSync, writeFileSync } from 'node:fs'
import { pipeline, RawImage } from '@huggingface/transformers'
const dir = 'src/three/__fixtures__'
mkdirSync(dir, { recursive: true })
const image = await RawImage.read('e2e-photo.jpg')
const depthModel = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' })
const { predicted_depth } = await depthModel(image)
const [h, w] = predicted_depth.dims.slice(-2)
const d = predicted_depth.data
let min = Infinity, max = -Infinity
for (const v of d) { if (v < min) min = v; if (v > max) max = v }
const W = 256, H = Math.round((W * h) / w)
const out = new Uint16Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = d[Math.floor(((y + 0.5) * h) / H) * w + Math.floor(((x + 0.5) * w) / W)]
  out[y * W + x] = Math.round(((v - min) / (max - min)) * 65535)
}
writeFileSync(`${dir}/eye.depth.bin`, Buffer.from(out.buffer))
const detector = await pipeline('object-detection', 'onnx-community/rtdetr_r18vd', { dtype: 'q8' })
const detections = await detector(image, { threshold: 0.3 })
writeFileSync(`${dir}/eye.json`, JSON.stringify({ width: W, height: H, imageWidth: image.width, imageHeight: image.height, detections }, null, 1) + '\n')
console.log(JSON.stringify(detections))
