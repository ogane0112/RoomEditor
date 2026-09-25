// 「写真から3D化」を本物のAIモデルで端から端まで確認するE2Eテスト。
// 事前に `npm run build && npx vite preview --port 4173` でアプリを起動しておく。
// テスト用の写真には、サンプルの部屋を描画したスクリーンショットを使う。
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
const hosts = new Set()
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
  else if (m.type() === 'warning') console.log('[console.warn]', m.text())
})
page.on('request', (r) => hosts.add(new URL(r.url()).host))

try {
  await page.goto(BASE_URL)

  // 1. テスト用の写真を用意する
  await page.getByText('サンプルの部屋を開く').click()
  await page.getByText('オブジェクト一覧 (9)').waitFor()
  await page.waitForTimeout(1500)
  const photo = await page.locator('canvas').screenshot({ type: 'jpeg', quality: 90, path: 'e2e-photo.jpg' })
  // 未保存の部屋を閉じる確認ダイアログは「OK」にする
  page.once('dialog', (d) => d.accept())
  await page.getByText('← 部屋一覧').click()

  // 2. 写真から3D化する
  await page.getByText('写真から3D化').click()
  await page.getByLabel('写真ファイル').setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: photo })
  await page.getByRole('button', { name: '3D化する' }).click()

  const started = Date.now()
  const header = page.getByText(/オブジェクト一覧 \(\d+\)/)
  const failure = page.getByText(/3D化に失敗しました/)
  let lastMessage = ''
  while (!(await header.isVisible())) {
    if (await failure.isVisible()) throw new Error(await failure.textContent())
    if (Date.now() - started > 5 * 60_000) throw new Error('timeout')
    const message = await page.locator('[aria-live=polite] p').textContent().catch(() => null)
    if (message && message !== lastMessage) console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${(lastMessage = message)}`)
    await page.waitForTimeout(500)
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  await page.waitForTimeout(1500)

  const objects = await page.locator('aside li').allTextContents()
  console.log('objects:', objects)
  console.log('hosts:', [...hosts])
  await page.screenshot({ path: 'e2e-photo-scan.png' })

  if (objects[0] !== '背景') throw new Error('background part missing')
  if ([...hosts].some((h) => h.includes('jsdelivr'))) throw new Error('ONNX Runtime was loaded from a CDN')
  if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`)
  console.log('OK')
} catch (e) {
  await page.screenshot({ path: 'e2e-photo-scan.png' }).catch(() => {})
  console.log('visible text:', (await page.locator('body').innerText().catch(() => '')).slice(0, 500))
  console.log('errors:', errors)
  throw e
} finally {
  await browser.close()
}
