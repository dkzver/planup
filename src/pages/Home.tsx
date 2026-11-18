import { Link } from 'react-router-dom'

const features = [
  {
    icon: '✏️',
    title: 'Линии и стены',
    text: 'Рисуйте контур помещения линиями или сразу стенами. Снап к сетке, осям и вершинам — как в SketchUp.',
  },
  {
    icon: '🧱',
    title: 'Push/Pull',
    text: 'Замкнули контур — выдавите его в объём. Пол, подиум, перекрытие, объёмная ниша.',
  },
  {
    icon: '🎥',
    title: 'Орбита как в оригинале',
    text: 'Средняя кнопка — орбита, правая — панорама, колесо — зум. Привычно после SketchUp.',
  },
  {
    icon: '📐',
    title: 'Точные размеры',
    text: 'Во время рисования введите длину в поле VCB — линия или стена станут точными.',
  },
  {
    icon: '🏠',
    title: 'Для дизайнеров',
    text: 'Стены заданной толщины и высоты, метры, пример комнаты в один клик. Без лишнего CAD.',
  },
  {
    icon: '💾',
    title: 'Проект в браузере',
    text: 'Пока без авторизации: черновик живёт в localStorage. Скачайте JSON, чтобы не потерять.',
  },
]

export default function Home() {
  return (
    <div className="home">
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="logo">
            <span className="logo-mark">▲</span> PlanUp
          </Link>
          <nav className="nav-links">
            <a href="#features">Возможности</a>
            <a href="#how">Как это работает</a>
            <Link to="/editor" className="btn btn-ghost">Редактор</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <p className="eyebrow">Для дизайнеров интерьера и планировщиков</p>
          <h1>
            Планируйте помещения <br />
            <span className="grad">как в SketchUp</span> — в браузере
          </h1>
          <p className="lede">
            Рисуйте линии, замыкайте контур, выдавливайте объём, ставьте стены.
            Ничего устанавливать не нужно. Авторизация позже — сейчас просто откройте редактор.
          </p>
          <div className="hero-cta">
            <Link to="/editor" className="btn btn-primary btn-lg">
              Перейти в редактор →
            </Link>
            <a href="#how" className="btn btn-ghost btn-lg">
              Как это работает
            </a>
          </div>
          <div className="hero-preview" aria-hidden>
            <div className="preview-window">
              <div className="preview-bar">
                <i /><i /><i />
                <span>planup / редактор</span>
              </div>
              <div className="preview-body">
                <div className="preview-toolbar">
                  <span className="on">▸</span><span>▭</span><span>▬</span><span>⟊</span><span>✋</span>
                </div>
                <div className="preview-canvas">
                  <svg viewBox="0 0 520 300" className="preview-svg">
                    <defs>
                      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#dbeafe"/>
                        <stop offset="1" stopColor="#f8fafc"/>
                      </linearGradient>
                    </defs>
                    <rect width="520" height="300" fill="url(#sky)"/>
                    <g stroke="#cbd5e1" strokeWidth="1">
                      {Array.from({length: 13}, (_,i)=>(
                        <line key={'v'+i} x1={i*40} y1="0" x2={i*40} y2="300"/>
                      ))}
                      {Array.from({length: 8}, (_,i)=>(
                        <line key={'h'+i} x1="0" y1={i*40} x2="520" y2={i*40}/>
                      ))}
                    </g>
                    {/* isometric room */}
                    <g transform="translate(160,90)">
                      <path d="M0 80 L100 40 L200 80 L100 120 Z" fill="#e0e7ff" stroke="#1a73e8" strokeWidth="2"/>
                      <path d="M0 80 L0 40 L100 0 L100 40 Z" fill="#bfdbfe" stroke="#1a73e8" strokeWidth="2"/>
                      <path d="M100 40 L100 0 L200 40 L200 80 Z" fill="#dbeafe" stroke="#1a73e8" strokeWidth="2"/>
                      <path d="M40 78 L40 58 L80 42 L80 62 Z" fill="#f59e0b" opacity="0.85" stroke="#b45309"/>
                      <line x1="100" y1="0" x2="100" y2="40" stroke="#1a73e8" strokeWidth="2" strokeDasharray="4 3"/>
                      <circle cx="100" cy="0" r="4" fill="#1a73e8"/>
                    </g>
                    <text x="290" y="230" fontSize="12" fill="#64748b">4.00 м</text>
                    <line x1="270" y1="220" x2="330" y2="220" stroke="#64748b"/>
                  </svg>
                </div>
                <div className="preview-vcb">Длина: 4.00 м</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="section">
        <div className="section-inner">
          <h2>Что уже умеет редактор</h2>
          <div className="grid">
            {features.map((f) => (
              <article key={f.title} className="card">
                <div className="card-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="section alt">
        <div className="section-inner">
          <h2>Как нарисовать комнату за минуту</h2>
          <ol className="steps">
            <li>
              <b>Откройте редактор.</b> Слева инструменты, снизу — строка точных размеров.
            </li>
            <li>
              <b>Инструмент «Стена».</b> Кликните точки контура. Каждая линия становится стеной
              (толщина 10 см, высота 2,7 м — меняется в панели справа).
            </li>
            <li>
              <b>Или линии + Push/Pull.</b> Нарисуйте прямоугольник пола и выдавите его вверх —
              получится объём.
            </li>
            <li>
              <b>Орбита.</b> Зажмите среднюю кнопку мыши и осмотрите план.
            </li>
            <li>
              <b>Сохраните.</b> Проект лежит в браузере; кнопка «Экспорт JSON» скачает файл.
            </li>
          </ol>
          <div className="hero-cta">
            <Link to="/editor" className="btn btn-primary btn-lg">Начать планирование →</Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="section-inner">
          <span>PlanUp · MVP для дизайнеров · не является продуктом Trimble SketchUp</span>
          <Link to="/editor">Открыть редактор</Link>
        </div>
      </footer>
    </div>
  )
}
