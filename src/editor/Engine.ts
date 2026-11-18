import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildFurnMesh, furnDef, type FurnData } from './furniture'

export type ToolId =
  | 'select'
  | 'line'
  | 'rect'
  | 'wall'
  | 'pushpull'
  | 'move'
  | 'erase'
  | 'orbit'
  | 'furn'

export interface OpeningData {
  id: string
  type: 'door' | 'window'
  /** отступ центра проёма от начала стены, м */
  offset: number
  width: number
  height: number
  /** подоконник, м от пола; у двери 0 */
  sill: number
}

export interface SelInfo {
  kind: 'wall' | 'solid' | 'opening' | 'furn' | null
  id?: string
  length?: number
  height?: number
  thickness?: number
  area?: number
  openings?: OpeningData[]
  selectedOpeningId?: string | null
  furnType?: string
  furnName?: string
  furnW?: number
  furnD?: number
}

export interface EditorCallbacks {
  onToolChange?: (tool: ToolId) => void
  onVcb?: (text: string) => void
  onHint?: (text: string) => void
  onSelection?: (info: SelInfo) => void
  onHistory?: (canUndo: boolean, canRedo: boolean) => void
  onObjects?: (n: number) => void
  onAxes?: (visible: boolean) => void
}

export interface WallData {
  kind: 'wall'
  id: string
  a: THREE.Vector3
  b: THREE.Vector3
  height: number
  thickness: number
  color: string
  openings: OpeningData[]
}

export interface SolidData {
  kind: 'solid'
  id: string
  points: { x: number; z: number }[]
  height: number
  color: string
}

export type DocObj = WallData | SolidData | FurnData

const GRID_FINE = 0.1
const GRID_AXES = 0.3
const VERTEX_SNAP = 0.25
const DEFAULT_WALL_H = 2.7
const DEFAULT_WALL_T = 0.1
const MIN_T = 0.1

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function round01(v: number): number {
  return Math.round(v * 10) / 10
}

export function round03(v: number): number {
  return Math.round(v / GRID_AXES) * GRID_AXES
}

const HINTS: Record<ToolId, string> = {
  select: 'Кликните стену или дверь/окно. Тяните проём вдоль стены. Del — удалить.',
  line: 'Только по осям: горизонталь и вертикаль. Клик по первой точке или Enter — замкнуть.',
  rect: 'Два клика: первый угол, второй — противоположный. В «Размере» можно ввести «4, 5».',
  wall: 'Стены строго ортогональны. Кликайте углы. Enter / Esc — закончить.',
  pushpull: 'Кликните стену или плоскость и тяните мышь. Высота — кратно 10 см.',
  move: 'Тяните выбранный объект по полу.',
  erase: 'Кликните объект, чтобы удалить.',
  orbit: 'Левая кнопка — орбита. Колесо — зум. Правая — панорама.',
  furn: 'Выберите мебель в каталоге справа и кликните по полу. R — повернуть выбранную.',
}

