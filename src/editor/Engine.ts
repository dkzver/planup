import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type ToolId =
  | 'select'
  | 'line'
  | 'rect'
  | 'wall'
  | 'pushpull'
  | 'move'
  | 'erase'
  | 'orbit'

export interface SelInfo {
  kind: 'wall' | 'solid' | null
  id?: string
  length?: number
  height?: number
  thickness?: number
  area?: number
}

export interface EditorCallbacks {
  onToolChange?: (tool: ToolId) => void
  onVcb?: (text: string) => void
  onHint?: (text: string) => void
  onSelection?: (info: SelInfo) => void
  onHistory?: (canUndo: boolean, canRedo: boolean) => void
  onObjects?: (n: number) => void
}

export interface WallData {
  kind: 'wall'
  id: string
  a: THREE.Vector3
  b: THREE.Vector3
  height: number
  thickness: number
  color: string
}

export interface SolidData {
  kind: 'solid'
  id: string
  points: { x: number; z: number }[]
  height: number
  color: string
}

export type DocObj = WallData | SolidData

const GRID = 0.1
const VERTEX_SNAP = 0.25
const DEFAULT_WALL_H = 2.7
const DEFAULT_WALL_T = 0.1

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

const HINTS: Record<ToolId, string> = {
  select: 'Кликните объект. Del — удалить. Перетаскивание инструментом «Переместить».',
  line: 'Кликните точки контура. Клик по первой точке или Enter — замкнуть в плоскость. Esc — отмена.',
  rect: 'Два клика: первый угол, второй — противоположный. В поле «Размер» можно ввести «4, 5».',
  wall: 'Кликайте углы. Каждая линия — стена. Enter / Esc — закончить цепочку.',
  pushpull: 'Кликните плоскость или стену и тяните мышь вверх/вниз. Введите высоту в «Размер».',
  move: 'Тяните выбранный объект по полу.',
  erase: 'Кликните объект, чтобы удалить.',
  orbit: 'Левая кнопка — орбита. Колесо — зум. Правая — панорама.',
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

  private objects: DocObj[] = []
  private idToMesh = new Map<string, THREE.Mesh>()
  private selectedId: string | null = null
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

    const grid = new THREE.GridHelper(80, 80, 0xb8c4d4, 0xd5dde8)
    const gm = grid.material as THREE.Material
    gm.transparent = true
    gm.opacity = 0.7
    this.scene.add(grid)

    const gridFine = new THREE.GridHelper(8, 80, 0xc9d4e3, 0xe6edf5)
    const gfm = gridFine.material as THREE.Material
    gfm.transparent = true
    gfm.opacity = 0.4
    this.scene.add(gridFine)

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

  setWallHeight(v: number) {
    this.wallHeight = THREE.MathUtils.clamp(v, 0.1, 8)
    const sel = this.getSelected()
    if (sel) {
      sel.height = this.wallHeight
      this.rebuild(sel.id)
      this.historyPush()
    }
  }

  setWallThickness(v: number) {
    this.wallThickness = THREE.MathUtils.clamp(v, 0.02, 2)
    const sel = this.getSelected()
    if (sel && sel.kind === 'wall') {
      sel.thickness = this.wallThickness
      this.rebuild(sel.id)
      this.historyPush()
    }
  }

  setWallColor(c: string) {
    this.wallColor = c
    const sel = this.getSelected()
    if (sel) {
      sel.color = c
      this.rebuild(sel.id)
      this.historyPush()
    }
  }

  getSelected(): DocObj | null {
    if (!this.selectedId) return null
    return this.objects.find((o) => o.id === this.selectedId) ?? null
  }

  deleteSelected() {
    if (!this.selectedId) return
    this.historyPush()
    const id = this.selectedId
    const mesh = this.idToMesh.get(id)
    if (mesh) {
      this.scene.remove(mesh)
      this.disposeObj(mesh)
      this.idToMesh.delete(id)
    }
    this.objects = this.objects.filter((o) => o.id !== id)
    this.select(null)
    this.emitCount()
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
    if (this.tool === 'rect' && this.draftPts.length === 1 && parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) {
      const a = this.draftPts[0]
      this.draftPts.push(new THREE.Vector3(a.x + parts[0], 0, a.z + parts[1]))
      this.finishRect()
      return
    }
    const n = Number(parts[0])
    if (!isFinite(n) || n <= 0) return

    if ((this.tool === 'wall' || this.tool === 'line') && this.draftPts.length >= 1) {
      const from = this.draftPts[this.draftPts.length - 1]
      const dir = this.lastDir ?? new THREE.Vector3(1, 0, 0)
      const to = from.clone().add(dir.clone().setLength(n))
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
      this.previewPushPull(n)
      this.finishPushPull()
      return
    }
    const sel = this.getSelected()
    if (sel) {
      sel.height = n
      this.rebuild(sel.id)
      this.historyPush()
    }
  }

  loadExampleRoom() {
    this.historyPush()
    this.clearDocQuiet()
    const floor: SolidData = {
      kind: 'solid',
      id: uid(),
      points: [
        { x: -2, z: -2.5 },
        { x: 2, z: -2.5 },
        { x: 2, z: 2.5 },
        { x: -2, z: 2.5 },
      ],
      height: 0.08,
      color: '#c8b89a',
    }
    this.objects.push(floor)
    this.rebuild(floor.id)

    const segs: [number, number, number, number][] = [
      [-2, -2.5, 2, -2.5],
      [2, -2.5, 2, 2.5],
      [2, 2.5, 0.6, 2.5],
      [-0.6, 2.5, -2, 2.5],
      [-2, 2.5, -2, -2.5],
    ]
    for (const [x1, z1, x2, z2] of segs) {
      const w: WallData = {
        kind: 'wall',
        id: uid(),
        a: new THREE.Vector3(x1, 0, z1),
        b: new THREE.Vector3(x2, 0, z2),
        height: 2.7,
        thickness: 0.12,
        color: '#e8e4d9',
      }
      this.objects.push(w)
      this.rebuild(w.id)
    }
    this.emitCount()
    this.frameAll()
  }

  serialize(): string {
    return JSON.stringify(
      {
        version: 1,
        wallHeight: this.wallHeight,
        wallThickness: this.wallThickness,
        wallColor: this.wallColor,
        objects: this.objects.map((o) =>
          o.kind === 'wall'
            ? { ...o, a: o.a.toArray(), b: o.b.toArray() }
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
          }
          this.objects.push(w)
          this.rebuild(w.id)
        } else if (Array.isArray(raw.points) && raw.points.length >= 3) {
          const s: SolidData = {
            kind: 'solid',
            id: raw.id ?? uid(),
            points: raw.points,
            height: raw.height ?? 0.05,
            color: raw.color ?? '#dbe4ee',
          }
          this.objects.push(s)
          this.rebuild(s.id)
        }
      }
      if (typeof data.wallHeight === 'number') this.wallHeight = data.wallHeight
      if (typeof data.wallThickness === 'number') this.wallThickness = data.wallThickness
      if (typeof data.wallColor === 'string') this.wallColor = data.wallColor
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
    for (const m of this.idToMesh.values()) box.expandByObject(m)
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
    for (const m of this.idToMesh.values()) this.disposeObj(m)
    this.idToMesh.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ----- history -----

  private cloneObjs(): DocObj[] {
    return this.objects.map((o) =>
      o.kind === 'wall'
        ? { ...o, a: o.a.clone(), b: o.b.clone() }
        : { ...o, points: o.points.map((p) => ({ ...p })) },
    )
  }

  private restoreObjs(objs: DocObj[]) {
    for (const m of this.idToMesh.values()) {
      this.scene.remove(m)
      this.disposeObj(m)
    }
    this.idToMesh.clear()
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

  private saveLocal() {
    try {
      localStorage.setItem('planup.doc', this.serialize())
    } catch {
      /* quota */
    }
  }

  private clearDocQuiet() {
    for (const m of this.idToMesh.values()) {
      this.scene.remove(m)
      this.disposeObj(m)
    }
    this.idToMesh.clear()
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
      const map: Record<string, ToolId> = {
        s: 'select', л: 'select',
        l: 'line', д: 'line',
        r: 'rect', к: 'rect',
        w: 'wall', ц: 'wall',
        p: 'pushpull', з: 'pushpull',
        m: 'move', ь: 'move',
        e: 'erase', у: 'erase',
        o: 'orbit', щ: 'orbit',
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

  private pickObject(): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects([...this.idToMesh.values()], false)
    return hits.length ? (hits[0].object as THREE.Mesh) : null
  }

  private snap(raw: THREE.Vector3): { p: THREE.Vector3; axis: 'x' | 'z' | null } {
    const p = raw.clone()
    p.x = Math.round(p.x / GRID) * GRID
    p.z = Math.round(p.z / GRID) * GRID
    p.y = 0

    let best: THREE.Vector3 | null = null
    let bestD = VERTEX_SNAP
    for (const o of this.objects) {
      const vs = o.kind === 'wall' ? [o.a, o.b] : o.points.map((q) => new THREE.Vector3(q.x, 0, q.z))
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
      const dx = Math.abs(p.x - last.x)
      const dz = Math.abs(p.z - last.z)
      if (dx <= dz && dx < 0.18) {
        p.x = last.x
        return { p, axis: 'z' }
      }
      if (dz < dx && dz < 0.18) {
        p.z = last.z
        return { p, axis: 'x' }
      }
    }
    return { p, axis: null }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    this.updatePointer(e)
    const t = this.tool
    if (t === 'orbit') return

    if (t === 'select' || t === 'erase') {
      const mesh = this.pickObject()
      if (!mesh) {
        this.select(null)
        return
      }
      const id = mesh.userData.id as string
      if (t === 'erase') {
        this.selectedId = id
        this.deleteSelected()
        return
      }
      this.select(id)
      return
    }

    if (t === 'move') {
      const mesh = this.pickObject()
      if (!mesh) {
        this.select(null)
        return
      }
      this.select(mesh.userData.id as string)
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
      const mesh = this.pickObject()
      if (!mesh) return
      const obj = this.objects.find((o) => o.id === mesh.userData.id)
      if (!obj) return
      this.select(obj.id)
      this.pushObj = obj
      this.pushH = obj.height
      this.cb.onHint?.('Тяните мышь вверх/вниз. Клик — зафиксировать. «Размер» + Enter — точная высота.')
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
      const h = THREE.MathUtils.clamp(this.pushH - e.movementY * 0.015, 0.02, 8)
      this.pushH = h
      this.previewPushPull(h)
      this.cb.onVcb?.(h.toFixed(2))
      return
    }

    if (t === 'move' && this.selectedId && this.moveLast && e.buttons & 1) {
      const raw = this.pickGround()
      if (!raw) return
      const obj = this.getSelected()
      if (!obj) return
      const dx = Math.round((raw.x - this.moveLast.x) / GRID) * GRID
      const dz = Math.round((raw.z - this.moveLast.z) / GRID) * GRID
      if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return
      if (obj.kind === 'wall') {
        obj.a.x += dx
        obj.a.z += dz
        obj.b.x += dx
        obj.b.z += dz
      } else {
        for (const p of obj.points) {
          p.x += dx
          p.z += dz
        }
      }
      this.rebuild(obj.id)
      this.moveLast = raw
      return
    }

    if (t === 'select' || t === 'erase' || t === 'pushpull') {
      const mesh = this.pickObject()
      this.renderer.domElement.style.cursor = mesh
        ? 'pointer'
        : t === 'select'
          ? 'default'
          : 'crosshair'
    }
  }

  private onPointerUp = () => {
    if (this.tool === 'pushpull' && this.pushObj) {
      this.finishPushPull()
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
      this.disposeObj(this.draftMesh as THREE.Mesh)
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
          height: 0.02,
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
      height: 0.02,
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
      this.disposeObj(this.draftMesh as THREE.Mesh)
      this.draftMesh = null
    }
    this.hideSnap()
    this.moveLast = null
  }

  private previewPushPull(h: number) {
    if (!this.pushObj) return
    this.pushObj.height = h
    this.rebuild(this.pushObj.id)
  }

  private finishPushPull() {
    if (!this.pushObj) return
    this.historyPush()
    this.pushObj = null
    this.cb.onHint?.('Высота применена.')
  }

  private select(id: string | null) {
    for (const m of this.idToMesh.values()) {
      const mat = m.material as THREE.MeshStandardMaterial
      if (mat.emissive) mat.emissive.setHex(0x000000)
    }
    this.selectedId = id
    if (!id) {
      this.cb.onSelection?.({ kind: null })
      return
    }
    const obj = this.objects.find((o) => o.id === id)
    const mesh = this.idToMesh.get(id)
    if (mesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (mat.emissive) mat.emissive.setHex(0x1a73e8).multiplyScalar(0.22)
    }
    if (!obj) return
    if (obj.kind === 'wall') {
      this.cb.onSelection?.({
        kind: 'wall',
        id,
        length: obj.a.distanceTo(obj.b),
        height: obj.height,
        thickness: obj.thickness,
      })
    } else {
      this.cb.onSelection?.({
        kind: 'solid',
        id,
        height: obj.height,
        area: Math.abs(this.polygonArea(obj.points)),
      })
    }
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

  private rebuild(id: string) {
    const obj = this.objects.find((o) => o.id === id)
    if (!obj) return
    const old = this.idToMesh.get(id)
    if (old) {
      this.scene.remove(old)
      this.disposeObj(old)
      this.idToMesh.delete(id)
    }
    let mesh: THREE.Mesh
    if (obj.kind === 'wall') {
      const dir = new THREE.Vector3().subVectors(obj.b, obj.a)
      const len = Math.max(0.01, dir.length())
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, obj.height, obj.thickness),
        new THREE.MeshStandardMaterial({ color: obj.color, roughness: 0.85, metalness: 0.02 }),
      )
      mesh.position.set((obj.a.x + obj.b.x) / 2, obj.height / 2, (obj.a.z + obj.b.z) / 2)
      mesh.rotation.y = -Math.atan2(dir.z, dir.x)
    } else {
      const shape = new THREE.Shape(obj.points.map((p) => new THREE.Vector2(p.x, -p.z)))
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.01, obj.height),
        bevelEnabled: false,
      })
      geo.rotateX(-Math.PI / 2)
      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: obj.color,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
      )
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.id = obj.id
    mesh.userData.kind = obj.kind
    this.scene.add(mesh)
    this.idToMesh.set(obj.id, mesh)
    if (this.selectedId === id) {
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (mat.emissive) mat.emissive.setHex(0x1a73e8).multiplyScalar(0.22)
    }
  }

  private disposeObj(m: THREE.Object3D) {
    const mesh = m as THREE.Mesh
    mesh.geometry?.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[]
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
