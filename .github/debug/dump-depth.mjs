// 一時的なデバッグ用: 実際のAIが出力した奥行きマップをログに出す(パーツ分割のしきい値調整用)
import { pipeline, RawImage } from '@huggingface/transformers'
const estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' })
for (const [name, src] of [['room', 'e2e-photo.jpg'], ['cats', 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg']]) {
  const image = await RawImage.read(src)
  const { predicted_depth } = await estimator(image)
  const [h, w] = predicted_depth.dims.slice(-2)
  const d = predicted_depth.data
  let min = Infinity, max = -Infinity
  for (const v of d) { if (v < min) min = v; if (v > max) max = v }
  const W = 256, H = Math.round((W * h) / w)
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = d[Math.floor((y * h) / H) * w + Math.floor((x * w) / W)]
    out[y * W + x] = Math.round(((v - min) / (max - min)) * 255)
  }
  const small = await image.resize(W, H)
  const rgb = small.rgb().data
  const b64 = (u8) => Buffer.from(u8).toString('base64')
  const emit = (tag, s) => { for (let i = 0; i < s.length; i += 3000) console.log(`@@${name}:${tag}:${i / 3000}:${s.slice(i, i + 3000)}`) }
  console.log(`@@${name}:size:${W}x${H} model:${w}x${h}`)
  emit('depth', b64(out))
  emit('rgb', b64(rgb))
}
