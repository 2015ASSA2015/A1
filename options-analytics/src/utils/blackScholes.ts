// ─── Black-Scholes Model (Black-76 for FORTS options) ───────────────────────
// RISK_FREE = 0 for margined options (no cost of carry)

const RISK_FREE = 0;

// ─── Standard Normal Distribution ────────────────────────────────────────────

export function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  return x >= 0 ? 1 - d * p : d * p;
}

export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─── Black-Scholes Greeks ────────────────────────────────────────────────────

export function bsPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'Call' | 'Put'
): number {
  if (T <= 0) return type === 'Call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === 'Call') return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

export function bsDelta(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'Call' | 'Put'
): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return type === 'Call' ? normalCDF(d1) : normalCDF(d1) - 1;
}

export function bsGamma(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalPDF(d1) / (S * sigma * Math.sqrt(T));
}

export function bsVega(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return S * Math.sqrt(T) * normalPDF(d1) / 100; // Per 1% change in IV
}

export function bsTheta(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'Call' | 'Put'
): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const term1 = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
  const term2 = r * K * Math.exp(-r * T) * normalCDF(type === 'Call' ? d2 : -d2);
  return (type === 'Call' ? term1 - term2 : term1 + term2) / 365; // Per day
}

export function bsCharm(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: 'Call' | 'Put'
): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const term1 = normalPDF(d1) * (r / (sigma * Math.sqrt(T)) - d2 / (2 * T));
  const res = (type === 'Call' ? -term1 : term1) / 365;
  return isFinite(res) ? res : 0;
}

// ─── P&L Attribution Calculations ────────────────────────────────────────────
// Расщепление PnL на компоненты: Delta, Gamma, Vega, Theta

export interface PnLAttribution {
  deltaPnL: number;      // PnL от движения цены базового актива
  gammaPnL: number;      // PnL от ускорения дельты (convexity)
  vegaPnL: number;       // PnL от изменения волатильности
  thetaPnL: number;      // PnL от временного распада
  totalPnL: number;      // Суммарный PnL (проверка)
}

/**
 * Расчет P&L Attribution для одной ноги опциона
 * 
 * @param S_old - Старая цена базового актива
 * @param S_new - Новая цена базового актива
 * @param iv_old - Старая волатильность (IV)
 * @param iv_new - Новая волатильность (IV)
 * @param daysPassed - Сколько дней прошло
 * @param strike - Страйк опциона
 * @param type - Call или Put
 * @param position - Long или Short
 * @param qty - Количество контрактов
 * @param premium - Цена входа (премия)
 */
export function calculateLegPnLAttribution(
  S_old: number,
  S_new: number,
  iv_old: number,
  iv_new: number,
  daysPassed: number,
  strike: number,
  type: 'Call' | 'Put',
  position: 'Long' | 'Short',
  qty: number,
  premium: number
): PnLAttribution {
  const T_old = Math.max(0.001, daysPassed / 365);
  const T_new = Math.max(0.001, (daysPassed - 1) / 365); // 1 день прошёл

  const sign = position === 'Long' ? 1 : -1;

  // Базовая цена опциона (при старых параметрах)
  // const price_old = bsPrice(S_old, strike, T_old, RISK_FREE, iv_old, type);

  // Новая цена опциона (при новых параметрах)
  const price_new = bsPrice(S_new, strike, T_new, RISK_FREE, iv_new, type);

  // Общий PnL
  const totalPnL = (price_new - premium) * qty * sign;

  // === 1. Delta PnL (от движения Spot) ===
  // ΔPnL ≈ Delta × ΔS × qty × sign
  const delta = bsDelta(S_old, strike, T_old, RISK_FREE, iv_old, type);
  const deltaPnL = delta * (S_new - S_old) * qty * sign;

  // === 2. Gamma PnL (от изменения Delta) ===
  // ΔPnL ≈ 0.5 × Gamma × (ΔS)² × qty × sign
  const gamma = bsGamma(S_old, strike, T_old, RISK_FREE, iv_old);
  const gammaPnL = 0.5 * gamma * Math.pow(S_new - S_old, 2) * qty * sign;

  // === 3. Vega PnL (от изменения IV) ===
  // ΔPnL ≈ Vega × ΔIV × qty × sign
  const vega = bsVega(S_old, strike, T_old, RISK_FREE, iv_old);
  const vegaPnL = vega * (iv_new - iv_old) * 100 * qty * sign; // Vega per 1%

  // === 4. Theta PnL (временной распад) ===
  // ΔPnL ≈ Theta × daysPassed × qty × sign
  const theta = bsTheta(S_old, strike, T_old, RISK_FREE, iv_old, type);
  const thetaPnL = theta * daysPassed * qty * sign;

  // Проверка: сумма компонент должна быть близка к totalPnL
  // (с учётом cross-terms и higher-order effects может быть небольшая разница)

  return {
    deltaPnL: Math.round(deltaPnL),
    gammaPnL: Math.round(gammaPnL),
    vegaPnL: Math.round(vegaPnL),
    thetaPnL: Math.round(thetaPnL),
    totalPnL: Math.round(totalPnL)
  };
}

/**
 * Расчет P&L Attribution для всего портфеля
 */
