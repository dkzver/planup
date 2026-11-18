import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Engine, type ToolId, type SelInfo, type OpeningData } from '../editor/Engine'

const TOOLS: { id: ToolId; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '⬈', label: 'Выбор', key: 'S' },
  { id: 'wall', icon: '▬', label: 'Стена', key: 'W' },
  { id: 'line', icon: '╱', label: 'Линия', key: 'L' },
  { id: 'rect', icon: '▭', label: 'Прямоугольник', key: 'R' },
  { id: 'pushpull', icon: '⟊', label: 'Push/Pull', key: 'P' },
  { id: 'move', icon: '✥', label: 'Переместить', key: 'M' },
  { id: 'erase', icon: '⌫', label: 'Ластик', key: 'E' },
  { id: 'orbit', icon: '◍', label: 'Орбита', key: 'O' },
]

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
  const [showHelp, setShowHelp] = useState(false)
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

  const doExport = () => {
    const eng = engineRef.current
    if (!eng) return
    const blob = new Blob([eng.serialize()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'planup-project.json'
    a.click()
    URL.revokeObjectURL(a.href)
    flash('JSON скачан')
  }

  const doImport = (file: File) => {
    const r = new FileReader()
    r.onload = () => {
      const ok = engineRef.current?.load(String(r.result))
      flash(ok ? 'Проект загружен' : 'Не удалось прочитать файл')
    }
    r.readAsText(file)
  }

  const example = () => {
    engineRef.current?.loadExampleRoom()
    flash('Пример комнаты с дверью и окном')
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
          <button className="ib" onClick={example} title="Пример комнаты 4×5">
            🏠
          </button>
          <button className="ib" onClick={() => engineRef.current?.frameAll()} title="Вписать в экран">
            ⤢
          </button>
          <button className="ib" onClick={() => setShowHelp((v) => !v)} title="Помощь">
            ?
          </button>
          <span className="sep" />
          <button className="btn btn-ghost sm" onClick={doSave}>
            Сохранить
          </button>
          <button className="btn btn-ghost sm" onClick={doExport}>
            Экспорт JSON
          </button>
          <label className="btn btn-ghost sm file">
            Импорт
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) doImport(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
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

          <div className="panel">
            <h4>Выбрано</h4>
            {sel.kind === null && <p className="note">Ничего не выбрано</p>}
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
