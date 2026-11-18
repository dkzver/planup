import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Engine, type ToolId, type SelInfo, type OpeningData, type WorkVolumes } from '../editor/Engine'
import { FURNITURE, type FurnArrangement } from '../editor/furniture'
import { detectPlanWalls, fileToCanvas } from '../editor/planDetect'

const TOOLS: { id: ToolId; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '⬈', label: 'Выбор', key: 'S' },
  { id: 'wall', icon: '▬', label: 'Стена', key: 'W' },
  { id: 'line', icon: '╱', label: 'Линия', key: 'L' },
  { id: 'rect', icon: '▭', label: 'Прямоугольник', key: 'R' },
  { id: 'pushpull', icon: '⟊', label: 'Push/Pull', key: 'P' },
  { id: 'move', icon: '✥', label: 'Переместить', key: 'M' },
  { id: 'erase', icon: '⌫', label: 'Ластик', key: 'E' },
  { id: 'orbit', icon: '◍', label: 'Орбита', key: 'O' },
  { id: 'furn', icon: '🛏', label: 'Мебель', key: 'F' },
]

const FURN_ICON: Record<string, string> = {
  'bed-double': '🛏',
  'bed-single': '🛌',
  nightstand: '🗄',
  wardrobe: '🚪',
  sofa: '🛋',
  armchair: '💺',
  'table-dine': '🍽',
  'table-coffee': '☕',
  chair: '🪑',
  'tv-stand': '📺',
  kitchen: '🍳',
  'kitchen-island': '🧑‍🍳',
  fridge: '🧊',
  bath: '🛁',
  shower: '🚿',
  toilet: '🚽',
  sink: '🧼',
  'wardrobe-hall': '🧥',
  shoe: '👟',
}

