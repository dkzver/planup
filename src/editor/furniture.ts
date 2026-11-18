import * as THREE from 'three'

export interface FurnitureDef {
  type: string
  name: string
  /** габарит по X до поворота */
  w: number
  /** глубина по Z до поворота */
  d: number
  h: number
  color: string
  cat: string
}

export interface FurnData {
  kind: 'furn'
  id: string
  type: string
  x: number
  z: number
  /** поворот вокруг Y, радианы */
  rot: number
}

export interface FurnArrangement {
  id: string
  seq: number
  name: string
  items: FurnData[]
  starred: boolean
  at: number
  types: string[]
}

export const FURNITURE: FurnitureDef[] = [
  { type: 'bed-double', name: 'Кровать 160×200', w: 1.6, d: 2.0, h: 0.9, color: '#c9b8a8', cat: 'Спальня' },
  { type: 'bed-single', name: 'Кровать 90×200', w: 0.9, d: 2.0, h: 0.9, color: '#c9b8a8', cat: 'Спальня' },
  { type: 'nightstand', name: 'Тумба 50×40', w: 0.5, d: 0.4, h: 0.5, color: '#a89078', cat: 'Спальня' },
  { type: 'wardrobe', name: 'Шкаф 200×60', w: 2.0, d: 0.6, h: 2.2, color: '#b8a890', cat: 'Спальня' },
  { type: 'sofa', name: 'Диван 220×90', w: 2.2, d: 0.9, h: 0.8, color: '#7a8a99', cat: 'Гостиная' },
  { type: 'armchair', name: 'Кресло', w: 0.8, d: 0.8, h: 0.8, color: '#7a8a99', cat: 'Гостиная' },
  { type: 'table-dine', name: 'Стол 140×80', w: 1.4, d: 0.8, h: 0.75, color: '#a89078', cat: 'Гостиная' },
  { type: 'table-coffee', name: 'Журн. столик', w: 1.0, d: 0.6, h: 0.4, color: '#a89078', cat: 'Гостиная' },
  { type: 'chair', name: 'Стул', w: 0.45, d: 0.45, h: 0.85, color: '#8a7a68', cat: 'Гостиная' },
  { type: 'tv-stand', name: 'ТВ-тумба 160×40', w: 1.6, d: 0.4, h: 0.5, color: '#4a4a4a', cat: 'Гостиная' },
  { type: 'kitchen', name: 'Кухня 240×60', w: 2.4, d: 0.6, h: 0.9, color: '#d8d4cc', cat: 'Кухня' },
  { type: 'kitchen-island', name: 'Остров 180×90', w: 1.8, d: 0.9, h: 0.9, color: '#d8d4cc', cat: 'Кухня' },
  { type: 'fridge', name: 'Холодильник', w: 0.6, d: 0.65, h: 1.8, color: '#c8c8c8', cat: 'Кухня' },
  { type: 'bath', name: 'Ванна 170×75', w: 1.7, d: 0.75, h: 0.55, color: '#eef3f8', cat: 'Санузел' },
  { type: 'shower', name: 'Душ 90×90', w: 0.9, d: 0.9, h: 2.0, color: '#d8e8f0', cat: 'Санузел' },
  { type: 'toilet', name: 'Унитаз', w: 0.4, d: 0.65, h: 0.42, color: '#eef3f8', cat: 'Санузел' },
  { type: 'sink', name: 'Раковина', w: 0.6, d: 0.45, h: 0.85, color: '#eef3f8', cat: 'Санузел' },
  { type: 'wardrobe-hall', name: 'Шкаф-купе 180×55', w: 1.8, d: 0.55, h: 2.2, color: '#b8a890', cat: 'Прихожая' },
  { type: 'shoe', name: 'Обувница 80×30', w: 0.8, d: 0.3, h: 0.8, color: '#a89078', cat: 'Прихожая' },
]

export function furnDef(type: string): FurnitureDef {
  return FURNITURE.find((f) => f.type === type) ?? FURNITURE[0]
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  id: string,
  opts: { rough?: number; transparent?: boolean; opacity?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: 0.02,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    }),
  )
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.id = id
  mesh.userData.kind = 'furn'
  return mesh
}

