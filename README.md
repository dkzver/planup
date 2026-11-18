# PlanUp

Веб-редактор планировок помещений для дизайнеров. Рисуйте линии и стены, выдавливайте объёмы, осматривайте модель орбитой — как в SketchUp, только в браузере.

**Не является продуктом Trimble SketchUp.** Чистый-room MVP: свои названия, свои ассеты, открытые форматы.

## Live

- GitHub Pages: <https://dkzver.github.io/planup/>
- Редактор: <https://dkzver.github.io/planup/#/editor>

Нужен браузер с WebGL (Chrome, Edge, Firefox).

## Страницы

- `#/` — лендинг (без авторизации)
- `#/editor` — 3D-редактор

## Стек

- Vite + React + TypeScript
- Three.js (viewport)
- react-router-dom (HashRouter — работает на Pages и Render без rewrite-магии)
- Статический деплой: GitHub Pages + `render.yaml` для Render

## Редактор

- Инструмент **Стена**: клики по углам → стены заданной высоты/толщины
- **Линия** + замыкание контура → плоскость
- **Прямоугольник** → плоскость пола
- **Push/Pull** — выдавливание
- Снап к сетке 10 см, вершинам, осям X/Z
- Поле «Размер» (VCB): точные длины во время рисования
- Орбита — средняя кнопка мыши, панорама — правая
- Undo/Redo, пример комнаты 4×5, сохранение в localStorage, экспорт/импорт JSON

## Запуск

```bash
npm ci
npm run dev
```

## Сборка

```bash
npm run build
```

## Deploy

### GitHub Pages

Ветка `gh-pages` обновляется командой:

```bash
npm run build
npx gh-pages -d dist
```

Pages настроен на branch `gh-pages`, `/` .

### Render

В репозитории есть `render.yaml` (static site, SPA). Чтобы поднять на Render:

1. Зайдите на <https://dashboard.render.com> через GitHub.
2. **New → Static Site** → подключите `dkzver/planup`.
3. Render прочитает `render.yaml` (build: `npm ci && npm run build`, publish: `dist`, rewrite на `index.html`).
4. Deploy.

Либо создайте Deploy Hook и добавьте его в GitHub Secrets как `RENDER_DEPLOY_HOOK_URL` — тогда можно пушить автодеплой.
