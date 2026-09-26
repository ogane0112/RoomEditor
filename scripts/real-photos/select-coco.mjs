// COCO val2017 の注釈から、家具(ソファ・ベッド・テーブル・椅子など)がはっきり写った室内写真を選んでダウンロードする。
// 使い方: node select-coco.mjs instances_val2017.json <出力先> <枚数>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [annPath, outDir = 'real-photos', count = '8'] = process.argv.slice(2)
const ann = JSON.parse(readFileSync(annPath, 'utf8'))
const catName = new Map(ann.categories.map((c) => [c.id, c.name]))
const furnitureNames = new Set(['couch', 'bed', 'dining table', 'chair', 'tv', 'potted plant', 'refrigerator'])
const byImage = new Map()
for (const a of ann.annotations) {
  const name = catName.get(a.category_id)
  if (!byImage.has(a.image_id)) byImage.set(a.image_id, [])
  byImage.get(a.image_id).push({ name, bbox: a.bbox, area: a.area, iscrowd: a.iscrowd })
}

const picked = []
for (const img of ann.images.sort((a, b) => a.id - b.id)) {
  if (img.width < img.height) continue // 横長のみ
  const objs = byImage.get(img.id) ?? []
  const area = img.width * img.height
  const furniture = objs.filter((o) => furnitureNames.has(o.name))
  const main = furniture.filter((o) => ['couch', 'bed'].includes(o.name) && o.area > area * 0.06)
  const people = objs.filter((o) => o.name === 'person').reduce((s, o) => s + o.area, 0)
  if (main.length === 0 || furniture.length < 3 || people > area * 0.1) continue
  picked.push({ id: img.id, file: img.file_name, url: img.coco_url, license: img.license, width: img.width, height: img.height, furniture: furniture.map((f) => ({ name: f.name, bbox: f.bbox.map(Math.round) })) })
  if (picked.length >= Number(count)) break
}

mkdirSync(outDir, { recursive: true })
for (const p of picked) {
  const res = await fetch(p.url)
  writeFileSync(`${outDir}/${p.id}.jpg`, Buffer.from(await res.arrayBuffer()))
  console.log(p.id, p.furniture.map((f) => f.name).join(', '))
}
writeFileSync(`${outDir}/index.json`, JSON.stringify(picked, null, 1))
