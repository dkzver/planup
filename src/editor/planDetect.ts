/**
 * Детектор стен на растровом плане квартиры.
 *
 * Идея: чертёж — это длинные толстые ортогональные тёмные линии на светлом фоне.
 * 1) Рендерим в canvas, grayscale, Otsu-порог
 * 2) Ищем горизонтальные и вертикальные «полосы» тёмного (стены)
 * 3) Отбрасываем тонкие (размерные линии, текст) и пятна
 * 4) Переводим в метры, чистим, отдаём сегменты
 *
 * Если линий мало / нет замкнутого контура — это не план.
 */

export interface DetectedWall {
  x1: number
  z1: number
  x2: number
  z2: number
  thickness: number
}

export interface DetectResult {
  ok: boolean
  error?: string
  walls?: DetectedWall[]
  /** габариты обнаруженного плана, м */
  widthM?: number
  heightM?: number
  confidence?: number
}

interface Band {
  start: number
  end: number
  from: number
  to: number
}

function otsu(hist: Float64Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let max = 0
  let thr = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF <= 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > max) {
      max = between
      thr = i
    }
  }
  return thr
}

function findBands(count: Int32Array, thresh: number, minThick: number, maxThick: number): Band[] {
  const bands: Band[] = []
  let start = -1
  const n = count.length
  for (let i = 0; i <= n; i++) {
    const on = i < n && count[i] >= thresh
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      const end = i - 1
      const thick = end - start + 1
      if (thick >= minThick && thick <= maxThick) {
        bands.push({ start, end, from: start, to: end })
      }
      start = -1
    }
  }
  return bands
}

/** диапазон тёмных пикселей вдоль полосы */
function darkExtent(
  dark: Uint8Array,
  w: number,
  h: number,
  horizontal: boolean,
  a0: number,
  a1: number,
  minFrac: number,
): { from: number; to: number } | null {
  let from = -1
  let to = -1
  let cnt = 0
  const len = horizontal ? w : h
  for (let p = 0; p < len; p++) {
    let hit = 0
    let tot = 0
    for (let a = a0; a <= a1; a++) {
      tot++
      const idx = horizontal ? a * w + p : p * w + a
      if (dark[idx]) hit++
    }
    if (hit / Math.max(1, tot) >= minFrac) {
      if (from < 0) from = p
      to = p
      cnt++
    }
  }
  if (from < 0 || cnt / len < 0.15) return null
  return { from, to }
}

function mergeSegs(
  segs: { from: number; to: number; thick: number; center: number }[],
  gapTol: number,
  centerTol: number,
): { from: number; to: number; thick: number; center: number }[] {
  if (segs.length === 0) return []
  const sorted = [...segs].sort((a, b) => a.from - b.from)
  const out: typeof sorted = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const s = sorted[i]
    if (s.center - last.center < centerTol && s.from - last.to < gapTol) {
      last.to = Math.max(last.to, s.to)
      last.thick = Math.max(last.thick, s.thick)
      last.center = (last.from + last.to) / 2
    } else {
      out.push({ ...s })
    }
  }
  return out
}

