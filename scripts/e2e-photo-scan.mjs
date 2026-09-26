// 「写真から3D化」を本物のAIモデル(家具検出・奥行き推定)で端から端まで確認するE2Eテスト。
// 事前に `npm run build && npx vite preview --port 4173`(アプリ)と `npx vite --port 5173`(テスト写真の描画用)を起動しておく。
//
// 環境変数:
//   BROWSER=webkit   iPhone の Safari と同じ描画エンジン(WebKit)で動かす(既定: chromium)
//   DEVICE=iphone    iPhone の画面サイズ・タッチ操作で動かす
//   PHOTO=path.jpg   使う写真(既定: サンプルの部屋を目の高さから描画した画像)
//   E2E_WEBGPU=1     ソフトウェア実装の WebGPU を有効にする(chromium のみ)
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, devices, webkit } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/'
const DEV_URL = process.env.DEV_URL ?? 'http://localhost:5173/'
const BROWSER = process.env.BROWSER ?? 'chromium'
const label = [BROWSER, process.env.DEVICE, process.env.E2E_WEBGPU && 'webgpu', process.env.PHOTO?.replace(/.*\//, '')].filter(Boolean).join('-')

async function samplePhoto() {
  if (process.env.PHOTO) return readFileSync(process.env.PHOTO)
  // サンプルの部屋を、部屋の中から目の高さ(1.4m)で撮ったように描画する(開発サーバーからモジュールを直接読み込む)
  const renderer = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await renderer.newPage()
  await page.goto(DEV_URL)
  const dataUrl = await page.evaluate(async () => (await import('/src/three/sampleRoom.ts')).renderSampleRoomPhoto())
  await renderer.close()
  const photo = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync('e2e-photo.jpg', photo)
  return photo
}

const photo = await samplePhoto()

const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
const browser =
  BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.E2E_WEBGPU ? webgpuArgs : [])],
      })
const context = await browser.newContext(process.env.DEVICE === 'iphone' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
const hosts = new Set()
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
  else if (m.type() === 'warning') console.log('[console.warn]', m.text())
})
page.on('request', (r) => hosts.add(new URL(r.url()).host))
const tap = (locator) => (process.env.DEVICE === 'iphone' ? locator.tap() : locator.click())

/** 3D表示の画面に、背景・グリッド以外の明るい部分(床・壁・家具)がどれだけ描かれているか(0〜1) */
async function drawnRatio() {
  const png = await page.locator('canvas').screenshot()
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let drawn = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 3 * 95) drawn++
    return drawn / (data.length / 4)
  }, png.toString('base64'))
}

try {
  console.log(`== ${label}`)
  await page.goto(BASE_URL)
  if (process.env.E2E_WEBGPU) {
    const hasGpu = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter?.().catch(() => null)))
    if (!hasGpu) throw new Error('WebGPU adapter is not available')
  }

  await tap(page.getByText('写真から3D化'))
  await page.getByLabel('写真ファイル').setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: photo })
  await tap(page.getByRole('button', { name: '3D化する' }))

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
  await page.waitForTimeout(2000)

  const objects = await page.locator('aside li').allTextContents()
  const drawn = await drawnRatio()
  console.log('objects:', objects)
  console.log('drawn:', drawn.toFixed(3))
  console.log('hosts:', [...hosts])
  await page.screenshot({ path: `e2e-${label}.png` })

  // 床・壁と、検出された家具(椅子・ソファ等)が名前付きの物として並び、実際に画面に描かれている
  if (objects[0] !== '床') throw new Error('floor missing')
  const furniture = objects.filter((o) => !['床', '奥の壁', '左の壁', '右の壁'].includes(o))
  if (!process.env.PHOTO && furniture.length === 0) throw new Error('no furniture detected')
  if (drawn < 0.05) throw new Error(`the room is not visible in the 3D view (drawn ${drawn})`)
  if ([...hosts].some((h) => h.includes('jsdelivr'))) throw new Error('ONNX Runtime was loaded from a CDN')
  if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`)
  console.log('OK')
} catch (e) {
  await page.screenshot({ path: `e2e-${label}.png` }).catch(() => {})
  console.log('visible text:', (await page.locator('body').innerText().catch(() => '')).slice(0, 500))
  console.log('errors:', errors)
  throw e
} finally {
  await browser.close()
}