/** Сборная низкополигональная мебель. Изголовье/спинка — к -Z (север) при rot=0 */
export function buildFurnMesh(item: FurnData): THREE.Group {
  const def = furnDef(item.type)
  const g = new THREE.Group()
  const id = item.id
  const { w, d, h } = def
  const c = def.color

  const add = (
    bw: number,
    bh: number,
    bd: number,
    x: number,
    y: number,
    z: number,
    color = c,
    o?: { rough?: number; transparent?: boolean; opacity?: number },
  ) => g.add(box(bw, bh, bd, x, y, z, color, id, o))

  switch (item.type) {
    case 'bed-double':
    case 'bed-single': {
      add(w, 0.35, d, 0, 0.175, 0) // цоколь
      add(w, 0.22, d * 0.92, 0, 0.46, 0.02, '#e8e2d8') // матрас
      add(w, 0.12, 0.45, 0, 0.62, -d / 2 + 0.28, '#f4f0e8') // подушка
      if (item.type === 'bed-double') {
        add(w * 0.44, 0.1, 0.4, -w * 0.22, 0.6, -d / 2 + 0.28, '#f4f0e8')
        add(w * 0.44, 0.1, 0.4, w * 0.22, 0.6, -d / 2 + 0.28, '#f4f0e8')
      }
      add(w, 0.7, 0.12, 0, 0.45, -d / 2 + 0.06, '#8a7460') // изголовье
      break
    }
    case 'sofa': {
      add(w, 0.4, d, 0, 0.2, 0) // сиденье
      add(w, 0.4, 0.22, 0, 0.55, -d / 2 + 0.11, '#6a7a89') // спинка
      add(0.18, 0.55, d, -w / 2 + 0.09, 0.28, 0) // подлокотники
      add(0.18, 0.55, d, w / 2 - 0.09, 0.28, 0)
      break
    }
    case 'armchair': {
      add(w, 0.4, d, 0, 0.2, 0)
      add(w, 0.42, 0.2, 0, 0.55, -d / 2 + 0.1)
      add(0.14, 0.5, d, -w / 2 + 0.07, 0.28, 0)
      add(0.14, 0.5, d, w / 2 - 0.07, 0.28, 0)
      break
    }
    case 'wardrobe':
    case 'wardrobe-hall': {
      add(w, h, d, 0, h / 2, 0)
      // линии дверей
      add(0.02, h * 0.85, 0.02, 0, h / 2, d / 2 + 0.01, '#8a7460')
      add(w * 0.28, 0.04, 0.03, -w * 0.18, h * 0.55, d / 2 + 0.02, '#6a5a48')
      add(w * 0.28, 0.04, 0.03, w * 0.18, h * 0.55, d / 2 + 0.02, '#6a5a48')
      break
    }
    case 'kitchen': {
      add(w, h, d, 0, h / 2, 0) // низ
      add(w, 0.04, d + 0.04, 0, h + 0.02, 0, '#3a3a3a') // столешница
      add(w * 0.9, 0.7, 0.35, 0, 1.45, -d / 2 + 0.18, '#e8e4dc') // верхние шкафы
      break
    }
    case 'kitchen-island': {
      add(w, h, d, 0, h / 2, 0)
      add(w + 0.06, 0.05, d + 0.06, 0, h + 0.02, 0, '#3a3a3a')
      break
    }
    case 'fridge': {
      add(w, h, d, 0, h / 2, 0, '#c8ccd0')
      add(0.03, h * 0.4, 0.04, w / 2 - 0.08, h * 0.6, d / 2 + 0.01, '#8a8a8a')
      add(0.03, h * 0.25, 0.04, w / 2 - 0.08, h * 0.25, d / 2 + 0.01, '#8a8a8a')
      break
    }
    case 'table-dine':
    case 'table-coffee': {
      add(w, 0.05, d, 0, h, 0) // столешница
      const leg = h - 0.05
      const lx = w / 2 - 0.08
      const lz = d / 2 - 0.08
      add(0.06, leg, 0.06, -lx, leg / 2, -lz)
      add(0.06, leg, 0.06, lx, leg / 2, -lz)
      add(0.06, leg, 0.06, -lx, leg / 2, lz)
      add(0.06, leg, 0.06, lx, leg / 2, lz)
      break
    }
    case 'chair': {
      add(w, 0.06, d, 0, 0.45, 0)
      add(w, 0.4, 0.05, 0, 0.65, -d / 2 + 0.03)
      add(0.04, 0.42, 0.04, -w / 2 + 0.05, 0.21, -d / 2 + 0.05)
      add(0.04, 0.42, 0.04, w / 2 - 0.05, 0.21, -d / 2 + 0.05)
      add(0.04, 0.42, 0.04, -w / 2 + 0.05, 0.21, d / 2 - 0.05)
      add(0.04, 0.42, 0.04, w / 2 - 0.05, 0.21, d / 2 - 0.05)
      break
    }
    case 'tv-stand': {
      add(w, h, d, 0, h / 2, 0, '#3a3a3a')
      add(w * 0.7, 0.05, 0.3, 0, h + 0.15, 0, '#222') // ТВ
      break
    }
    case 'nightstand': {
      add(w, h, d, 0, h / 2, 0)
      add(w * 0.7, 0.03, d * 0.7, 0, h + 0.05, 0, '#e8e2d8')
      break
    }
    case 'bath': {
      add(w, h, d, 0, h / 2, 0, '#eef3f8', { rough: 0.3 })
      add(w - 0.15, 0.1, d - 0.15, 0, h, 0, '#d0dce8')
      break
    }
    case 'shower': {
      add(w, 0.12, d, 0, 0.06, 0, '#d8e8f0')
      add(w, 1.9, 0.04, 0, 1.0, -d / 2, '#c8dce8', { transparent: true, opacity: 0.4 })
      add(0.04, 1.9, d, -w / 2, 1.0, 0, '#c8dce8', { transparent: true, opacity: 0.4 })
      add(0.04, 1.9, d, w / 2, 1.0, 0, '#c8dce8', { transparent: true, opacity: 0.4 })
      break
    }
    case 'toilet': {
      add(w, 0.4, 0.4, 0, 0.2, -d / 2 + 0.2) // бачок
      add(w * 0.9, 0.22, d * 0.55, 0, 0.11, 0.08) // чаша
      break
    }
    case 'sink': {
      add(w, h, d, 0, h / 2, 0)
      add(w * 0.85, 0.12, d * 0.8, 0, h + 0.04, 0, '#ffffff')
      break
    }
    case 'shoe': {
      add(w, h, d, 0, h / 2, 0)
      break
    }
    default: {
      add(w, h, d, 0, h / 2, 0)
    }
  }

  g.position.set(item.x, 0, item.z)
  g.rotation.y = item.rot
  g.userData.id = item.id
  g.userData.kind = 'furn'
  g.userData.furnType = item.type
  return g
}
