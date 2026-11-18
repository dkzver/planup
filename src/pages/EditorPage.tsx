import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Engine, type ToolId, type SelInfo } from '../editor/Engine'

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
  const vcbRef = useRef<HTMLInputElement>(null)

  const [tool, setTool] = useState<ToolId>('wall')
  const [vcb, setVcb] = useState('')
  const [hint, setHint] = useState('Кликайте точки — каждая линия станет стеной. Средняя кнопка мыши — орбита.')
  const [sel, setSel] = useState<SelInfo>({ kind: null })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [count, setCount] = useState(0)
  const [wallH, setWallH] = useState(2.7)
  const [wallT, setWallT] = useState(0.1)
  const [color, setColor] = useState('#e8e4d9')
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
        onSelection: setSel,
        onHistory: (u, r) => {
          setCanUndo(u)
          setCanRedo(r)
        },
        onObjects: setCount,
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
    setWallH(v)
    engineRef.current?.setWallHeight(v)
  }
  const applyWallT = (v: number) => {
    setWallT(v)
    engineRef.current?.setWallThickness(v)
  }
  const applyColor = (c: string) => {
    setColor(c)
    engineRef.current?.setWallColor(c)
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
    flash('Пример комнаты 4×5 добавлен')
  }

  const onVcbKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      engineRef.current?.applyVcb((e.target as HTMLInputElement).value)
      ;(e.target as HTMLInputElement).select()
    }
  }

  if (initError) {
    return (
      <div style={{ padding: 32, maxWidth: 560, margin: '10vh auto', fontFamily: 'inherit' }}>
        <h2>Не удалось запустить 3D-вьюпорт</h2>
        <p style={{ color: '#5b6470' }}>
          Редактору нужен WebGL. Откройте PlanUp в Chrome, Edge или Firefox.
          Встроенный предпросмотр и некоторые VM-браузеры WebGL не включают.
        </p>
        <pre style={{ background: '#f4f1ea', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto' }}>{initError}</pre>
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
          <button className="ib" onClick={() => engineRef.current?.undo()} disabled={!canUndo} title="Отменить (Ctrl+Z)">
            ↶
          </button>
          <button className="ib" onClick={() => engineRef.current?.redo()} disabled={!canRedo} title="Вернуть (Ctrl+Shift+Z)">
            ↷
          </button>
          <span className="sep" />
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
            <h4>Стена</h4>
            <label className="fld">
              <span>Высота, м</span>
              <input
                type="number"
                min={0.1}
                max={6}
                step={0.05}
                value={wallH}
                onChange={(e) => applyWallH(Number(e.target.value) || 2.7)}
              />
            </label>
            <label className="fld">
              <span>Толщина, м</span>
              <input
                type="number"
                min={0.02}
                max={1}
                step={0.01}
                value={wallT}
                onChange={(e) => applyWallT(Number(e.target.value) || 0.1)}
              />
            </label>
            <label className="fld">
              <span>Цвет</span>
              <input type="color" value={color} onChange={(e) => applyColor(e.target.value)} />
            </label>
            <p className="note">Значения применяются к новым стенам и к выбранной стене.</p>
          </div>

          <div className="panel">
            <h4>Свойства выбора</h4>
            {sel.kind === null && <p className="note">Ничего не выбрано</p>}
            {sel.kind === 'wall' && (
              <ul className="props">
                <li>Тип: стена</li>
                <li>Длина: {sel.length?.toFixed(2)} м</li>
                <li>Высота: {sel.height?.toFixed(2)} м</li>
                <li>Толщина: {sel.thickness?.toFixed(2)} м</li>
              </ul>
            )}
            {sel.kind === 'solid' && (
              <ul className="props">
                <li>Тип: контур / объём</li>
                <li>Высота: {sel.height?.toFixed(2)} м</li>
                <li>Площадь: {sel.area?.toFixed(2)} м²</li>
              </ul>
            )}
            {sel.kind && (
              <button className="btn btn-danger sm" onClick={() => engineRef.current?.deleteSelected()}>
                Удалить
              </button>
            )}
          </div>

          <div className="panel">
            <h4>Горячие клавиши</h4>
            <ul className="keys">
              <li><b>W</b> стена</li>
              <li><b>L</b> линия</li>
              <li><b>R</b> прямоугольник</li>
              <li><b>P</b> Push/Pull</li>
              <li><b>S</b> выбор</li>
              <li><b>M</b> переместить</li>
              <li><b>E</b> ластик</li>
              <li><b>O</b> орбита</li>
              <li><b>СКМ</b> орбита</li>
              <li><b>ПКМ</b> панорама</li>
              <li><b>Esc</b> отмена</li>
              <li><b>Enter</b> замкнуть / применить VCB</li>
              <li><b>Del</b> удалить</li>
              <li><b>Ctrl+Z</b> отмена</li>
            </ul>
          </div>
        </aside>
      </div>

      <footer className="ed-bottom">
        <div className="vcb">
          <span>Размер</span>
          <input
            ref={vcbRef}
            value={vcb}
            onChange={(e) => setVcb(e.target.value)}
            onKeyDown={onVcbKey}
            placeholder="2.50"
          />
        </div>
        <div className="hint">{hint}</div>
      </footer>

      {showHelp && (
        <div className="modal" onClick={() => setShowHelp(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Как рисовать помещение</h3>
            <ol>
              <li>Инструмент <b>Стена</b>: кликайте углы комнаты. Замкните контур кликом по первой точке.</li>
              <li>Высоту и толщину стен меняйте справа — можно до рисования, можно на выбранной стене.</li>
              <li><b>Линия / Прямоугольник</b> — контур пола. Потом <b>Push/Pull</b> — выдавить.</li>
              <li>Во время рисования введите число в поле «Размер» и нажмите Enter — отрезок станет точным.</li>
              <li>Средняя кнопка мыши — орбита, правая — панорама, колесо — зум.</li>
              <li>Кнопка 🏠 добавит пример комнаты 4×5 м с дверным проёмом.</li>
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