export function detectPlanWalls(source: HTMLCanvasElement): DetectResult {
  const MAX = 1100
  const sw = source.width
  const sh = source.height
  if (!sw || !sh) return { ok: false, error: 'Пустой документ' }

  const scale = Math.min(1, MAX / Math.max(sw, sh))
  const w = Math.max(64, Math.round(sw * scale))
  const h = Math.max(64, Math.round(sh * scale))

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { ok: false, error: 'Не удалось подготовить изображение' }
  ctx.drawImage(source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const n = w * h

  const gray = new Uint8Array(n)
  const hist = new Float64Array(256)
  for (let i = 0; i < n; i++) {
    const r = d[i * 4]
    const g = d[i * 4 + 1]
    const b = d[i * 4 + 2]
    const v = (0.299 * r + 0.587 * g + 0.114 * b) | 0
    gray[i] = v
    hist[v]++
  }
  const thr = Math.min(180, Math.max(60, otsu(hist, n) + 10))
  const dark = new Uint8Array(n)
  let darkCnt = 0
  for (let i = 0; i < n; i++) {
    if (gray[i] < thr) {
      dark[i] = 1
      darkCnt++
    }
  }
  const darkRatio = darkCnt / n

  // слишком пусто или слишком «фото»
  if (darkRatio < 0.015) {
    return { ok: false, error: 'В документе почти нет тёмных линий — план квартиры не найден' }
  }
  if (darkRatio > 0.72) {
    return { ok: false, error: 'Документ слишком тёмный/залит — это не похожe на чертёж плана' }
  }

  const minThick = Math.max(3, Math.round(Math.min(w, h) * 0.008))
  const maxThick = Math.max(18, Math.round(Math.min(w, h) * 0.09))
  const lineFrac = 0.28

  const rowCount = new Int32Array(h)
  const colCount = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    let r = 0
    for (let x = 0; x < w; x++) r += dark[y * w + x]
    rowCount[y] = r
  }
  for (let x = 0; x < w; x++) {
    let c = 0
    for (let y = 0; y < h; y++) c += dark[y * w + x]
    colCount[x] = c
  }

  const hBands = findBands(rowCount, Math.round(w * lineFrac), minThick, maxThick)
  const vBands = findBands(colCount, Math.round(h * lineFrac), minThick, maxThick)

  if (hBands.length < 2 || vBands.length < 2) {
    return {
      ok: false,
      error: 'Не найдены ортогональные линии стен. В документе нет плана квартиры/помещения.',
    }
  }

  // сегменты стен в пикселях
  const hSegs: { from: number; to: number; thick: number; center: number }[] = []
  for (const b of hBands) {
    const ext = darkExtent(dark, w, h, true, b.start, b.end, 0.5)
    if (!ext) continue
    const len = ext.to - ext.from
    if (len < w * 0.18) continue
    hSegs.push({
      from: ext.from,
      to: ext.to,
      thick: b.end - b.start + 1,
      center: (b.start + b.end) / 2,
    })
  }
  const vSegs: { from: number; to: number; thick: number; center: number }[] = []
  for (const b of vBands) {
    const ext = darkExtent(dark, w, h, false, b.start, b.end, 0.5)
    if (!ext) continue
    const len = ext.to - ext.from
    if (len < h * 0.18) continue
    vSegs.push({
      from: ext.from,
      to: ext.to,
      thick: b.end - b.start + 1,
      center: (b.start + b.end) / 2,
    })
  }

  const hMerged = mergeSegs(hSegs, w * 0.04, maxThick * 1.6)
  const vMerged = mergeSegs(vSegs, h * 0.04, maxThick * 1.6)

  if (hMerged.length < 2 || vMerged.length < 2) {
    return {
      ok: false,
      error: 'Не найден замкнутый контур стен. В документе нет плана квартиры/помещения.',
    }
  }

  // габариты в пикселях
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const s of hMerged) {
    minX = Math.min(minX, s.from)
    maxX = Math.max(maxX, s.to)
    minY = Math.min(minY, s.center - s.thick / 2)
    maxY = Math.max(maxY, s.center + s.thick / 2)
  }
  for (const s of vMerged) {
    minX = Math.min(minX, s.center - s.thick / 2)
    maxX = Math.max(maxX, s.center + s.thick / 2)
    minY = Math.min(minY, s.from)
    maxY = Math.max(maxY, s.to)
  }
  const bw = maxX - minX
  const bh = maxY - minY
  if (bw < 80 || bh < 80) {
    return { ok: false, error: 'Найденные линии слишком малы для плана квартиры' }
  }
  const aspect = bw / bh
  if (aspect < 0.18 || aspect > 5.5) {
    return { ok: false, error: 'Пропорции найденного контура не похожи на план помещения' }
  }

  // масштаб: большая сторона = 12 м (типовая квартира/дом); можно уточнить
  const maxPx = Math.max(bw, bh)
  const mPerPx = 12 / maxPx

  const clampT = (tpx: number) => {
    const t = tpx * mPerPx
    if (!isFinite(t) || t <= 0) return 0.2
    return Math.min(0.45, Math.max(0.1, t))
  }

  const walls: DetectedWall[] = []
  for (const s of hMerged) {
    const len = (s.to - s.from) * mPerPx
    if (len < 1.1) continue
    walls.push({
      x1: (s.from - minX) * mPerPx,
      z1: (s.center - minY) * mPerPx,
      x2: (s.to - minX) * mPerPx,
      z2: (s.center - minY) * mPerPx,
      thickness: clampT(s.thick),
    })
  }
  for (const s of vMerged) {
    const len = (s.to - s.from) * mPerPx
    if (len < 1.1) continue
    walls.push({
      x1: (s.center - minX) * mPerPx,
      z1: (s.from - minY) * mPerPx,
      x2: (s.center - minX) * mPerPx,
      z2: (s.to - minY) * mPerPx,
      thickness: clampT(s.thick),
    })
  }

  if (walls.length < 4) {
    return {
      ok: false,
      error: 'Найдено слишком мало стен (нужно минимум 4). Это не план помещения.',
    }
  }

  // уверенность: насколько контур похож на прямоугольник
  const hasTop = hMerged.some((s) => s.center - minY < bh * 0.15)
  const hasBot = hMerged.some((s) => s.center - minY > bh * 0.85)
  const hasLeft = vMerged.some((s) => s.center - minX < bw * 0.15)
  const hasRight = vMerged.some((s) => s.center - minX > bw * 0.85)
  const closed = [hasTop, hasBot, hasLeft, hasRight].filter(Boolean).length
  const confidence = closed / 4

  if (closed < 3) {
    return {
      ok: false,
      error: 'Не найден замкнутый периметр стен (нужны все четыре стороны). Это не план квартиры.',
    }
  }

  return {
    ok: true,
    walls,
    widthM: bw * mPerPx,
    heightM: bh * mPerPx,
    confidence,
  }
}

/** Файл (PDF или картинка) → canvas первой страницы */
export async function fileToCanvas(file: File, maxSide = 1600): Promise<HTMLCanvasElement> {
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('Не удалось открыть изображение'))
        img.src = url
      })
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.naturalWidth * scale)
      cv.height = Math.round(img.naturalHeight * scale)
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      return cv
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs'
    const pdfjs = (await import(/* @vite-ignore */ pdfUrl)) as {
      GlobalWorkerOptions: { workerSrc: string }
      getDocument: (o: { data: ArrayBuffer }) => {
        promise: Promise<{
          getPage: (n: number) => Promise<{
            getViewport: (o: { scale: number }) => { width: number; height: number }
            render: (o: {
              canvasContext: CanvasRenderingContext2D
              viewport: unknown
            }) => { promise: Promise<void> }
          }>
        }>
      }
    }
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs'
    const buf = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buf }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, maxSide / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return canvas
  }
  throw new Error('Поддержаны PDF, PNG, JPG, WebP')
}
