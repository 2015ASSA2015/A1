# Code Review — Рекомендации по улучшению

## 🔴 Критические проблемы

### 1. Дублирование Black-Scholes функций
Функции `normalCDF`, `normalPDF`, `bsPrice`, `bsDelta`, `bsGamma`, `bsVega`, `bsTheta`, `bsCharm` определены **дважды** — в `src/utils/blackScholes.ts` и внутри `src/App.tsx` (строки 42-97). Это главная проблема: расхождение логики, увеличение баг-поверхности.

**Рекомендация:** Удалить дубликаты из `App.tsx`, импортировать всё из `blackScholes.ts`.

### 2. Монолитный App.tsx (922 строки)
Весь UI, state, логика, расчёты, константы — в одном файле. Это критически усложняет поддержку.

**Рекомендация:** Разбить на:
- `src/constants/assets.ts` — ASSETS, RISK_FREE, IV, colors
- `src/hooks/useChartData.ts` — генерация данных для графиков
- `src/hooks/useOptionBoard.ts` — опционный стакан
- `src/hooks/useLiveSimulator.ts` — симулятор цен
- `src/components/OptionBoard.tsx` — таблица опционов
- `src/components/StrategyProfile.tsx` — P&L график
- `src/components/GreeksPanel.tsx` — Greeks панель
- `src/components/Header.tsx` — шапка

---

## 🟠 Архитектурные улучшения

### 3. Нет типизации для бизнес-логики
`OptionLeg` интерфейс определён в `App.tsx`, `OptionLegData` в `blackScholes.ts` — два разных типа для сущего одного.

**Рекомендация:** Вынести в `src/types/options.ts` единый `OptionLeg` и использовать его везде.

### 4. Нет состояния приложения (state management)
Всё на `useState` в корневом компоненте — 15+ переменных состояния, которые передаются через пропсы.

**Рекомендация:** Рассмотреть `useReducer` + Context, либо Zustand (лёгкая библиотека без boilerplate).

### 5. Нет тестов
Ни единого теста. Численные расчёты (Black-Scholes, Greeks, P&L attribution) критически важно тестировать.

**Рекомендация:** Добавить Vitest:
```bash
npm i -D vitest @testing-library/react @testing-library/jest-dom
```
Начать с unit-тестов для `blackScholes.ts` — сравнить с эталонными значениями.

### 6. Нет валидации входных данных
Нет проверки: отрицательные strikes, нулевой IV, T < 0, NaN в расчётах.

**Рекомендация:** Добавить guard clauses в математические функции.

---

## 🟡 Качество кода

### 7. Магические числа
`800` (ms для тика), `0.25` (IV), `300` (точек графика), `30` (дней по умолчанию), `0.6` (range multiplier) — всё хардкод.

**Рекомендация:** Вынести в именованные константы:
```typescript
const TICK_INTERVAL_MS = 800;
const DEFAULT_IV = 0.25;
const CHART_POINTS = 300;
```

### 8. Смешанный язык UI
Интерфейс на русском, но названия переменных, комментарии, лейблы — микс русского и английского.

**Рекомендация:** Выбрать один язык для UI (русский), использовать i18n если планируется мультиязычность.

### 9. CSS — один файл 629 строк
Всё в `App.css` без модульности.

**Рекомендация:** Использовать CSS Modules (`App.module.css`, `OptionBoard.module.css`) или перейти на Tailwind/styled-components.

### 10. Нет path aliases
Импорты вида `../../utils/blackScholes` — трудно рефакторить.

**Рекомендация:** Добавить в `vite.config.ts` и `tsconfig.app.json`:
```typescript
resolve: { alias: { '@': '/src' } }
```

---

## 🟢 Функциональные улучшения

### 11. Нет обработки ошибок
Нет Error Boundary, нет try-catch, нет fallback UI.

**Рекомендация:** Добавить React Error Boundary и обработку edge cases в расчётах.

### 12. Производительность — useMemo отсутствует для тяжёлых расчётов
`chartData`, `greeksData`, `optionBoardData` пересчитываются при каждом рендере без мемоизации.

**Рекомендация:** Обернуть тяжёлые вычисления в `useMemo` с правильными зависимостями.

### 13. Live simulator не останавливается корректно
`useEffect` с `setInterval` не всегда очищается при размонтировании.

**Рекомендация:** Проверить cleanup функцию в `useEffect` для `isLive`.

### 14. Нет Prettier
Нет автоформатирования — риск несогласованного стиля.

**Рекомендация:** `npm i -D prettier`, создать `.prettierrc`, добавить `format` скрипт.

### 15. README — стандартный Vite boilerplate
Опционы-аналитика заслуживает описания: что делает, как запустить, архитектура.

### 16. dist/ в репозитории
Папка `dist/` закоммичена — это артефакт сборки, не должен быть в git.

**Рекомендация:** Удалить из репозитория, убедиться что `.gitignore` содержит `dist/`.

---

## Сводка приоритетов

| Приоритет | Что делать | Сложность |
|-----------|-----------|-----------|
| P0 | Убрать дублирование Black-Scholes из App.tsx | Низкая |
| P0 | Удалить dist/ из git | Низкая |
| P1 | Разбить App.tsx на компоненты/хуки | Средняя |
| P1 | Добавить unit-тесты для math utils | Средняя |
| P1 | Объединить OptionLeg/OptionLegData | Низкая |
| P2 | Добавить path aliases и Prettier | Низкая |
| P2 | Вынести магические числа в константы | Низкая |
| P2 | useMemo для тяжёлых вычислений | Низкая |
| P3 | CSS Modules или Tailwind | Средняя |
| P3 | State management (Zustand/useReducer) | Средняя |
| P3 | Error Boundary + валидация | Средняя |
