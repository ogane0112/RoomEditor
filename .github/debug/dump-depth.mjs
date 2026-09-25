// 一時的なデバッグ用: 実際のAIが出力した奥行きマップを、テスト用の素材として保存する
// 形式: 16bit リトルエンディアン(0〜65535 に正規化した相対視差)+ サイズを書いた JSON
import { mkdirSync, writeFileSync } from 'node:fs'
import { pipeline, RawImage } from '@huggingface/transformers'
const estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' })
const dir = 'src/three/__fixtures__'
mkdirSync(dir, { recursive: true })
for (const [name, src] of [['room', 'e2e-photo.jpg'], ['cats', 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg']]) {
  const image = await RawImage.read(src)
  const { predicted_depth } = await estimator(image)
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
  writeFileSync(`${dir}/${name}.depth.bin`, Buffer.from(out.buffer))
  writeFileSync(`${dir}/${name}.depth.json`, JSON.stringify({ width: W, height: H, imageWidth: image.width, imageHeight: image.height }) + '\n')
  console.log(name, W, H, image.width, image.height)
}
