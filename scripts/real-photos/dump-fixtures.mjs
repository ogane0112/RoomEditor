// 実写の写真に対する実際のAIの出力(奥行きマップ・家具検出)を、テスト素材として保存する。
// 写真そのものは保存しない(COCO の画像はそれぞれのライセンスのため、IDと出典URLだけを記録する)。
// 使い方: node dump-fixtures.mjs <写真フォルダ(index.json付き)> <出力先>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pipeline, RawImage } from '@huggingface/transformers'

const [inDir, outDir] = process.argv.slice(2)
const index = JSON.parse(readFileSync(`${inDir}/index.json`, 'utf8'))
const depthModel = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' })
const detector = await pipeline('object-detection', 'onnx-community/rtdetr_r18vd', { dtype: 'q8' })
mkdirSync(outDir, { recursive: true })
for (const item of index) {
  const image = await RawImage.read(`${inDir}/${item.id}.jpg`)
  const { predicted_depth } = await depthModel(image)
  const [h, w] = predicted_depth.dims.slice(-2)
  const d = predicted_depth.data
  let min = Infinity, max = -Infinity
  for (const v of d) { if (v < min) min = v; if (v > max) max = v }
  const W = 192, H = Math.round((W * h) / w)
  const out = new Uint16Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = d[Math.floor(((y + 0.5) * h) / H) * w + Math.floor(((x + 0.5) * w) / W)]
    out[y * W + x] = Math.round(((v - min) / (max - min)) * 65535)
  }
  const detections = await detector(image, { threshold: 0.3 })
  writeFileSync(`${outDir}/coco-${item.id}.depth.bin`, Buffer.from(out.buffer))
  writeFileSync(`${outDir}/coco-${item.id}.json`, JSON.stringify({
    source: item.url, license: item.license, width: W, height: H, imageWidth: image.width, imageHeight: image.height,
    groundTruth: item.furniture, detections,
  }, null, 1) + '\n')
  console.log(item.id, detections.filter((x) => x.score >= 0.4).map((x) => `${x.label}:${x.score.toFixed(2)}`).join(' '))
}
