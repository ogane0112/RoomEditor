// 「写真から3D化」を本物のAIモデル(家具検出・奥行き推定)で端から端まで確認するE2Eテスト。
// 事前に `npm run build && npx vite preview --port 4173`(アプリ)と `npx vite --port 5173`(テスト写真の描画用)を起動しておく。
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/'
const DEV_URL = process.env.DEV_URL ?? 'http://localhost:5173/'
// E2E_WEBGPU=1 のときは、ソフトウェア実装の WebGPU を有効にして GPU 経由の経路も確かめる
const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.E2E_WEBGPU ? webgpuArgs : [])],
})
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
  const hasGpu = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter?.().catch(() => null)))
  console.log('WebGPU adapter:', hasGpu)
  if (process.env.E2E_WEBGPU && !hasGpu) throw new Error('WebGPU adapter is not available')

  // 1. テスト用の写真を用意する: サンプルの部屋を、部屋の中から目の高さ(1.4m)で撮ったように描画する
  //    (開発サーバーからモジュールを直接読み込んで描画する)
  const renderPage = await browser.newPage()
  await renderPage.goto(DEV_URL)
  const dataUrl = await renderPage.evaluate(async () => (await import('/src/three/sampleRoom.ts')).renderSampleRoomPhoto())
  await renderPage.close()
  const photo = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync('e2e-photo.jpg', photo)

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

  // 床・壁と、検出された家具(椅子・ソファ等)が名前付きの物として並ぶ
  if (objects[0] !== '床') throw new Error('floor missing')
  const furniture = objects.filter((o) => !['床', '奥の壁', '左の壁', '右の壁'].includes(o))
  if (furniture.length === 0) throw new Error('no furniture detected')
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