export class Engine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private ground: THREE.Mesh
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private container: HTMLElement
  private cb: EditorCallbacks
  private raf = 0
  private disposed = false
  private ro: ResizeObserver | null = null

  tool: ToolId = 'wall'
  wallHeight = DEFAULT_WALL_H
  wallThickness = DEFAULT_WALL_T
  wallColor = '#e8e4d9'
  axesVisible = true
  furnType = 'bed-double'

  private objects: DocObj[] = []
  private idToObj = new Map<string, THREE.Object3D>()
  private selectedId: string | null = null
  private selectedOpeningId: string | null = null
  private openingDragged = false
  private undoStack: DocObj[][] = []
  private redoStack: DocObj[][] = []

  private draftPts: THREE.Vector3[] = []
  private draftMesh: THREE.Object3D | null = null
  private pushObj: DocObj | null = null
  private pushH = 0
  private moveLast: THREE.Vector3 | null = null
  private lastDir: THREE.Vector3 | null = null
  private snapMarker: THREE.Mesh
  private axisLineX: THREE.Line
  private axisLineZ: THREE.Line
  private grid1m: THREE.GridHelper
  private grid30: THREE.GridHelper

  constructor(container: HTMLElement, cb: EditorCallbacks = {}) {
    this.container = container
    this.cb = cb

    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    const cv = this.renderer.domElement
    cv.style.display = 'block'
    cv.style.touchAction = 'none'
    container.appendChild(cv)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#dceafc')
    this.scene.fog = new THREE.Fog('#dceafc', 70, 160)

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 500)
    this.camera.position.set(9, 8, 11)

    this.controls = new OrbitControls(this.camera, cv)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 90
    this.controls.target.set(0, 1, 0)
    this.applyMouseMap()

    const hemi = new THREE.HemisphereLight('#eaf3ff', '#8a8478', 0.9)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff6e8', 1.35)
    sun.position.set(14, 20, 10)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -30
    sun.shadow.camera.right = 30
    sun.shadow.camera.top = 30
    sun.shadow.camera.bottom = -30
    sun.shadow.camera.far = 70
    sun.shadow.bias = -0.0004
    this.scene.add(sun)

    const groundGeo = new THREE.PlaneGeometry(400, 400)
    groundGeo.rotateX(-Math.PI / 2)
    this.ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.95 }),
    )
    this.ground.receiveShadow = true
    this.ground.name = 'ground'
    this.scene.add(this.ground)

    this.grid1m = new THREE.GridHelper(80, 80, 0xb8c4d4, 0xd5dde8)
    const gm = this.grid1m.material as THREE.Material
    gm.transparent = true
    gm.opacity = 0.55
    this.scene.add(this.grid1m)

    // оси с шагом 30 см
    this.grid30 = new THREE.GridHelper(60, 200, 0x7aa7e8, 0xa9c6ef)
    const g30 = this.grid30.material as THREE.Material
    g30.transparent = true
    g30.opacity = 0.55
    this.grid30.position.y = 0.001
    this.scene.add(this.grid30)

    const axes = new THREE.AxesHelper(2)
    axes.position.y = 0.002
    this.scene.add(axes)

    this.snapMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#1a73e8', depthTest: false }),
    )
    this.snapMarker.renderOrder = 999
    this.snapMarker.visible = false
    this.scene.add(this.snapMarker)

    this.axisLineX = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-60, 0, 0), new THREE.Vector3(60, 0, 0)]),
      new THREE.LineBasicMaterial({ color: '#e4574c', transparent: true, opacity: 0.9 }),
    )
    this.axisLineX.visible = false
    this.scene.add(this.axisLineX)

    this.axisLineZ = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -60), new THREE.Vector3(0, 0, 60)]),
      new THREE.LineBasicMaterial({ color: '#3aa657', transparent: true, opacity: 0.9 }),
    )
    this.axisLineZ.visible = false
    this.scene.add(this.axisLineZ)

    this.bindEvents()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.setTool('wall')
    this.setAxesVisible(true)
    this.loop()
  }

  private applyMouseMap() {
    this.controls.mouseButtons = {
      LEFT: this.tool === 'orbit' ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE),
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    }
  }

  setTool(t: ToolId) {
    this.cancelDraft()
    this.tool = t
    this.cb.onToolChange?.(t)
    this.cb.onHint?.(HINTS[t])
    this.applyMouseMap()
    this.renderer.domElement.style.cursor = t === 'select' ? 'default' : 'crosshair'
  }

  setAxesVisible(v: boolean) {
    this.axesVisible = v
    this.grid30.visible = v
    this.cb.onAxes?.(v)
  }

  setWallHeight(v: number) {
    this.wallHeight = Math.max(0.1, round01(v))
    const sel = this.getSelected()
    if (sel && sel.kind !== 'furn') {
      sel.height = this.wallHeight
      if (sel.kind === 'wall') this.clampOpenings(sel)
      this.rebuild(sel.id)
      this.historyPush()
      this.emitSelection(sel)
    }
  }

  setWallThickness(v: number) {
    this.wallThickness = Math.max(MIN_T, round01(v))
    const sel = this.getSelected()
    if (sel && sel.kind === 'wall') {
      sel.thickness = this.wallThickness
      this.rebuild(sel.id)
      this.historyPush()
      this.emitSelection(sel)
    }
  }

  setWallColor(c: string) {
    this.wallColor = c
    const sel = this.getSelected()
    if (sel && sel.kind !== 'furn') {
      sel.color = c
      this.rebuild(sel.id)
      this.historyPush()
    }
  }

  getSelected(): DocObj | null {
    if (!this.selectedId) return null
    return this.objects.find((o) => o.id === this.selectedId) ?? null
  }

  setFurnType(type: string) {
    this.furnType = type
    this.setTool('furn')
  }

  rotateSelectedFurn() {
    const sel = this.getSelected()
    if (!sel || sel.kind !== 'furn') return
    this.historyPush()
    sel.rot = (sel.rot + Math.PI / 2) % (Math.PI * 2)
    this.rebuild(sel.id)
    this.emitSelection(sel)
  }

  deleteSelected() {
    if (this.selectedOpeningId) {
      this.removeOpening(this.selectedOpeningId)
      return
    }
    if (!this.selectedId) return
    this.historyPush()
    const id = this.selectedId
    const obj = this.idToObj.get(id)
    if (obj) {
      this.scene.remove(obj)
      this.disposeObj(obj)
      this.idToObj.delete(id)
    }
    this.objects = this.objects.filter((o) => o.id !== id)
    this.select(null)
    this.emitCount()
  }

  addOpening(type: 'door' | 'window') {
    const sel = this.getSelected()
    if (!sel || sel.kind !== 'wall') return
    this.historyPush()
    const L = sel.a.distanceTo(sel.b)
    const isDoor = type === 'door'
    const width = Math.min(isDoor ? 0.9 : 1.2, Math.max(0.3, round01(L * 0.4)))
    const height = isDoor
      ? Math.min(2.1, sel.height)
      : Math.min(1.4, Math.max(0.3, sel.height - 0.9))
    const sill = isDoor ? 0 : Math.min(0.9, Math.max(0, sel.height - height))
    // расставляем по стене
    const n = sel.openings.length
    const offset = round01(Math.min(L - width / 2, Math.max(width / 2, (L * (n + 1)) / (n + 2))))
    const op: OpeningData = {
      id: uid(),
      type,
      offset: round01(offset),
      width: round01(width),
      height: round01(height),
      sill: round01(sill),
    }
    sel.openings.push(op)
    this.clampOpenings(sel)
    this.rebuild(sel.id)
    this.select(sel.id, op.id)
  }

  updateOpening(opId: string, patch: Partial<OpeningData>) {
    const sel = this.getSelected()
    if (!sel || sel.kind !== 'wall') return
    const op = sel.openings.find((o) => o.id === opId)
    if (!op) return
    if (patch.type !== undefined) {
      op.type = patch.type
      if (patch.type === 'door') {
        op.sill = 0
        if (op.height < 1.8) op.height = 2.1
      } else if (op.sill === 0) {
        op.sill = 0.9
      }
    }
    if (patch.offset !== undefined) op.offset = Math.max(0, round01(patch.offset))
    if (patch.width !== undefined) op.width = Math.max(0.3, round01(patch.width))
    if (patch.height !== undefined) op.height = Math.max(0.3, round01(patch.height))
    if (patch.sill !== undefined) op.sill = Math.max(0, round01(patch.sill))
    if (op.type === 'door') op.sill = 0
    this.clampOpenings(sel)
    this.rebuild(sel.id)
    this.emitSelection(sel)
    this.saveLocal()
  }

  removeOpening(opId: string) {
    const sel = this.getSelected()
    if (!sel || sel.kind !== 'wall') return
    this.historyPush()
    sel.openings = sel.openings.filter((o) => o.id !== opId)
    if (this.selectedOpeningId === opId) this.selectedOpeningId = null
    this.rebuild(sel.id)
    this.select(sel.id, this.selectedOpeningId)
  }

  selectOpening(opId: string | null) {
    if (!this.selectedId) return
    const sel = this.getSelected()
    if (!sel || sel.kind !== 'wall') return
    if (opId && !sel.openings.some((o) => o.id === opId)) return
    this.select(sel.id, opId)
  }

  private clampOpenings(w: WallData) {
    const L = w.a.distanceTo(w.b)
    w.height = round01(w.height)
    w.thickness = Math.max(MIN_T, round01(w.thickness))
    for (const op of w.openings) {
      op.width = Math.max(0.3, Math.min(round01(op.width), round01(L)))
      op.height = Math.max(0.3, round01(op.height))
      op.sill = Math.max(0, round01(op.sill))
      if (op.type === 'door') op.sill = 0
      if (op.sill + op.height > w.height) {
        // прижимаем к верху, сохраняя высоту если можно
        if (op.height <= w.height) op.sill = round01(w.height - op.height)
        else {
          op.height = round01(w.height - op.sill)
          if (op.height < 0.3) {
            op.height = round01(w.height)
            op.sill = 0
          }
        }
      }
      op.offset = Math.max(op.width / 2, Math.min(round01(op.offset), round01(L - op.width / 2)))
    }
    // сортировка по отступу
    w.openings.sort((x, y) => x.offset - y.offset)
  }

  undo() {
    if (this.undoStack.length === 0) return
    const cur = this.cloneObjs()
    const snap = this.undoStack.pop()!
    this.restoreObjs(snap)
    this.redoStack.push(cur)
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const cur = this.cloneObjs()
    const snap = this.redoStack.pop()!
    this.restoreObjs(snap)
    this.undoStack.push(cur)
    this.emitHistory()
  }

  applyVcb(raw: string) {
    const text = raw.trim().replace(',', '.')
    if (!text) return
    const parts = text.split(/[\s;]+/).filter(Boolean).map(Number)
    if (
      this.tool === 'rect' &&
      this.draftPts.length === 1 &&
      parts.length >= 2 &&
      isFinite(parts[0]) &&
      isFinite(parts[1])
    ) {
      const a = this.draftPts[0]
      this.draftPts.push(
        new THREE.Vector3(a.x + round03(parts[0]), 0, a.z + round03(parts[1])),
      )
      this.finishRect()
      return
    }
    const n = Number(parts[0])
    if (!isFinite(n) || n <= 0) return

    if ((this.tool === 'wall' || this.tool === 'line') && this.draftPts.length >= 1) {
      const from = this.draftPts[this.draftPts.length - 1]
      const dir = this.lastDir ?? new THREE.Vector3(1, 0, 0)
      // ортогонально: доминирующая ось
      const ax = Math.abs(dir.x) >= Math.abs(dir.z) ? 'x' : 'z'
      const to =
        ax === 'x'
          ? new THREE.Vector3(from.x + round03(dir.x >= 0 ? n : -n), 0, from.z)
          : new THREE.Vector3(from.x, 0, from.z + round03(dir.z >= 0 ? n : -n))
      if (this.tool === 'wall') {
        this.commitWall(from, to)
        this.draftPts = [to]
        this.updateDraft()
      } else {
        this.draftPts.push(to)
        this.updateDraft()
      }
      this.cb.onVcb?.(n.toFixed(2))
      return
    }
    if (this.tool === 'pushpull' && this.pushObj) {
      this.previewPushPull(round01(n))
      this.finishPushPull()
      return
    }
    const sel = this.getSelected()
    if (sel && sel.kind !== 'furn') {
      sel.height = round01(n)
      if (sel.kind === 'wall') this.clampOpenings(sel)
      this.rebuild(sel.id)
      this.historyPush()
      this.emitSelection(sel)
    }
  }

  private underlay: THREE.Mesh | null = null
  private labels: THREE.Sprite[] = []

  newProject() {
    this.clearDoc()
    if (this.underlay) {
      this.scene.remove(this.underlay)
      this.underlay = null
    }
    for (const s of this.labels) {
      this.scene.remove(s)
      const mat = s.material as THREE.SpriteMaterial
      mat.map?.dispose()
      mat.dispose()
    }
    this.labels = []
    this.cb.onHint?.('Новый проект. Нарисуйте стены или соберите сцену из плана.')
  }

  setUnderlay(url: string, widthM = 14, heightM = 10) {
    const loader = new THREE.TextureLoader()
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      if (this.underlay) this.scene.remove(this.underlay)
      const geo = new THREE.PlaneGeometry(widthM, heightM)
      geo.rotateX(-Math.PI / 2)
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.72 })
      this.underlay = new THREE.Mesh(geo, mat)
      this.underlay.position.set(widthM / 2 - 1, 0.006, heightM / 2 - 1)
      this.underlay.renderOrder = -1
      this.scene.add(this.underlay)
    })
  }

  private addLabel(text: string, x: number, z: number) {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 72
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    ctx.beginPath()
    ctx.roundRect(4, 4, 312, 64, 12)
    ctx.fill()
    ctx.fillStyle = '#1c1e21'
    ctx.font = 'bold 26px Inter, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 160, 36)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    spr.scale.set(1.7, 0.38, 1)
    spr.position.set(x, 1.45, z)
    spr.renderOrder = 10
    this.scene.add(spr)
    this.labels.push(spr)
  }

  private addWallAx(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    t: number,
    ops: OpeningData[] = [],
    color = '#e8e4d9',
  ) {
    const w: WallData = {
      kind: 'wall',
      id: uid(),
      a: new THREE.Vector3(ax, 0, az),
      b: new THREE.Vector3(bx, 0, bz),
      height: 2.7,
      thickness: t,
      color,
      openings: ops,
    }
    if (ops.length) this.clampOpenings(w)
    this.objects.push(w)
    this.rebuild(w.id)
    return w
  }

  private addFloorRoom(points: { x: number; z: number }[], color: string) {
    const s: SolidData = {
      kind: 'solid',
      id: uid(),
      points,
      height: 0.04,
      color,
    }
    this.objects.push(s)
    this.rebuild(s.id)
  }

  /** Квартира по обмерному плану projectfortest */
  loadApartmentProject() {
    this.clearDoc()
    if (this.underlay) {
      this.scene.remove(this.underlay)
      this.underlay = null
    }
    for (const s of this.labels) {
      this.scene.remove(s)
    }
    this.labels = []

    const EXT = 0.2
    const INT = 0.1
    const door = (offset: number, w = 0.85, h = 2.1): OpeningData => ({
      id: uid(),
      type: 'door',
      offset,
      width: w,
      height: h,
      sill: 0,
    })
    const win = (offset: number, w = 1.4, h = 1.4, sill = 0.9): OpeningData => ({
      id: uid(),
      type: 'window',
      offset,
      width: w,
      height: h,
      sill,
    })

    // Балкон 5.9 × 1.6
    this.addWallAx(1.2, -1.6, 7.1, -1.6, INT)
    this.addWallAx(1.2, -1.6, 1.2, 0, INT)
    this.addWallAx(7.1, -1.6, 7.1, 0, INT)

    // Север квартиры: два выхода на балкон + окно спальни
    this.addWallAx(0, 0, 11.8, 0, EXT, [
      win(2.7, 1.5, 2.25, 0.05),
      win(4.9, 1.5, 2.25, 0.05),
      win(9.6, 1.6, 1.5, 0.9),
    ])
    // Запад
    this.addWallAx(0, 0, 0, 8.6, EXT)
    // Восток
    this.addWallAx(11.8, 0, 11.8, 8.6, EXT)
    // Юг + вход
    this.addWallAx(0, 8.6, 11.8, 8.6, EXT, [door(7.4, 0.95, 2.1)])

    // Гостиная / спальня перегородка
    this.addWallAx(8.0, 0, 8.0, 6.2, INT, [door(5.3, 0.85, 2.1)])
    // Юг спальни (дверь из коридора)
    this.addWallAx(8.0, 6.2, 11.8, 6.2, INT, [door(0.9, 0.85, 2.1)])
    // Запад ванной
    this.addWallAx(9.2, 6.2, 9.2, 8.6, INT, [door(1.2, 0.75, 2.05)])
    // Санузел: коробка в гостиной у входа
    this.addWallAx(5.6, 5.0, 7.0, 5.0, INT, [door(0.7, 0.7, 2.0)])
    this.addWallAx(5.6, 5.0, 5.6, 6.5, INT)
    this.addWallAx(7.0, 5.0, 7.0, 6.5, INT)
    this.addWallAx(5.6, 6.5, 7.0, 6.5, INT)

    // Полы
    this.addFloorRoom(
      [
        { x: 0.2, z: 0.2 },
        { x: 7.9, z: 0.2 },
        { x: 7.9, z: 8.4 },
        { x: 0.2, z: 8.4 },
      ],
      '#ead9bd',
    )
    this.addFloorRoom(
      [
        { x: 8.2, z: 0.2 },
        { x: 11.6, z: 0.2 },
        { x: 11.6, z: 6.0 },
        { x: 8.2, z: 6.0 },
      ],
      '#cfe0c8',
    )
    this.addFloorRoom(
      [
        { x: 9.35, z: 6.4 },
        { x: 11.6, z: 6.4 },
        { x: 11.6, z: 8.4 },
        { x: 9.35, z: 8.4 },
      ],
      '#bcd8ea',
    )
    this.addFloorRoom(
      [
        { x: 5.75, z: 5.15 },
        { x: 6.9, z: 5.15 },
        { x: 6.9, z: 6.35 },
        { x: 5.75, z: 6.35 },
      ],
      '#c8d8e8',
    )
    this.addFloorRoom(
      [
        { x: 1.3, z: -1.5 },
        { x: 7.0, z: -1.5 },
        { x: 7.0, z: -0.1 },
        { x: 1.3, z: -0.1 },
      ],
      '#d0d8e0',
    )
    this.addFloorRoom(
      [
        { x: 8.1, z: 6.4 },
        { x: 9.2, z: 6.4 },
        { x: 9.2, z: 8.4 },
        { x: 7.3, z: 8.4 },
        { x: 7.3, z: 6.7 },
        { x: 8.1, z: 6.7 },
      ],
      '#ddd8d0',
    )

    this.addLabel('Кухня-гостиная', 4.0, 3.6)
    this.addLabel('Спальня №2', 9.9, 3.0)
    this.addLabel('Ванная', 10.4, 7.4)
    this.addLabel('Санузел', 6.3, 5.75)
    this.addLabel('Балкон', 4.15, -0.8)
    this.addLabel('Прихожая', 8.2, 7.6)
    this.addLabel('Вход ↓', 7.4, 9.2)

    // Основная мебель
    const put = (type: string, x: number, z: number, rotDeg = 0) => {
      const f: FurnData = {
        kind: 'furn',
        id: uid(),
        type,
        x: round01(x),
        z: round01(z),
        rot: (rotDeg * Math.PI) / 180,
      }
      this.objects.push(f)
      this.rebuild(f.id)
    }

    // Кухня-гостиная
    put('kitchen', 1.7, 0.55, 0)
    put('fridge', 3.3, 0.55, 0)
    put('sofa', 2.4, 6.8, 0)
    put('table-coffee', 2.4, 5.4, 0)
    put('table-dine', 5.6, 3.2, 0)
    put('chair', 5.0, 2.5, 0)
    put('chair', 6.2, 2.5, 0)
    put('chair', 5.0, 3.9, 180)
    put('chair', 6.2, 3.9, 180)
    put('tv-stand', 5.8, 0.55, 0)

    // Спальня
    put('bed-double', 9.9, 1.4, 0)
    put('nightstand', 8.9, 0.55, 0)
    put('nightstand', 10.9, 0.55, 0)
    put('wardrobe', 9.9, 5.55, 180)

    // Ванная
    put('bath', 10.7, 7.4, 90)
    put('sink', 9.7, 6.7, 0)
    put('toilet', 9.6, 7.9, 180)

    // Санузел
    put('toilet', 6.3, 5.5, 180)
    put('sink', 6.3, 6.1, 0)

    // Прихожая
    put('wardrobe-hall', 8.4, 8.25, 0)
    put('shoe', 7.5, 7.0, 90)

    this.emitCount()
    this.historyPush()
    this.frameAll()
    this.cb.onHint?.('Сцена собрана по обмерному плану. Проёмы можно тянуть.')
  }

  serialize(): string {
    return JSON.stringify(
      {
        version: 2,
        wallHeight: this.wallHeight,
        wallThickness: this.wallThickness,
        wallColor: this.wallColor,
        axesVisible: this.axesVisible,
        objects: this.objects.map((o) =>
          o.kind === 'wall'
            ? {
                ...o,
                a: o.a.toArray(),
                b: o.b.toArray(),
                openings: o.openings.map((op) => ({ ...op })),
              }
            : o.kind === 'furn'
              ? { ...o }
              : { ...o, points: o.points.map((p) => ({ ...p })) },
        ),
      },
      null,
      2,
    )
  }

  load(json: string): boolean {
    try {
      const data = JSON.parse(json)
      if (!data || !Array.isArray(data.objects)) return false
      this.clearDocQuiet()
      for (const raw of data.objects) {
        if (raw.a && raw.b) {
          const w: WallData = {
            kind: 'wall',
            id: raw.id ?? uid(),
            a: new THREE.Vector3().fromArray(raw.a),
            b: new THREE.Vector3().fromArray(raw.b),
            height: raw.height ?? DEFAULT_WALL_H,
            thickness: raw.thickness ?? DEFAULT_WALL_T,
            color: raw.color ?? this.wallColor,
            openings: Array.isArray(raw.openings) ? raw.openings : [],
          }
          this.clampOpenings(w)
          this.objects.push(w)
          this.rebuild(w.id)
        } else if (Array.isArray(raw.points) && raw.points.length >= 3) {
          const s: SolidData = {
            kind: 'solid',
            id: raw.id ?? uid(),
            points: raw.points,
            height: raw.height ?? 0.1,
            color: raw.color ?? '#dbe4ee',
          }
          this.objects.push(s)
          this.rebuild(s.id)
        } else if (raw.kind === 'furn' && raw.type) {
          const f: FurnData = {
            kind: 'furn',
            id: raw.id ?? uid(),
            type: raw.type,
            x: raw.x ?? 0,
            z: raw.z ?? 0,
            rot: raw.rot ?? 0,
          }
          this.objects.push(f)
          this.rebuild(f.id)
        }
      }
      if (typeof data.wallHeight === 'number') this.wallHeight = round01(data.wallHeight)
      if (typeof data.wallThickness === 'number') this.wallThickness = round01(data.wallThickness)
      if (typeof data.wallColor === 'string') this.wallColor = data.wallColor
      if (typeof data.axesVisible === 'boolean') this.setAxesVisible(data.axesVisible)
      this.undoStack = []
      this.redoStack = []
      this.emitHistory()
      this.emitCount()
      this.frameAll()
      return true
    } catch {
      return false
    }
  }

  clearDoc() {
    this.clearDocQuiet()
    this.undoStack = []
    this.redoStack = []
    this.emitHistory()
    this.emitCount()
  }

  frameAll() {
    if (this.objects.length === 0) {
      this.camera.position.set(9, 8, 11)
      this.controls.target.set(0, 1, 0)
      this.controls.update()
      return
    }
    const box = new THREE.Box3()
    for (const m of this.idToObj.values()) box.expandByObject(m)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length() || 5
    const dir = new THREE.Vector3(1, 0.75, 1).normalize()
    this.camera.position.copy(center).add(dir.multiplyScalar(size * 1.15 + 2))
    this.controls.target.copy(center)
    this.controls.update()
  }

  restoreLocal(): boolean {
    try {
      const j = localStorage.getItem('planup.doc')
      if (!j) return false
      return this.load(j)
    } catch {
      return false
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.controls.dispose()
    this.unbindEvents()
    for (const m of this.idToObj.values()) this.disposeObj(m)
    this.idToObj.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ----- history -----

  private cloneObjs(): DocObj[] {
    return this.objects.map((o) =>
      o.kind === 'wall'
        ? { ...o, a: o.a.clone(), b: o.b.clone(), openings: o.openings.map((op) => ({ ...op })) }
        : o.kind === 'solid'
          ? { ...o, points: o.points.map((p) => ({ ...p })) }
          : { ...o },
    )
  }

  private restoreObjs(objs: DocObj[]) {
    for (const m of this.idToObj.values()) {
      this.scene.remove(m)
      this.disposeObj(m)
    }
    this.idToObj.clear()
    this.objects = objs
    for (const o of objs) this.rebuild(o.id)
    this.select(null)
    this.emitCount()
    this.saveLocal()
  }

  private historyPush() {
    this.undoStack.push(this.cloneObjs())
    if (this.undoStack.length > 50) this.undoStack.shift()
    this.redoStack = []
    this.emitHistory()
    this.saveLocal()
  }

  private emitHistory() {
    this.cb.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0)
  }

  private emitCount() {
    this.cb.onObjects?.(this.objects.length)
  }

  private emitSelection(obj?: DocObj | null) {
    if (!obj || this.selectedId !== obj.id) {
      if (!obj) this.cb.onSelection?.({ kind: null })
      return
    }
    if (obj.kind === 'wall') {
      this.cb.onSelection?.({
        kind: this.selectedOpeningId ? 'opening' : 'wall',
        id: obj.id,
        length: obj.a.distanceTo(obj.b),
        height: obj.height,
        thickness: obj.thickness,
        openings: obj.openings.map((o) => ({ ...o })),
        selectedOpeningId: this.selectedOpeningId,
      })
    } else if (obj.kind === 'furn') {
      const def = furnDef(obj.type)
      this.cb.onSelection?.({
        kind: 'furn',
        id: obj.id,
        height: def.h,
        furnType: obj.type,
        furnName: def.name,
        furnW: def.w,
        furnD: def.d,
      })
    } else {
      this.cb.onSelection?.({
        kind: 'solid',
        id: obj.id,
        height: obj.height,
        area: Math.abs(this.polygonArea(obj.points)),
      })
    }
  }

  private saveLocal() {
    try {
      localStorage.setItem('planup.doc', this.serialize())
    } catch {
      /* quota */
    }
  }

  private clearDocQuiet() {
    for (const m of this.idToObj.values()) {
      this.scene.remove(m)
      this.disposeObj(m)
    }
    this.idToObj.clear()
    this.objects = []
    this.select(null)
  }

  // ----- events -----

  private bindEvents() {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('dblclick', this.onDblClick)
    el.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
  }

  private unbindEvents() {
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('dblclick', this.onDblClick)
    el.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  private onContextMenu = (e: MouseEvent) => e.preventDefault()

  private resize() {
    if (this.disposed) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'Escape') {
      this.cancelDraft()
      this.select(null)
    } else if (e.key === 'Enter') {
      if (this.tool === 'line' || this.tool === 'wall') this.finishPolyline()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key.toLowerCase() === 'g') {
        this.setAxesVisible(!this.axesVisible)
        return
      }
      // R — повернуть мебель, если выбрана
      if (e.key.toLowerCase() === 'r' && this.getSelected()?.kind === 'furn') {
        this.rotateSelectedFurn()
        return
      }
      const map: Record<string, ToolId> = {
        s: 'select', л: 'select',
        l: 'line', д: 'line',
        r: 'rect', к: 'rect',
        w: 'wall', ц: 'wall',
        p: 'pushpull', з: 'pushpull',
        m: 'move', ь: 'move',
        e: 'erase', у: 'erase',
        o: 'orbit', щ: 'orbit',
        f: 'furn', а: 'furn',
      }
      const t = map[e.key.toLowerCase()]
      if (t) this.setTool(t)
    }
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  private pickGround(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.ground, false)
    return hits.length ? hits[0].point.clone() : null
  }

  private pickObject(): THREE.Object3D | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const roots = [...this.idToObj.values()]
    const hits = this.raycaster.intersectObjects(roots, true)
    if (!hits.length) return null
    const hit = hits[0].object
    // проём — отдельный объект, даже если он внутри группы стены
    if (hit.userData.openingId) return hit
    let o: THREE.Object3D | null = hit
    while (o && !o.userData.id) o = o.parent
    return o ?? hit
  }

  private quantPlan(v: number): number {
    return this.axesVisible ? round03(v) : Math.round(v / GRID_FINE) * GRID_FINE
  }

  /** ортогональный луч от from к сырому курсору */
  private ortho(from: THREE.Vector3, raw: THREE.Vector3): { p: THREE.Vector3; axis: 'x' | 'z' } {
    const dx = raw.x - from.x
    const dz = raw.z - from.z
    if (Math.abs(dx) >= Math.abs(dz)) {
      return { p: new THREE.Vector3(this.quantPlan(raw.x), 0, from.z), axis: 'x' }
    }
    return { p: new THREE.Vector3(from.x, 0, this.quantPlan(raw.z)), axis: 'z' }
  }

  private snap(raw: THREE.Vector3): { p: THREE.Vector3; axis: 'x' | 'z' | null } {
    const p = raw.clone()
    p.x = this.quantPlan(p.x)
    p.z = this.quantPlan(p.z)
    p.y = 0

    let best: THREE.Vector3 | null = null
    let bestD = VERTEX_SNAP
    for (const o of this.objects) {
      const vs =
        o.kind === 'wall'
          ? [o.a, o.b]
          : o.kind === 'solid'
            ? o.points.map((q) => new THREE.Vector3(q.x, 0, q.z))
            : []
      for (const v of vs) {
        const d = Math.hypot(v.x - p.x, v.z - p.z)
        if (d < bestD) {
          bestD = d
          best = v.clone()
        }
      }
    }
    if (best) return { p: best.setY(0), axis: null }

    if (this.draftPts.length > 0) {
      const last = this.draftPts[this.draftPts.length - 1]
      // строго ортогонально
      const o = this.ortho(last, p)
      return { p: o.p, axis: o.axis }
    }
    return { p, axis: null }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    this.updatePointer(e)
    const t = this.tool
    if (t === 'orbit') return

    if (t === 'furn') {
      const raw = this.pickGround()
      if (!raw) return
      const p = raw.clone()
      p.x = this.quantPlan(p.x)
      p.z = this.quantPlan(p.z)
      this.historyPush()
      const f: FurnData = {
        kind: 'furn',
        id: uid(),
        type: this.furnType,
        x: p.x,
        z: p.z,
        rot: 0,
      }
      this.objects.push(f)
      this.rebuild(f.id)
      this.select(f.id)
      this.emitCount()
      return
    }

    if (t === 'select' || t === 'erase') {
      const obj = this.pickObject()
      if (!obj) {
        this.select(null)
        return
      }
      const id = obj.userData.id as string
      const opId = (obj.userData.openingId as string | undefined) ?? null
      if (t === 'erase') {
        this.selectedId = id
        this.selectedOpeningId = opId
        this.deleteSelected()
        return
      }
      this.select(id, opId)
      // сразу можно тянуть проём или мебель инструментом «Выбор»
      if (opId || obj.userData.kind === 'furn') this.moveLast = this.pickGround()
      return
    }

    if (t === 'move') {
      const obj = this.pickObject()
      if (!obj) {
        this.select(null)
        return
      }
      const id = obj.userData.id as string
      const opId = (obj.userData.openingId as string | undefined) ?? null
      this.select(id, opId)
      const p = this.pickGround()
      if (p) this.moveLast = p
      return
    }

    if (t === 'line' || t === 'wall') {
      const raw = this.pickGround()
      if (!raw) return
      const { p, axis } = this.snap(raw)
      this.showSnap(p, axis)
      if (this.draftPts.length === 0) {
        this.draftPts.push(p)
        this.updateDraft()
        return
      }
      const last = this.draftPts[this.draftPts.length - 1]
      const d = Math.hypot(p.x - last.x, p.z - last.z)
      if (d < 0.05) return
      if (this.draftPts.length >= 3 && p.distanceTo(this.draftPts[0]) < VERTEX_SNAP) {
        if (this.tool === 'wall') this.commitWall(last, this.draftPts[0])
        this.finishPolyline()
        return
      }
      if (this.tool === 'wall') {
        this.commitWall(last, p)
        this.draftPts = [p]
        this.updateDraft()
        this.cb.onVcb?.(d.toFixed(2))
      } else {
        this.draftPts.push(p)
        this.updateDraft()
        this.cb.onVcb?.(d.toFixed(2))
      }
      return
    }

    if (t === 'rect') {
      const raw = this.pickGround()
      if (!raw) return
      const { p } = this.snap(raw)
      if (this.draftPts.length === 0) {
        this.draftPts.push(p)
        this.updateDraft()
      } else {
        this.draftPts.push(p)
        this.finishRect()
      }
      return
    }

    if (t === 'pushpull') {
      const obj = this.pickObject()
      if (!obj) return
      const doc = this.objects.find((o) => o.id === obj.userData.id)
      if (!doc || doc.kind === 'furn') return
      this.select(doc.id)
      this.pushObj = doc
      this.pushH = doc.height
      this.cb.onHint?.('Тяните мышь вверх/вниз. Высота кратно 10 см. Клик — зафиксировать.')
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e)
    const t = this.tool

    if ((t === 'line' || t === 'wall' || t === 'rect') && this.draftPts.length > 0) {
      const raw = this.pickGround()
      if (!raw) return
      const { p, axis } = this.snap(raw)
      this.showSnap(p, axis)
      const last = this.draftPts[this.draftPts.length - 1]
      const dir = new THREE.Vector3(p.x - last.x, 0, p.z - last.z)
      if (dir.lengthSq() > 0.0001) this.lastDir = dir.clone().normalize()
      const len = Math.hypot(p.x - last.x, p.z - last.z)
      this.cb.onVcb?.(len.toFixed(2))
      this.updateDraft(p)
      return
    }

    if (t === 'pushpull' && this.pushObj && e.buttons & 1) {
      const rawH = this.pushH - e.movementY * 0.015
      const h = Math.max(0.1, round01(rawH))
      this.previewPushPull(h)
      this.cb.onVcb?.(h.toFixed(1) + ' м')
      return
    }

    if ((t === 'move' || t === 'select') && this.selectedId && this.moveLast && e.buttons & 1) {
      const raw = this.pickGround()
      if (!raw) return
      const obj = this.getSelected()
      if (!obj) return

      // перетаскивание мебели, шаг 10 см
      if (obj.kind === 'furn') {
        obj.x = this.quantPlan(raw.x)
        obj.z = this.quantPlan(raw.z)
        this.rebuild(obj.id)
        this.emitSelection(obj)
        return
      }

      // перетаскивание проёма вдоль стены, шаг 10 см
      if (this.selectedOpeningId && obj.kind === 'wall') {
        const op = obj.openings.find((o) => o.id === this.selectedOpeningId)
        if (!op) return
        const dir = new THREE.Vector3().subVectors(obj.b, obj.a).normalize()
        const L = obj.a.distanceTo(obj.b)
        const along = new THREE.Vector3().subVectors(raw, obj.a).dot(dir)
        const next = Math.max(op.width / 2, Math.min(round01(along), round01(L - op.width / 2)))
        if (Math.abs(next - op.offset) < 0.001) return
        op.offset = next
        this.clampOpenings(obj)
        this.rebuild(obj.id)
        this.emitSelection(obj)
        this.moveLast = raw
        this.openingDragged = true
        return
      }

      const dx = this.quantPlan(raw.x) - this.quantPlan(this.moveLast.x)
      const dz = this.quantPlan(raw.z) - this.quantPlan(this.moveLast.z)
      if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return
      if (obj.kind === 'wall') {
        // двигаем только по одной оси — сохраняем ортогональность
        if (Math.abs(dx) >= Math.abs(dz)) {
          this.translateWall(obj, dx, 0)
        } else {
          this.translateWall(obj, 0, dz)
        }
      } else {
        for (const p of obj.points) {
          p.x += dx
          p.z += dz
        }
        this.rebuild(obj.id)
      }
      this.moveLast = raw
      return
    }

    if (t === 'select' || t === 'erase' || t === 'pushpull') {
      const obj = this.pickObject()
      this.renderer.domElement.style.cursor = obj
        ? 'pointer'
        : t === 'select'
          ? 'default'
          : 'crosshair'
    }
  }

  private translateWall(w: WallData, dx: number, dz: number) {
    w.a.x += dx
    w.a.z += dz
    w.b.x += dx
    w.b.z += dz
    this.rebuild(w.id)
  }

  private onPointerUp = () => {
    if (this.tool === 'pushpull' && this.pushObj) {
      this.finishPushPull()
    }
    if (this.openingDragged) {
      this.openingDragged = false
      this.historyPush()
    }
    if (this.tool === 'move' && this.selectedId) {
      this.moveLast = null
      this.historyPush()
    }
  }

  private onDblClick = () => {
    if (this.tool === 'line' || this.tool === 'wall') this.finishPolyline()
  }

  private showSnap(p: THREE.Vector3, axis: 'x' | 'z' | null) {
    this.snapMarker.position.copy(p).setY(0.03)
    this.snapMarker.visible = true
    this.axisLineX.visible = axis === 'x'
    this.axisLineZ.visible = axis === 'z'
    if (axis === 'x') this.axisLineX.position.z = p.z
    if (axis === 'z') this.axisLineZ.position.x = p.x
  }

  private hideSnap() {
    this.snapMarker.visible = false
    this.axisLineX.visible = false
    this.axisLineZ.visible = false
  }

  private updateDraft(hover?: THREE.Vector3) {
    if (this.draftMesh) {
      this.scene.remove(this.draftMesh)
      this.disposeObj(this.draftMesh)
      this.draftMesh = null
    }
    const pts = [...this.draftPts]
    if (hover) pts.push(hover)
    if (pts.length === 0) return

    if (this.tool === 'rect' && this.draftPts.length === 1 && hover) {
      const a = this.draftPts[0]
      const b = hover
      const w = Math.max(0.01, Math.abs(b.x - a.x))
      const d = Math.max(0.01, Math.abs(b.z - a.z))
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.02, d),
        new THREE.MeshBasicMaterial({ color: '#1a73e8', transparent: true, opacity: 0.3 }),
      )
      mesh.position.set((a.x + b.x) / 2, 0.01, (a.z + b.z) / 2)
      this.draftMesh = mesh
      this.scene.add(mesh)
      return
    }

    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map((p) => new THREE.Vector3(p.x, 0.02, p.z)),
    )
    this.draftMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#1a73e8' }))
    this.scene.add(this.draftMesh)
  }

  private finishPolyline() {
    if (this.tool === 'line' && this.draftPts.length >= 3) {
      const pts = this.draftPts.map((p) => ({ x: +p.x.toFixed(3), z: +p.z.toFixed(3) }))
      const f = pts[0]
      const l = pts[pts.length - 1]
      if (Math.hypot(f.x - l.x, f.z - l.z) < 0.01) pts.pop()
      if (pts.length >= 3) {
        this.historyPush()
        const s: SolidData = {
          kind: 'solid',
          id: uid(),
          points: pts,
          height: 0.1,
          color: '#dbe4ee',
        }
        this.objects.push(s)
        this.rebuild(s.id)
        this.select(s.id)
        this.emitCount()
        this.cb.onHint?.('Плоскость готова. Возьмите Push/Pull и выдавите вверх.')
      }
    }
    this.cancelDraft()
  }

  private finishRect() {
    if (this.draftPts.length < 2) {
      this.cancelDraft()
      return
    }
    const a = this.draftPts[0]
    const b = this.draftPts[1]
    const pts = [
      { x: +a.x.toFixed(3), z: +a.z.toFixed(3) },
      { x: +b.x.toFixed(3), z: +a.z.toFixed(3) },
      { x: +b.x.toFixed(3), z: +b.z.toFixed(3) },
      { x: +a.x.toFixed(3), z: +b.z.toFixed(3) },
    ]
    this.historyPush()
    const s: SolidData = {
      kind: 'solid',
      id: uid(),
      points: pts,
      height: 0.1,
      color: '#dbe4ee',
    }
    this.objects.push(s)
    this.rebuild(s.id)
    this.select(s.id)
    this.emitCount()
    this.cb.onHint?.('Плоскость готова. Push/Pull — выдавить в объём.')
    this.cancelDraft()
  }

  private commitWall(a: THREE.Vector3, b: THREE.Vector3) {
    this.historyPush()
    const w: WallData = {
      kind: 'wall',
      id: uid(),
      a: a.clone(),
      b: b.clone(),
      height: this.wallHeight,
      thickness: this.wallThickness,
      color: this.wallColor,
      openings: [],
    }
    this.objects.push(w)
    this.rebuild(w.id)
    this.emitCount()
  }

  private cancelDraft() {
    this.draftPts = []
    this.pushObj = null
    if (this.draftMesh) {
      this.scene.remove(this.draftMesh)
      this.disposeObj(this.draftMesh)
      this.draftMesh = null
    }
    this.hideSnap()
    this.moveLast = null
  }

  private previewPushPull(h: number) {
    if (!this.pushObj || this.pushObj.kind === 'furn') return
    this.pushObj.height = round01(h)
    if (this.pushObj.kind === 'wall') this.clampOpenings(this.pushObj)
    this.rebuild(this.pushObj.id)
    this.emitSelection(this.pushObj)
  }

  private finishPushPull() {
    if (!this.pushObj) return
    this.historyPush()
    this.emitSelection(this.pushObj)
    this.pushObj = null
    this.cb.onHint?.('Высота применена. Панель справа обновлена.')
  }

  private select(id: string | null, openingId: string | null = null) {
    for (const m of this.idToObj.values()) {
      m.traverse((c) => {
        const mesh = c as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined
        if (mat && mat.emissive) mat.emissive.setHex(0x000000)
        if (mat && mesh.userData.openingId) {
          // вернуть обычный вид проёма
          if (mesh.userData.kind === 'opening-door') mat.color.setHex(0x8a6b4a)
          if (mesh.userData.kind === 'opening-window') mat.color.setHex(0x9ec9e8)
        }
      })
    }
    this.selectedId = id
    this.selectedOpeningId = openingId
    if (!id) {
      this.cb.onSelection?.({ kind: null })
      return
    }
    const obj = this.objects.find((o) => o.id === id)
    const root = this.idToObj.get(id)
    if (root) {
      root.traverse((c) => {
        const mesh = c as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined
        if (!mat || !mat.emissive) return
        if (mesh.userData.openingId) {
          // подсветка выбранного проёма — как у стены
          if (mesh.userData.openingId === openingId) {
            mat.emissive.setHex(0x1a73e8).multiplyScalar(0.45)
            mat.color.setHex(0x1a73e8)
          }
        } else {
          mat.emissive.setHex(0x1a73e8).multiplyScalar(0.22)
        }
      })
    }
    this.emitSelection(obj ?? null)
  }

  private polygonArea(pts: { x: number; z: number }[]): number {
    let s = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      s += a.x * b.z - b.x * a.z
    }
    return s / 2
  }

  /** стена как набор боксов: простенки + перемычки + подоконные части */
  private buildWallMesh(w: WallData): THREE.Group {
    const group = new THREE.Group()
    const dir = new THREE.Vector3().subVectors(w.b, w.a)
    const L = Math.max(0.01, dir.length())
    const angle = -Math.atan2(dir.z, dir.x)
    const mid0 = new THREE.Vector3((w.a.x + w.b.x) / 2, 0, (w.a.z + w.b.z) / 2)

    const addBox = (start: number, len: number, y0: number, h: number) => {
      if (len < 0.005 || h < 0.005) return
      const geo = new THREE.BoxGeometry(len, h, w.thickness)
      const mat = new THREE.MeshStandardMaterial({
        color: w.color,
        roughness: 0.85,
        metalness: 0.02,
      })
      const mesh = new THREE.Mesh(geo, mat)
      // локально вдоль X, потом поворот
      const cx = start + len / 2 - L / 2
      mesh.position.set(cx, y0 + h / 2, 0)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.id = w.id
      mesh.userData.kind = 'wall'
      group.add(mesh)
    }

    const ops = [...w.openings].sort((a, b) => a.offset - b.offset)
    let cursor = 0
    for (const op of ops) {
      const start = Math.max(0, op.offset - op.width / 2)
      const end = Math.min(L, op.offset + op.width / 2)
      if (start > cursor + 0.005) {
        addBox(cursor, start - cursor, 0, w.height)
      }
      const top = Math.min(op.sill + op.height, w.height)
      const lintelH = w.height - top
      if (lintelH > 0.01) {
        addBox(start, end - start, top, lintelH)
      }
      if (op.sill > 0.01) {
        addBox(start, end - start, 0, op.sill)
      }
      // видимая панель проёма — её можно выбрать и тянуть
      const panelW = Math.max(0.02, end - start)
      const panelH = Math.max(0.02, top - op.sill)
      const isDoor = op.type === 'door'
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(panelW, panelH, Math.max(0.04, w.thickness * 0.55)),
        new THREE.MeshStandardMaterial({
          color: isDoor ? 0x8a6b4a : 0x9ec9e8,
          roughness: isDoor ? 0.7 : 0.25,
          metalness: isDoor ? 0.05 : 0.15,
          transparent: !isDoor,
          opacity: isDoor ? 1 : 0.75,
        }),
      )
      panel.position.set(op.offset - L / 2, op.sill + panelH / 2, 0)
      panel.castShadow = true
      panel.userData.id = w.id
      panel.userData.openingId = op.id
      panel.userData.kind = isDoor ? 'opening-door' : 'opening-window'
      group.add(panel)
      cursor = Math.max(cursor, end)
    }
    if (cursor < L - 0.005) {
      addBox(cursor, L - cursor, 0, w.height)
    }

    group.position.copy(mid0)
    group.rotation.y = angle
    group.userData.id = w.id
    group.userData.kind = 'wall'
    return group
  }

  private rebuild(id: string) {
    const obj = this.objects.find((o) => o.id === id)
    if (!obj) return
    const old = this.idToObj.get(id)
    if (old) {
      this.scene.remove(old)
      this.disposeObj(old)
      this.idToObj.delete(id)
    }
    let root: THREE.Object3D
    if (obj.kind === 'wall') {
      root = this.buildWallMesh(obj)
    } else if (obj.kind === 'furn') {
      root = buildFurnMesh(obj)
    } else {
      const shape = new THREE.Shape(obj.points.map((p) => new THREE.Vector2(p.x, -p.z)))
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.01, obj.height),
        bevelEnabled: false,
      })
      geo.rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: obj.color,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.id = obj.id
      mesh.userData.kind = 'solid'
      root = mesh
    }
    root.userData.id = obj.id
    this.scene.add(root)
    this.idToObj.set(obj.id, root)
    if (this.selectedId === id) {
      root.traverse((c) => {
        const mesh = c as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined
        if (!mat || !mat.emissive) return
        if (mesh.userData.openingId) {
          if (mesh.userData.openingId === this.selectedOpeningId) {
            mat.emissive.setHex(0x1a73e8).multiplyScalar(0.45)
          }
        } else {
          mat.emissive.setHex(0x1a73e8).multiplyScalar(0.22)
        }
      })
    }
  }

  private disposeObj(m: THREE.Object3D) {
    m.traverse((c) => {
      const mesh = c as THREE.Mesh
      mesh.geometry?.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