export default function EditorPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)

  const [tool, setTool] = useState<ToolId>('wall')
  const [vcb, setVcb] = useState('')
  const [hint, setHint] = useState(
    'Стены строго по осям. Средняя кнопка мыши — орбита. G — сетка 30 см.',
  )
  const [sel, setSel] = useState<SelInfo>({ kind: null })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [count, setCount] = useState(0)
  const [wallH, setWallH] = useState(2.7)
  const [wallT, setWallT] = useState(0.1)
  const [color, setColor] = useState('#e8e4d9')
  const [axes, setAxes] = useState(true)
  const [furnCat, setFurnCat] = useState('Спальня')
  const [showHelp, setShowHelp] = useState(false)
  const [vol, setVol] = useState<WorkVolumes | null>(null)
  const [furnOpen, setFurnOpen] = useState(false)
  const [furnChecked, setFurnChecked] = useState<string[]>([])
  const [furnHist, setFurnHist] = useState<FurnArrangement[]>([])
  const [furnTab, setFurnTab] = useState<'pick' | 'hist'>('pick')
  const [toast, setToast] = useState('')
  const [initError, setInitError] = useState('')

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 1800)
  }, [])

  useEffect(() => {
    if (!hostRef.current) return
    let eng: Engine | null = null
    try {
      eng = new Engine(hostRef.current, {
        onToolChange: setTool,
        onVcb: setVcb,
        onHint: setHint,
        onSelection: (info) => {
          setSel(info)
          // живая высота/толщина при Push/Pull
          if (info.kind === 'wall') {
            if (typeof info.height === 'number') setWallH(info.height)
            if (typeof info.thickness === 'number') setWallT(info.thickness)
          } else if (info.kind === 'solid') {
            if (typeof info.height === 'number') setWallH(info.height)
          }
        },
        onHistory: (u, r) => {
          setCanUndo(u)
          setCanRedo(r)
        },
        onObjects: setCount,
        onAxes: setAxes,
      })
      engineRef.current = eng
      eng.restoreLocal()
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err))
      document.title = 'ENGINE: ' + (err instanceof Error ? err.message : String(err))
      return
    }
    const ro = new ResizeObserver(() => {
      window.dispatchEvent(new Event('resize'))
    })
    ro.observe(hostRef.current)
    return () => {
      ro.disconnect()
      eng?.dispose()
      engineRef.current = null
    }
  }, [])

  const pickTool = (t: ToolId) => engineRef.current?.setTool(t)

  const applyWallH = (v: number) => {
    const h = Math.max(0.1, Math.round(v * 10) / 10)
    setWallH(h)
    engineRef.current?.setWallHeight(h)
  }
  const applyWallT = (v: number) => {
    const t = Math.max(0.1, Math.round(v * 10) / 10)
    setWallT(t)
    engineRef.current?.setWallThickness(t)
  }
  const applyColor = (c: string) => {
    setColor(c)
    engineRef.current?.setWallColor(c)
  }
  const toggleAxes = () => {
    const next = !axes
    setAxes(next)
    engineRef.current?.setAxesVisible(next)
  }

  const doSave = () => {
    const eng = engineRef.current
    if (!eng) return
    localStorage.setItem('planup.doc', eng.serialize())
    flash('Проект сохранён в браузере')
  }

  const newProject = () => {
    engineRef.current?.newProject()
    flash('Новый проект')
  }

  const buildApartment = () => {
    engineRef.current?.loadApartmentProject()
    flash('Стены собраны. Кнопка «Расставить мебель» — выбрать предметы.')
  }

  const openFurn = () => {
    setFurnHist(engineRef.current?.getFurnHistory() ?? [])
    setFurnOpen(true)
  }

  const toggleFurnCheck = (type: string) => {
    setFurnChecked((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const applyFurn = () => {
    engineRef.current?.placeFurnitureSet(furnChecked)
    setFurnHist(engineRef.current?.getFurnHistory() ?? [])
    setFurnOpen(false)
    flash(furnChecked.length ? `Расставлено: ${furnChecked.length} типов` : 'Мебель убрана')
  }

  const restoreArr = (id: string) => {
    engineRef.current?.restoreFurnArrangement(id)
    setFurnOpen(false)
    flash('Расстановка восстановлена')
  }

  const starArr = (id: string) => {
    engineRef.current?.toggleFurnStar(id)
    setFurnHist(engineRef.current?.getFurnHistory() ?? [])
  }

  const delArr = (id: string) => {
    engineRef.current?.deleteFurnArrangement(id)
    setFurnHist(engineRef.current?.getFurnHistory() ?? [])
  }

  const exportVolXlsx = async (v: WorkVolumes) => {
    type Row = (string | number)[]
    const rows: Row[] = [
      ['Помещение', 'Показатель', 'Ед. изм.', 'Количество'],
    ]
    for (const r of v.rooms) {
      rows.push([r.name, 'Площадь пола', 'м²', r.floor])
      rows.push([r.name, 'Площадь стен', 'м²', r.wallsNetto])
      rows.push([r.name, 'Площадь потолка', 'м²', r.ceiling])
      rows.push([r.name, 'Периметр', 'м', r.perimeter])
      rows.push([r.name, 'Плинтус', 'м', r.plinth])
      rows.push([r.name, 'Двери', 'шт', r.doors])
      rows.push([r.name, 'Окна', 'шт', r.windows])
    }
    rows.push(['ИТОГО', 'Площадь пола', 'м²', v.totals.floor])
    rows.push(['ИТОГО', 'Площадь стен нетто', 'м²', v.totals.wallsNetto])
    rows.push(['ИТОГО', 'Площадь стен брутто', 'м²', v.totals.wallsBrutto])
    rows.push(['ИТОГО', 'Площадь потолка', 'м²', v.totals.ceiling])
    rows.push(['ИТОГО', 'Плинтус', 'м', v.totals.plinth])
    rows.push(['ИТОГО', 'Двери', 'шт', v.totals.doors])
    rows.push(['ИТОГО', 'Окна', 'шт', v.totals.windows])
    rows.push([])
    rows.push(['Примечание', 'Стены нетто — за вычетом проёмов. Плинтус — периметр минус двери. Данные из модели PlanUp.', '', ''])

    try {
      const XLSX = await import('xlsx')
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 14 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Объёмы работ')
      XLSX.writeFile(wb, 'planup-obiemy-rabot.xlsx')
      flash('Excel сформирован')
    } catch (err) {
      // запасной путь: CSV с BOM
      const csv = rows
        .map((r) => r.map((c) => (typeof c === 'string' && c.includes(';') ? `"${c}"` : c)).join(';'))
        .join('\r\n')
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'planup-obiemy-rabot.csv'
      a.click()
      URL.revokeObjectURL(a.href)
      flash('Excel недоступен, скачан CSV')
    }
  }

  const loadPlanFile = async (file: File) => {
    try {
      flash('Анализирую документ…')
      const canvas = await fileToCanvas(file, 1600)
      const res = detectPlanWalls(canvas)
      if (!res.ok || !res.walls) {
        flash(res.error ?? 'План квартиры в документе не найден')
        return
      }
      engineRef.current?.loadDetectedWalls(res.walls)
      flash(
        `План распознан: стен ${res.walls.length}, габарит ~${res.widthM?.toFixed(1)}×${res.heightM?.toFixed(1)} м. Уверенность ${(100 * (res.confidence ?? 0)).toFixed(0)}%`,
      )
    } catch (err) {
      flash('Не удалось открыть план: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const onVcbKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      engineRef.current?.applyVcb((e.target as HTMLInputElement).value)
      ;(e.target as HTMLInputElement).select()
    }
  }

  const addOp = (type: 'door' | 'window') => {
    engineRef.current?.addOpening(type)
    flash(type === 'door' ? 'Дверь добавлена' : 'Окно добавлено')
  }

  if (initError) {
    return (
      <div style={{ padding: 32, maxWidth: 560, margin: '10vh auto' }}>
        <h2>Не удалось запустить 3D-вьюпорт</h2>
        <p style={{ color: '#5b6470' }}>
          Редактору нужен WebGL. Откройте PlanUp в Chrome, Edge или Firefox.
          Встроенный предпросмотр и некоторые VM-браузеры WebGL не включают.
        </p>
        <pre
          style={{
            background: '#f4f1ea',
            padding: 12,
            borderRadius: 8,
            fontSize: 12,
            overflow: 'auto',
          }}
        >
          {initError}
        </pre>
        <button className="btn btn-primary" onClick={() => location.assign('/')}>
          На главную
        </button>
      </div>
    )
  }

  return (
    <div className="editor">
      <header className="ed-top">
        <Link to="/" className="logo sm">
          <span className="logo-mark">▲</span> PlanUp
        </Link>
        <div className="ed-actions">
          <button
            className="ib"
            onClick={() => engineRef.current?.undo()}
            disabled={!canUndo}
            title="Отменить (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="ib"
            onClick={() => engineRef.current?.redo()}
            disabled={!canRedo}
            title="Вернуть (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          <span className="sep" />
          <button
            className={'ib' + (axes ? ' on-axes' : '')}
            onClick={toggleAxes}
            title="Оси 30 см (G)"
            style={axes ? { borderColor: '#1a73e8', color: '#1a73e8' } : undefined}
          >
            # 30
          </button>
          <button className="ib" onClick={() => engineRef.current?.frameAll()} title="Вписать в экран">
            ⤢
          </button>
          <button className="ib" onClick={() => setShowHelp((v) => !v)} title="Помощь">
            ?
          </button>
          <span className="sep" />
          <button className="btn btn-ghost sm" onClick={newProject}>
            Новый проект
          </button>
          <label className="btn btn-ghost sm file">
            Загрузить план
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void loadPlanFile(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <button className="btn btn-primary sm" onClick={buildApartment}>
            Собрать квартиру
          </button>
          <button className="btn btn-primary sm" onClick={openFurn}>
            Расставить мебель
          </button>
          <button
            className="btn btn-ghost sm"
            onClick={() => {
              const v = engineRef.current?.getWorkVolumes()
              if (v) setVol(v)
            }}
          >
            Объёмы работ
          </button>
          <button className="btn btn-ghost sm" onClick={doSave}>
            Сохранить
          </button>
        </div>
      </header>

      <div className="ed-main">
        <aside className="ed-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={'tool' + (tool === t.id ? ' on' : '')}
              onClick={() => pickTool(t.id)}
              title={`${t.label} (${t.key})`}
            >
              <span className="tool-ico">{t.icon}</span>
              <span className="tool-lbl">{t.label}</span>
            </button>
          ))}
          <div className="tool-count">{count} объектов</div>
        </aside>

        <div className="ed-viewport" ref={hostRef} />

        <aside className="ed-side">
          <div className="panel">
            <h4>Стена · кратно 10 см</h4>
            <label className="fld">
              <span>Высота, м</span>
              <input
                type="number"
                min={0.1}
                max={6}
                step={0.1}
                value={wallH}
                onChange={(e) => applyWallH(Number(e.target.value) || 2.7)}
              />
            </label>
            <label className="fld">
              <span>Толщина, м</span>
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.1}
                value={wallT}
                onChange={(e) => applyWallT(Number(e.target.value) || 0.1)}
              />
            </label>
            <label className="fld">
              <span>Цвет</span>
              <input type="color" value={color} onChange={(e) => applyColor(e.target.value)} />
            </label>
            <p className="note">
              Push/Pull тоже меняет высоту — поле обновляется сразу. Шаг 10 см.
            </p>
          </div>

          {tool === 'furn' && (
            <div className="panel">
              <h4>Каталог мебели</h4>
              <div className="cats">
                {['Спальня', 'Гостиная', 'Кухня', 'Санузел', 'Прихожая'].map((c) => (
                  <button
                    key={c}
                    className={'chip' + (furnCat === c ? ' on' : '')}
                    onClick={() => setFurnCat(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="furn-list">
                {FURNITURE.filter((f) => f.cat === furnCat).map((f) => (
                  <button
                    key={f.type}
                    className={'furn-item' + (engineRef.current?.furnType === f.type ? ' on' : '')}
                    onClick={() => engineRef.current?.setFurnType(f.type)}
                  >
                    <span className="furn-name">{f.name}</span>
                    <span className="furn-dim">
                      {f.w.toFixed(2)} × {f.d.toFixed(2)} × {f.h.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="note">Выберите тип и кликните по полу. R — повернуть выбранное.</p>
            </div>
          )}

          <div className="panel">
            <h4>Выбрано</h4>
            {sel.kind === null && <p className="note">Ничего не выбрано</p>}
            {sel.kind === 'furn' && (
              <>
                <ul className="props">
                  <li>
                    <span>Тип</span>
                    <b>{sel.furnName ?? sel.furnType}</b>
                  </li>
                  <li>
                    <span>Габарит</span>
                    <b>
                      {sel.furnW?.toFixed(2)} × {sel.furnD?.toFixed(2)} × {sel.height?.toFixed(2)}
                    </b>
                  </li>
                </ul>
                <div className="op-btns">
                  <button className="btn btn-ghost sm" onClick={() => engineRef.current?.rotateSelectedFurn()}>
                    Повернуть (R)
                  </button>
                  <button className="btn btn-danger sm" onClick={() => engineRef.current?.deleteSelected()}>
                    Удалить
                  </button>
                </div>
                <p className="note">Тяните мышью по полу — шаг 10 см.</p>
              </>
            )}
            {sel.kind === 'wall' || sel.kind === 'opening' ? (
              <>
                <ul className="props">
                  <li>
                    <span>Тип</span>
                    <b>{sel.kind === 'opening' ? 'проём на стене' : 'стена'}</b>
                  </li>
                  <li>
                    <span>Длина</span>
                    <b>{sel.length?.toFixed(2)} м</b>
                  </li>
                  <li>
                    <span>Высота</span>
                    <b>{sel.height?.toFixed(1)} м</b>
                  </li>
                  <li>
                    <span>Толщина</span>
                    <b>{sel.thickness?.toFixed(1)} м</b>
                  </li>
                </ul>

                <div className="op-head">
                  <span>Проёмы ({sel.openings?.length ?? 0})</span>
                  <div className="op-btns">
                    <button className="btn btn-ghost sm" onClick={() => addOp('door')}>
                      + Дверь
                    </button>
                    <button className="btn btn-ghost sm" onClick={() => addOp('window')}>
                      + Окно
                    </button>
                  </div>
                </div>
                <p className="note">
                  Дверь 0,9×2,1 · окно 1,2×1,2, подоконник 0,9. Можно несколько.
                  Выберите проём и тяните его по стене — шаг 10 см.
                </p>
                {(sel.openings ?? []).map((op: OpeningData) => (
                  <div
                    key={op.id}
                    className={'op-card' + (sel.selectedOpeningId === op.id ? ' on' : '')}
                    onClick={() => engineRef.current?.selectOpening(op.id)}
                  >
                    <div className="op-row">
                      <select
                        value={op.type}
                        onChange={(e) =>
                          engineRef.current?.updateOpening(op.id, {
                            type: e.target.value as 'door' | 'window',
                          })
                        }
                      >
                        <option value="door">Дверь</option>
                        <option value="window">Окно</option>
                      </select>
                      <button
                        className="ib sm"
                        title="Удалить проём"
                        onClick={() => engineRef.current?.removeOpening(op.id)}
                      >
                        ✕
                      </button>
                    </div>
                    <label className="fld">
                      <span>Отступ, м</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={op.offset}
                        onChange={(e) =>
                          engineRef.current?.updateOpening(op.id, {
                            offset: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Ширина, м</span>
                      <input
                        type="number"
                        min={0.3}
                        step={0.1}
                        value={op.width}
                        onChange={(e) =>
                          engineRef.current?.updateOpening(op.id, {
                            width: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Высота, м</span>
                      <input
                        type="number"
                        min={0.3}
                        step={0.1}
                        value={op.height}
                        onChange={(e) =>
                          engineRef.current?.updateOpening(op.id, {
                            height: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    {op.type === 'window' && (
                      <label className="fld">
                        <span>Подоконник, м</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={op.sill}
                          onChange={(e) =>
                            engineRef.current?.updateOpening(op.id, {
                              sill: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
                <button
                  className="btn btn-danger sm"
                  style={{ marginTop: 8 }}
                  onClick={() => engineRef.current?.deleteSelected()}
                >
                  Удалить стену
                </button>
              </>
            ) : null}
            {sel.kind === 'solid' && (
              <>
                <ul className="props">
                  <li>
                    <span>Тип</span>
                    <b>контур / объём</b>
                  </li>
                  <li>
                    <span>Высота</span>
                    <b>{sel.height?.toFixed(1)} м</b>
                  </li>
                  <li>
                    <span>Площадь</span>
                    <b>{sel.area?.toFixed(2)} м²</b>
                  </li>
                </ul>
                <button className="btn btn-danger sm" onClick={() => engineRef.current?.deleteSelected()}>
                  Удалить
                </button>
              </>
            )}
          </div>

          <div className="panel">
            <h4>Горячие клавиши</h4>
            <ul className="keys">
              <li>
                <b>W</b> стена
              </li>
              <li>
                <b>L</b> линия
              </li>
              <li>
                <b>R</b> прямоугольник
              </li>
              <li>
                <b>P</b> Push/Pull
              </li>
              <li>
                <b>S</b> выбор
              </li>
              <li>
                <b>M</b> переместить
              </li>
              <li>
                <b>E</b> ластик
              </li>
              <li>
                <b>O</b> орбита
              </li>
              <li>
                <b>F</b> мебель
              </li>
              <li>
                <b>R</b> повернуть мебель
              </li>
              <li>
                <b>G</b> оси 30 см
              </li>
              <li>
                <b>СКМ</b> орбита
              </li>
              <li>
                <b>ПКМ</b> панорама
              </li>
              <li>
                <b>Esc</b> отмена
              </li>
              <li>
                <b>Enter</b> замкнуть / VCB
              </li>
              <li>
                <b>Del</b> удалить
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <footer className="ed-bottom">
        <div className="vcb">
          <span>Размер</span>
          <input value={vcb} onChange={(e) => setVcb(e.target.value)} onKeyDown={onVcbKey} placeholder="2.50" />
        </div>
        <div className="hint">{hint}</div>
      </footer>

      {furnOpen && (
        <div className="modal" onClick={() => setFurnOpen(false)}>
          <div className="modal-card furn-dlg" onClick={(e) => e.stopPropagation()}>
            <div className="furn-head">
              <div>
                <h3>Расстановка мебели</h3>
                <p className="note">
                  Отметьте предметы — встанут на типовые места квартиры. Повторное применение — перестановка.
                </p>
              </div>
              <div className="furn-tabs">
                <button className={'chip' + (furnTab === 'pick' ? ' on' : '')} onClick={() => setFurnTab('pick')}>
                  Выбор
                </button>
                <button className={'chip' + (furnTab === 'hist' ? ' on' : '')} onClick={() => setFurnTab('hist')}>
                  История {furnHist.length ? `(${furnHist.length})` : ''}
                </button>
              </div>
            </div>

            {furnTab === 'pick' ? (
              <>
                <div className="cats">
                  {['Спальня', 'Гостиная', 'Кухня', 'Санузел', 'Прихожая'].map((c) => (
                    <button key={c} className="chip" style={{ pointerEvents: 'none', opacity: 0.7 }}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="furn-grid">
                  {FURNITURE.map((f) => {
                    const on = furnChecked.includes(f.type)
                    return (
                      <button
                        key={f.type}
                        className={'furn-card' + (on ? ' on' : '')}
                        onClick={() => toggleFurnCheck(f.type)}
                      >
                        <span className="furn-ico">{FURN_ICON[f.type] ?? '📦'}</span>
                        <span className="furn-name">{f.name}</span>
                        <span className="furn-dim">
                          {f.w.toFixed(2)} × {f.d.toFixed(2)}
                        </span>
                        <span className={'furn-check' + (on ? ' on' : '')}>
                          {on ? '✓' : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="furn-foot">
                  <span>Выбрано: {furnChecked.length}</span>
                  <div className="op-btns">
                    <button className="btn btn-ghost sm" onClick={() => setFurnChecked([])}>
                      Снять всё
                    </button>
                    <button className="btn btn-primary sm" onClick={applyFurn}>
                      Применить
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="furn-hist">
                {furnHist.length === 0 && <p className="note">Пока нет расстановок. Примените выбор на вкладке «Выбор».</p>}
                {furnHist.map((a) => (
                  <div key={a.id} className={'hist-card' + (a.starred ? ' star' : '')}>
                    <button
                      className={'star-btn' + (a.starred ? ' on' : '')}
                      title={a.starred ? 'Снять звезду' : 'Отметить звездой'}
                      onClick={() => starArr(a.id)}
                    >
                      {a.starred ? '★' : '☆'}
                    </button>
                    <div className="hist-main" onClick={() => restoreArr(a.id)}>
                      <b>{a.name}</b>
                      <span className="note">
                        {new Date(a.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {a.types.length} типов · {a.items.length} предметов
                      </span>
                    </div>
                    <button className="ib sm" title="Восстановить" onClick={() => restoreArr(a.id)}>
                      ↺
                    </button>
                    <button className="ib sm" title="Удалить из истории" onClick={() => delArr(a.id)}>
                      ✕
                    </button>
                  </div>
                ))}
                {furnHist.length > 0 && (
                  <p className="note">Нажмите на строку или ↺, чтобы вернуть расстановку. Звезда — избранное сверху.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {vol && (
        <div className="modal" onClick={() => setVol(null)}>
          <div className="modal-card vol" onClick={(e) => e.stopPropagation()}>
            <div className="furn-head">
              <div>
                <h3>Объёмы основных работ</h3>
                <p className="note">Данные из модели в структуре сметы. Стены нетто — за вычетом проёмов.</p>
              </div>
              <button className="btn btn-primary sm" onClick={() => void exportVolXlsx(vol)}>
                Сформировать Excel-файл
              </button>
            </div>
            <div className="vol-totals">
              <div>
                <span>Помещений</span>
                <b>{vol.totals.rooms}</b>
              </div>
              <div>
                <span>Пол, м²</span>
                <b>{vol.totals.floor.toFixed(2)}</b>
              </div>
              <div>
                <span>Потолок, м²</span>
                <b>{vol.totals.ceiling.toFixed(2)}</b>
              </div>
              <div>
                <span>Стены брутто, м²</span>
                <b>{vol.totals.wallsBrutto.toFixed(2)}</b>
              </div>
              <div>
                <span>Стены нетто, м²</span>
                <b>{vol.totals.wallsNetto.toFixed(2)}</b>
              </div>
              <div>
                <span>Проёмы, м²</span>
                <b>{vol.totals.openingsArea.toFixed(2)}</b>
              </div>
              <div>
                <span>Двери</span>
                <b>{vol.totals.doors}</b>
              </div>
              <div>
                <span>Окна</span>
                <b>{vol.totals.windows}</b>
              </div>
              <div>
                <span>Плинтус, м</span>
                <b>{vol.totals.plinth.toFixed(2)}</b>
              </div>
              <div>
                <span>Длина стен, м</span>
                <b>{vol.totals.wallLength.toFixed(2)}</b>
              </div>
            </div>

            <h4>По помещениям</h4>
            <table className="vol-table">
              <thead>
                <tr>
                  <th>Помещение</th>
                  <th>Пол, м²</th>
                  <th>Стены нетто, м²</th>
                  <th>Потолок, м²</th>
                  <th>Периметр, м</th>
                  <th>Плинтус, м</th>
                  <th>Двери</th>
                  <th>Окна</th>
                  <th>Покрытие</th>
                </tr>
              </thead>
              <tbody>
                {vol.rooms.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.floor.toFixed(2)}</td>
                    <td>{r.wallsNetto.toFixed(2)}</td>
                    <td>{r.ceiling.toFixed(2)}</td>
                    <td>{r.perimeter.toFixed(2)}</td>
                    <td>{r.plinth.toFixed(2)}</td>
                    <td>{r.doors}</td>
                    <td>{r.windows}</td>
                    <td>{r.wet ? 'плитка' : 'ламинат'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Стены нетто — за вычетом проёмов. Плинтус — периметр минус ширина дверей.
              Покрытие: плитка в ванной/санузле/балконе, ламинат в сухих комнатах.
            </p>
            <button className="btn btn-primary" onClick={() => setVol(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal" onClick={() => setShowHelp(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Как рисовать помещение</h3>
            <ol>
              <li>
                <b>Стена</b>: только горизонтально и вертикально. Кликайте углы, замкните на первую
                точку.
              </li>
              <li>
                Высота и толщина — кратно 10 см. Push/Pull по стене тоже меняет высоту, поле справа
                обновляется сразу.
              </li>
              <li>
                Выберите стену → <b>+ Дверь</b> / <b>+ Окно</b>. Несколько проёмов на одной стене,
                размеры и подоконник редактируются.
              </li>
              <li>
                <b>Оси 30 см</b> (кнопка # 30 или G) — сетка и привязка к горизонтальным/вертикальным
                линиям с шагом 30 см. Можно скрывать.
              </li>
              <li>
                <b>Линия</b> — тоже только по осям. Замкнули контур — Push/Pull в объём.
              </li>
              <li>Средняя кнопка мыши — орбита, правая — панорама, колесо — зум.</li>
            </ol>
            <button className="btn btn-primary" onClick={() => setShowHelp(false)}>
              Понятно
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