export interface PortfolioPnLAttribution {
  deltaPnL: number;
  gammaPnL: number;
  vegaPnL: number;
  thetaPnL: number;
  totalPnL: number;
  legs: Array<{
    id: string;
    type: 'Call' | 'Put';
    strike: number;
    position: 'Long' | 'Short';
    qty: number;
    attribution: PnLAttribution;
  }>;
}

export interface OptionLegData {
  id: string;
  type: 'Call' | 'Put';
  strike: number;
  qty: number;
  premium: number;
  position: 'Long' | 'Short';
  iv: number;
}

/**
 * Расчет P&L Attribution для всего портфеля опционов
 * 
 * @param legs - Массив ног опционов
 * @param S_old - Старая цена Spot
 * @param S_new - Новая цена Spot
 * @param iv_old - Старая базовая волатильность
 * @param iv_new - Новая базовая волатильность
 * @param daysPassed - Сколько дней прошло с момента входа
 */
export function calculatePortfolioPnLAttribution(
  legs: OptionLegData[],
  S_old: number,
  S_new: number,
  iv_old: number,
  iv_new: number,
  daysPassed: number = 1
): PortfolioPnLAttribution {
  let totalDeltaPnL = 0;
  let totalGammaPnL = 0;
  let totalVegaPnL = 0;
  let totalThetaPnL = 0;
  let totalPnL = 0;

  const legAttributions = legs.map(leg => {
    const attribution = calculateLegPnLAttribution(
      S_old,
      S_new,
      iv_old,
      iv_new,
      daysPassed,
      leg.strike,
      leg.type,
      leg.position,
      leg.qty,
      leg.premium
    );

    totalDeltaPnL += attribution.deltaPnL;
    totalGammaPnL += attribution.gammaPnL;
    totalVegaPnL += attribution.vegaPnL;
    totalThetaPnL += attribution.thetaPnL;
    totalPnL += attribution.totalPnL;

    return {
      id: leg.id,
      type: leg.type,
      strike: leg.strike,
      position: leg.position,
      qty: leg.qty,
      attribution
    };
  });

  return {
    deltaPnL: Math.round(totalDeltaPnL),
    gammaPnL: Math.round(totalGammaPnL),
    vegaPnL: Math.round(totalVegaPnL),
    thetaPnL: Math.round(totalThetaPnL),
    totalPnL: Math.round(totalPnL),
    legs: legAttributions
  };
}

// ─── Current Greeks PnL (мгновенная оценка) ──────────────────────────────────
// Расчет PnL Attribution на основе текущих греков портфеля

export interface CurrentGreeksPnL {
  deltaPnL: number;      // PnL от текущего движения Spot
  vegaPnL: number;       // PnL от текущего изменения IV
  thetaPnL: number;      // PnL от распада за день
  gammaPnL: number;      // PnL от gamma-ускорения
  totalPnL: number;
}

/**
 * Мгновенная оценка P&L Attribution на основе текущих греков
 * Использует приближенную формулу: ΔPnL ≈ Δ×ΔS + ½×Γ×(ΔS)² + ν×ΔIV + Θ×Δt
 */
export function calculateCurrentGreeksPnL(
  legs: OptionLegData[],
  S_current: number,
  S_entry: number,      // Цена Spot при входе в позицию
  iv_current: number,
  iv_entry: number,     // IV при входе
  daysHeld: number = 0  // Дней в позиции
): CurrentGreeksPnL {
  const T = Math.max(0.001, (82 - daysHeld) / 365); // Оставшееся время
  const deltaT = Math.max(1, daysHeld);

  let totalDelta = 0;
  let totalGamma = 0;
  let totalVega = 0;
  let totalTheta = 0;
  let totalPnL = 0;

  legs.forEach(leg => {
    const sign = leg.position === 'Long' ? 1 : -1;
    const mult = leg.qty * sign;
    const currentIV = leg.iv || iv_current;

    // Текущая цена опциона
    const currentPrice = bsPrice(S_current, leg.strike, T, RISK_FREE, currentIV, leg.type);
    const entryPrice = leg.premium;
    totalPnL += (currentPrice - entryPrice) * mult;

    // Греки
    const delta = bsDelta(S_current, leg.strike, T, RISK_FREE, currentIV, leg.type);
    const gamma = bsGamma(S_current, leg.strike, T, RISK_FREE, currentIV);
    const vega = bsVega(S_current, leg.strike, T, RISK_FREE, currentIV);
    const theta = bsTheta(S_current, leg.strike, T, RISK_FREE, currentIV, leg.type);

    totalDelta += delta * mult;
    totalGamma += gamma * mult;
    totalVega += vega * mult;
    totalTheta += theta * mult;
  });

  const dS = S_current - S_entry;
  const dIV = iv_current - iv_entry;

  // ΔPnL ≈ Δ×ΔS + ½×Γ×(ΔS)² + ν×ΔIV + Θ×Δt
  const deltaPnL = totalDelta * dS;
  const gammaPnL = 0.5 * totalGamma * Math.pow(dS, 2);
  const vegaPnL = totalVega * dIV * 100; // Vega per 1%
  const thetaPnL = totalTheta * deltaT;

  return {
    deltaPnL: Math.round(deltaPnL),
    gammaPnL: Math.round(gammaPnL),
    vegaPnL: Math.round(vegaPnL),
    thetaPnL: Math.round(thetaPnL),
    totalPnL: Math.round(totalPnL)
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { RISK_FREE };
