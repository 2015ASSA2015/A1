import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, ReferenceArea } from 'recharts';
import { Server, Activity, TrendingUp, BarChart3, Triangle } from 'lucide-react';
import './App.css';

// ─── Constants & Types ───────────────────────────────────────────────────────

const RISK_FREE = 0; // Fixed: FORTS margined options use r=0 because there is no cost of carry or discounting
const IV = 0.25;
const TIME_LINE_COLORS = [
  '#f59e0b', // T+0 (Orange)
  '#d946ef', // T+1 (Magenta)
  '#a855f7', // T+2 (Purple)
  '#8b5cf6', // T+3 (Violet)
  '#6366f1', // T+4 (Indigo)
  '#3b82f6', // T+5 (Blue)
  '#0ea5e9', // T+6 (Sky)
  '#10b981'  // Expiry (Green)
];

const ASSETS = [
  { id: 'Si', name: 'Si (USD/RUB)', symbol: 'SI-6.26', defaultSpot: 103450, step: 250 },
  { id: 'SR', name: 'SBER (Sberbank)', symbol: 'SR-6.26', defaultSpot: 28550, step: 250 },
  { id: 'GZ', name: 'GAZP (Gazprom)', symbol: 'GZ-6.26', defaultSpot: 16180, step: 100 },
  { id: 'BR', name: 'Brent Oil', symbol: 'BR-5.26', defaultSpot: 84.2, step: 0.5 },
];

interface OptionLeg {
  id: string;
  type: 'Call' | 'Put';
  strike: number;
  qty: number;
  premium: number;
  position: 'Long' | 'Short';
  iv: number;
}



// ─── Math Utilities (Black-Scholes-76) ────────────────────────────────────────

function normalCDF(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  return x >= 0 ? 1 - d * p : d * p;
}

function normalPDF(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsPrice(S: number, K: number, T: number, r: number, sigma: number, type: 'Call' | 'Put') {
  if (T <= 0) return type === 'Call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === 'Call') return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function bsDelta(S: number, K: number, T: number, r: number, sigma: number, type: 'Call' | 'Put') {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return type === 'Call' ? normalCDF(d1) : normalCDF(d1) - 1;
}

function bsGamma(S: number, K: number, T: number, r: number, sigma: number) {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalPDF(d1) / (S * sigma * Math.sqrt(T));
}

function bsVega(S: number, K: number, T: number, r: number, sigma: number) {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return S * Math.sqrt(T) * normalPDF(d1) / 100;
}

function bsTheta(S: number, K: number, T: number, r: number, sigma: number, type: 'Call' | 'Put') {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const term1 = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
  const term2 = r * K * Math.exp(-r * T) * normalCDF(type === 'Call' ? d2 : -d2);
  return (type === 'Call' ? term1 - term2 : term1 + term2) / 365;
}

function bsCharm(S: number, K: number, T: number, r: number, sigma: number, type: 'Call' | 'Put') {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const term1 = normalPDF(d1) * (r / (sigma * Math.sqrt(T)) - d2 / (2 * T));
  const res = (type === 'Call' ? -term1 : term1) / 365;
  return isFinite(res) ? res : 0;
}


// ─── App Component ───────────────────────────────────────────────────────────

function App() {
  const [apiStatus] = useState<'connected' | 'error'>('connected');
  const [strikeCount, setStrikeCount] = useState(20);
  const [selectedAsset, setSelectedAsset] = useState(ASSETS[0]);
  const [spotPrice, setSpotPrice] = useState(ASSETS[0].defaultSpot);
  const [selectedExpiry, setSelectedExpiry] = useState('2026-06-18');
  const [totalDTE, setTotalDTE] = useState(82);
  const [timeStepDays, setTimeStepDays] = useState(1);
  const [legs, setLegs] = useState<OptionLeg[]>([]);
  const [isLive, setIsLive] = useState(false);

  // ─── Live Market Simulator ───────────────────────────────────────────────
  
  useEffect(() => {
    if (!isLive) return;
    
    // Simulate tick data every 800ms
    const interval = setInterval(() => {
      setSpotPrice(prev => {
        // Simple random walk with slightly mean-reverting drift
        const asset = ASSETS[0];
        const volatility = asset.step * 0.4; 
        const change = (Math.random() - 0.5) * volatility;
        return Math.round(prev + change);
      });
    }, 800);
    
    return () => clearInterval(interval);
  }, [isLive]);

  // ─── Dynamic DTE Calculation ───────────────────────────────────────────────
  useEffect(() => {
    const today = new Date('2026-03-29'); // Baseline from system metadata
    const expiryDate = new Date(selectedExpiry);
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setTotalDTE(Math.max(0, diffDays));
  }, [selectedExpiry]);

  // Generate steps: T+0, T+n, ... and Expiry based on user-defined timeStepDays
  const timeSteps = useMemo(() => {
    const steps = [];
    const maxLines = 6;

    for (let i = 0; i <= maxLines; i++) {
        const daysForward = i * timeStepDays;
        if (daysForward < totalDTE) {
            steps.push({
                key: `pnl_${i}`,
                label: i === 0 ? 'T+0 (сейчас)' : `T+${daysForward}`,
                dte: totalDTE - daysForward
            });
        }
    }
    
    steps.push({
        key: `pnl_exp`,
        label: `Экспирация (T+${totalDTE})`,
        dte: 0
    });

    return steps;
  }, [totalDTE, timeStepDays]);

  // ─── Chart Interactivity State ───────────────────────────────────────────────
  
  const boardRange = useMemo(() => {
    const step = selectedAsset.step;
    const half = Math.floor(strikeCount / 2);
    const min = Math.round(spotPrice / step) * step - half * step;
    const max = min + (strikeCount - 1) * step;
    return { min, max, step };
  }, [strikeCount, spotPrice, selectedAsset]);

  const [chartRange, setChartRange] = useState({ min: spotPrice * 0.95, max: spotPrice * 1.05 });
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);

  const axisTicks = useMemo(() => {
    const ticks = [];
    for (let s = boardRange.min; s <= boardRange.max; s += 500) {
      ticks.push(s);
    }
    return ticks;
  }, [boardRange]);

  useEffect(() => {
    setChartRange({ min: boardRange.min - 500, max: boardRange.max + 500 });
  }, [boardRange]);

  const resetChart = () => {
    setChartRange({ min: boardRange.min - 500, max: boardRange.max + 500 });
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomFactor = 0.1;
    const delta = e.deltaY > 0 ? 1 : -1;
    const width = chartRange.max - chartRange.min;
    const amount = width * zoomFactor * delta;
    setChartRange({
      min: chartRange.min - amount / 2,
      max: chartRange.max + amount / 2
    });
  };

  const handleMouseDown = (e: any) => e && setRefAreaLeft(e.activeLabel);
  const handleMouseMove = (e: any) => refAreaLeft !== null && e && setRefAreaRight(e.activeLabel);
  const handleMouseUp = () => {
    if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) {
      let [l, r] = [Number(refAreaLeft), Number(refAreaRight)];
      if (l > r) [l, r] = [r, l];
      setChartRange({ min: l, max: r });
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  // ─── Data Generation ────────────────────────────────────────────────────────

  const optionBoardData = useMemo(() => {
    const data = [];
    const { min, step } = boardRange;
    
    for (let i = 0; i < strikeCount; i++) {
      const strike = min + i * step;
      // Mathematically realistic quadratic Volatility Smile with right-tail skew (typical for Si).
      // Model: IV(K) = ATM_IV + Slope*M + Convexity*M^2 (where M is relative moneyness % distance).
      const m = (strike - spotPrice) / spotPrice;
      const atmIV = 0.20;
      const slope = 0.15; // Represents 'fear' dragging IV higher on the right tail (Calls)
      const convexity = 12.0;

      const baseIV = atmIV + (slope * m) + (convexity * m * m);
      const modeledIV = Math.max(0.15, baseIV); // Floor at 15%

      const callIV = modeledIV;
      const putIV = modeledIV;
      const T = totalDTE / 365;
      
      const callPrice = bsPrice(spotPrice, strike, T, RISK_FREE, callIV, 'Call');
      const putPrice = bsPrice(spotPrice, strike, T, RISK_FREE, putIV, 'Put');
      
      const callDelta = bsDelta(spotPrice, strike, T, RISK_FREE, callIV, 'Call');
      const putDelta = bsDelta(spotPrice, strike, T, RISK_FREE, putIV, 'Put');
      
      // Simulated Liquidity: peaks near ATM and psychological round strikes
      const dist = Math.abs(strike - spotPrice) / spotPrice;
      const baseVol = 8000 * Math.exp(-Math.pow(dist * 18, 2)); 
      const roundSpike = strike % 5000 === 0 ? 6000 : 0;
      const callVol = Math.round(baseVol + roundSpike * (0.5 + Math.random() * 0.5)) + Math.floor(Math.random() * 100);
      const putVol = Math.round(baseVol + roundSpike * (0.5 + Math.random() * 0.5)) + Math.floor(Math.random() * 100);
      
      data.push({
        strike,
        callVol,
        callBid: Math.round(callPrice * 0.998),
        callAsk: Math.round(callPrice * 1.002),
        callIV,
        callDelta,
        putVol,
        putBid: Math.round(putPrice * 0.998),
        putAsk: Math.round(putPrice * 1.002),
        putIV,
        putDelta,
      });
    }
    return data;
  }, [strikeCount, totalDTE]);

  const smileData = useMemo(() => {
    return optionBoardData.map(d => ({
      strike: d.strike,
      iv: Number((Math.max(d.callIV, d.putIV) * 100).toFixed(2))
    }));
  }, [optionBoardData]);

  const chartData = useMemo(() => {
    if (legs.length === 0) return [];
    const points = [];
    const pointPrices = new Set<number>();
    const minPrice = spotPrice * 0.7;
    const maxPrice = spotPrice * 1.3;
    const stepCount = 300;
    const stepSize = (maxPrice - minPrice) / stepCount;

    // Add regular steps
    for (let i = 0; i <= stepCount; i++) {
       pointPrices.add(Math.round(minPrice + i * stepSize));
    }
    // CRITICAL: Add all strikes to perfectly capture "corners"
    legs.forEach(l => pointPrices.add(l.strike));
    
    const sortedPrices = Array.from(pointPrices).sort((a,b) => a - b);

    for (const p of sortedPrices) {
      const point: any = { price: p };
      timeSteps.forEach((step, idx) => {
        const T = step.dte / 365;
        const isExp = step.dte === 0;
        let pnl = 0;
        legs.forEach(leg => {
          let val = 0;
          if (isExp) {
            val = leg.type === 'Call' ? Math.max(0, p - leg.strike) : Math.max(0, leg.strike - p);
          } else {
            val = bsPrice(p, leg.strike, T, RISK_FREE, leg.iv || IV, leg.type);
          }
          const mult = leg.position === 'Long' ? 1 : -1;
          pnl += (val - leg.premium) * leg.qty * mult;
        });
        point[step.key] = Math.round(pnl);
      });
      points.push(point);
    }
    return points;
  }, [legs, totalDTE, timeSteps]);

  const greeksData = useMemo(() => {
    if (legs.length === 0) return [];
    const points = [];
    const minPrice = chartRange.min;
    const maxPrice = chartRange.max;
    const step = (maxPrice - minPrice) / 50;

    for (let p = minPrice; p <= maxPrice; p += step) {
      const point: any = { price: Math.round(p) };
      timeSteps.forEach((stepItem) => {
        const T = Math.max(0.001, stepItem.dte) / 365;
        const key = stepItem.key.replace('pnl', ''); // uses _0, _1, _exp
        let d = 0, g = 0, v = 0, th = 0, chm = 0;
        legs.forEach(leg => {
          const mult = leg.qty * (leg.position === 'Long' ? 1 : -1);
          if (stepItem.dte === 0) {
            if (leg.type === 'Call') {
              d += p > leg.strike ? 1 * (leg.position === 'Long' ? 1 : -1) : 0;
            } else {
              d += p < leg.strike ? -1 * (leg.position === 'Long' ? 1 : -1) : 0;
            }
            g += bsGamma(p, leg.strike, 0.0001 / 365, RISK_FREE, leg.iv || IV) * mult;
            v += 0;
            th += 0;
            chm += 0;
          } else {
            const currentIV = leg.iv || IV;
            d += bsDelta(p, leg.strike, T, RISK_FREE, currentIV, leg.type) * mult;
            g += bsGamma(p, leg.strike, T, RISK_FREE, currentIV) * mult;
            v += bsVega(p, leg.strike, T, RISK_FREE, currentIV) * mult;
            th += bsTheta(p, leg.strike, T, RISK_FREE, currentIV, leg.type) * mult;
            chm += bsCharm(p, leg.strike, T, RISK_FREE, currentIV, leg.type) * mult;
          }
        });
        point[`delta${key}`] = isFinite(d) ? d : 0;
        point[`gamma${key}`] = isFinite(g) ? g : 0;
        point[`vega${key}`] = isFinite(v) ? v : 0;
        point[`theta${key}`] = isFinite(th) ? th : 0;
        point[`charm${key}`] = isFinite(chm) ? chm : 0;
      });
      points.push(point);
    }
    return points;
  }, [legs, totalDTE, chartRange, timeSteps]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const addLeg = (type: 'Call' | 'Put', pos: 'Long' | 'Short', strike: number, premium: number, iv: number) => {
    const id = `${type}-${strike}-${Date.now()}`;
    setLegs([...legs, { id, type, strike, qty: 1, premium, position: pos, iv }]);
  };

  const updateLeg = (id: string, updates: Partial<OptionLeg>) => {
    setLegs(legs.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLeg = (id: string) => setLegs(legs.filter(l => l.id !== id));

  const totalPremium = legs.reduce((sum, l) => sum + (l.premium * l.qty * (l.position === 'Long' ? -1 : 1)), 0);
  const maxRisk = useMemo(() => {
    if (legs.length === 0 || timeSteps.length === 0 || chartData.length === 0) return null;
    const lastKey = timeSteps[timeSteps.length - 1].key;
    const expPnL = chartData.map(p => p[lastKey]);
    return Math.abs(Math.min(...expPnL, 0));
  }, [chartData, timeSteps, legs]);

  const maxProfit = useMemo(() => {
    if (legs.length === 0 || timeSteps.length === 0 || chartData.length === 0) return null;
    const lastKey = timeSteps[timeSteps.length - 1].key;
    const expPnL = chartData.map(p => p[lastKey]);
    return Math.max(...expPnL, 0);
  }, [chartData, timeSteps, legs]);

  // MOEX / FORTS Margin Proxy: uses the ±30% bounds worst-case scan (similar to SPAN)
  const marginGO = maxRisk !== null ? Math.max(maxRisk, 1) : 0; 
  const roc = maxProfit !== null && marginGO > 1 ? (maxProfit / marginGO) * 100 : 0;
  const annualizedRoc = totalDTE > 0 ? roc * (365 / Math.max(1, totalDTE)) : roc * 365;

  // Expected Move (1 Standard Deviation / 68.2% Probability) calculation
  const expectedMove = useMemo(() => {
    const atmIV = 0.20; // Base market volatility proxy for cone
    const T = Math.max(0.001, totalDTE) / 365;
    const move = spotPrice * atmIV * Math.sqrt(T);
    return {
      lower: Math.round(spotPrice - move),
      upper: Math.round(spotPrice + move)
    };
  }, [spotPrice, totalDTE]);

  // Find exact zero PnL crossings and calculate analytical Probability of Profit (POP)
  const { breakevens, pop } = useMemo(() => {
    if (legs.length === 0 || timeSteps.length === 0 || chartData.length === 0) return { breakevens: [], pop: null };
    const lastKey = timeSteps[timeSteps.length - 1].key;
    const bes: number[] = [];
    
    // Scan vertices for algorithmic crossings
    for (let i = 0; i < chartData.length - 1; i++) {
      const p1 = chartData[i].price, v1 = chartData[i][lastKey];
      const p2 = chartData[i+1].price, v2 = chartData[i+1][lastKey];
      if (v1 === 0 && (i === 0 || chartData[i-1][lastKey] !== 0)) {
        bes.push(p1);
      } else if (v1 * v2 < 0) {
        const ratio = Math.abs(v1) / (Math.abs(v1) + Math.abs(v2));
        bes.push(Math.round(p1 + ratio * (p2 - p1)));
      }
    }

    // Integrate profitable areas using Lognormal CDF
    let profitProb = 0;
    const T = Math.max(0.001, totalDTE) / 365;
    const atmIV = 0.20;
    const cdf = (x: number) => {
       const d2 = (Math.log(spotPrice / x) - (atmIV * atmIV / 2) * T) / (atmIV * Math.sqrt(T));
       return normalCDF(-d2);
    };

    const bounds = [0, ...bes, chartData[chartData.length-1].price * 10]; // [0 ... BEs ... Infinity]
    for (let i = 0; i < bounds.length - 1; i++) {
        const midPoint = (bounds[i] + bounds[i+1]) / 2;
        let pnl = 0;
        legs.forEach(leg => {
           let val = leg.type === 'Call' ? Math.max(0, midPoint - leg.strike) : Math.max(0, leg.strike - midPoint);
           pnl += (val - leg.premium) * leg.qty * (leg.position === 'Long' ? 1 : -1);
        });
        if (pnl > 0) profitProb += (cdf(bounds[i+1]) - (bounds[i] === 0 ? 0 : cdf(bounds[i])));
    }
    
    return { 
      breakevens: [...new Set(bes)].sort((a,b)=>a-b), 
      pop: Math.min(100, Math.max(0, profitProb * 100)) 
    };
  }, [chartData, timeSteps, legs, spotPrice, totalDTE]);

  const GREEKS_META = [
    { key: 'delta', label: 'Delta (Δ)', color: '#10b981', unit: '' },
    { key: 'gamma', label: 'Gamma (Γ)', color: '#8b5cf6', unit: '' },
    { key: 'vega', label: 'Vega (v) / 1%', color: '#f59e0b', unit: '' },
    { key: 'theta', label: 'Theta (θ) / day', color: '#ef4444', unit: '' },
    { key: 'charm', label: 'Charm / day', color: '#3b82f6', unit: '' },
  ];

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand">
          <Server className="text-secondary" />
          <div className="brand-text">
            <h1>Antigravity</h1>
            <span className="text-muted">Options Analytics</span>
          </div>
        </div>

        <div className="global-nav">
          <div className="nav-group">
            <span className="nav-label">Рынок:</span>
            <div className="button-glass active" style={{ fontSize: 13, background: 'rgba(59, 130, 246, 0.2)', borderColor: '#3b82f6' }}>Срочный (FORTS)</div>
          </div>
          
          <div className="nav-group border-left">
            <span className="nav-label">Актив:</span>
            <select 
              className="select-glass focus-asset" 
              value={selectedAsset.id} 
              onChange={e => {
                const asset = ASSETS.find(a => a.id === e.target.value)!;
                setSelectedAsset(asset);
                setSpotPrice(asset.defaultSpot);
              }}
            >
              {ASSETS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="nav-group border-left">
            <span className="nav-label">Экспирация:</span>
            <select className="select-glass" value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}>
              <option value="2026-04-02">02 APR 26 (НЕДЕЛ.)</option>
              <option value="2026-04-16">16 APR 26 (МЕС.)</option>
              <option value="2026-06-18">18 JUN 26 (КВАРТ.)</option>
            </select>
          </div>

          <div className="nav-group border-left">
            <span className="nav-label">Шаг:</span>
            <input 
              type="number" 
              className="input-glass" 
              value={timeStepDays} 
              onChange={e => setTimeStepDays(Math.max(1, Number(e.target.value)))} 
              style={{ width: 45, padding: '2px 4px', textAlign: 'center' }}
              title="Шаг распада (в днях)"
            />
            <span className="nav-label" style={{ marginLeft: 4 }}>дн.</span>
          </div>

          <div className="nav-group border-left">
            <span className="nav-label">Spot:</span>
            <div className="spot-input-wrapper">
              <input 
                type="number" 
                className="input-glass spot-main-input" 
                value={spotPrice} 
                onChange={e => setSpotPrice(Number(e.target.value))} 
              />
              <TrendingUp size={14} className="spot-icon" />
            </div>
          </div>
        </div>

        <div className="top-info">
          <div 
            className={`api-status ${isLive ? 'connected' : 'offline'}`}
            onClick={() => setIsLive(!isLive)}
            style={{ cursor: 'pointer', transition: 'all 0.3s' }}
            title={isLive ? "Остановить симуляцию" : "Запустить симулятор потока"}
          >
            <Activity size={14} color={isLive ? '#10b981' : '#a1a1aa'} />
            <span style={{ color: isLive ? '#10b981' : '#a1a1aa' }}>{isLive ? 'LIVE SIM' : 'SIM OFF'}</span>
          </div>
        </div>
      </header>

      <div className="main-content">
        {/* Sidebar: Options Board */}
        <aside className="sidebar glass-panel widget">
          <div className="widget-header">
            <div className="widget-title">
              <BarChart3 size={18} className="text-secondary" />
              Options Board
            </div>
            <div style={{ fontSize: 12 }}>Spot: <strong>{spotPrice}</strong></div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
            <div className="strike-count-toggle">
              {[10, 20, 30].map(n => (
                <button key={n} className={strikeCount === n ? 'active' : ''} onClick={() => setStrikeCount(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="board-container" style={{ maxHeight: '60%', overflowY: 'auto' }}>
            <table className="board-table">
              <thead>
                <tr>
                  <th colSpan={5}>Calls</th>
                  <th>K</th>
                  <th colSpan={5}>Puts</th>
                </tr>
                <tr>
                  <th style={{ fontSize: 9 }}>Vol / O.I.</th>
                  <th style={{ fontSize: 9 }}>IV</th>
                  <th style={{ fontSize: 9 }}>Delta</th>
                  <th style={{ fontSize: 9 }}>Bid</th>
                  <th style={{ fontSize: 9 }}>Ask</th>
                  <th style={{ fontSize: 9 }}>Strike</th>
                  <th style={{ fontSize: 9 }}>Bid</th>
                  <th style={{ fontSize: 9 }}>Ask</th>
                  <th style={{ fontSize: 9 }}>Delta</th>
                  <th style={{ fontSize: 9 }}>IV</th>
                  <th style={{ fontSize: 9 }}>Vol / O.I.</th>
                </tr>
              </thead>
              <tbody>
                {optionBoardData.map(row => {
                  // Heatmap percentages
                  const cVolPct = Math.min(100, Math.round((row.callVol / 15000) * 100));
                  const pVolPct = Math.min(100, Math.round((row.putVol / 15000) * 100));
                  
                  return (
                    <tr key={row.strike} className={Math.abs(row.strike - spotPrice) < 250 ? 'atm-row' : ''}>
                      <td style={{ fontSize: 9, opacity: 0.8, color: '#90a0b6', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${cVolPct}%`, backgroundColor: 'rgba(59, 130, 246, 0.15)', zIndex: 0 }} />
                        <span style={{ position: 'relative', zIndex: 1 }}>{row.callVol.toLocaleString()}</span>
                      </td>
                      <td style={{ fontSize: 9, opacity: 0.6 }}>{(row.callIV * 100).toFixed(0)}%</td>
                      <td style={{ fontSize: 9, color: '#10b981', opacity: Math.max(0.3, Math.abs(row.callDelta)) }}>{row.callDelta.toFixed(2)}</td>
                      <td className="call-cell" onClick={() => addLeg('Call', 'Short', row.strike, row.callBid, row.callIV)}>{row.callBid}</td>
                      <td className="call-cell" onClick={() => addLeg('Call', 'Long', row.strike, row.callAsk, row.callIV)}>{row.callAsk}</td>
                      <td className="strike-col">{row.strike}</td>
                      <td className="put-cell" onClick={() => addLeg('Put', 'Short', row.strike, row.putBid, row.putIV)}>{row.putBid}</td>
                      <td className="put-cell" onClick={() => addLeg('Put', 'Long', row.strike, row.putAsk, row.putIV)}>{row.putAsk}</td>
                      <td style={{ fontSize: 9, color: '#ef4444', opacity: Math.max(0.3, Math.abs(row.putDelta)) }}>{row.putDelta.toFixed(2)}</td>
                      <td style={{ fontSize: 9, opacity: 0.6 }}>{(row.putIV * 100).toFixed(0)}%</td>
                      <td style={{ fontSize: 9, opacity: 0.8, color: '#90a0b6', position: 'relative', textAlign: 'left' }}>
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pVolPct}%`, backgroundColor: 'rgba(59, 130, 246, 0.15)', zIndex: 0 }} />
                        <span style={{ position: 'relative', zIndex: 1, paddingLeft: 4 }}>{row.putVol.toLocaleString()}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="smile-widget" style={{ marginTop: 'auto', paddingTop: 20 }}>
            <div className="widget-header" style={{ marginBottom: 10, padding: 0 }}>
              <div className="widget-title" style={{ fontSize: 13 }}>
                <TrendingUp size={16} className="text-secondary" />
                Volatility Smile (IV)
              </div>
            </div>
            <div style={{ height: 160, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={smileData} margin={{ top: 5, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="strike" 
                    stroke="#90a0b6" 
                    fontSize={8} 
                    tickFormatter={v => v.toLocaleString()}
                  />
                  <YAxis stroke="#90a0b6" fontSize={9} domain={['auto', 'auto']} unit="%" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(10,12,16,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 10 }}
                    itemStyle={{ color: '#3b82f6' }}
                    labelFormatter={v => `Strike: ${v}`}
                  />
                  <ReferenceLine x={spotPrice} stroke="#3b82f6" strokeDasharray="3 3" opacity={0.5} />
                  <Line type="monotone" dataKey="iv" stroke="#3b82f6" strokeWidth={2} dot={false} animationDuration={300} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </aside>

        {/* Center: Strategy Profile & Legs */}
        <div className="glass-panel widget" style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
          <div className="widget-header">
            <div className="widget-title"><TrendingUp size={18} className="text-secondary" /> Strategy Profile</div>
            <div className="stat-group-mini">
              <div className="stat-box-mini">Net: <span className={totalPremium >= 0 ? 'text-profit' : 'text-loss'}>{totalPremium.toLocaleString()}</span></div>
              <div className="stat-box-mini">ГО: <span style={{ color: '#90a0b6' }}>{maxRisk !== null ? maxRisk.toLocaleString() : '—'}</span></div>
              <div className="stat-box-mini">Max PnL: <span className="text-profit">{maxProfit !== null ? maxProfit.toLocaleString() : '—'}</span></div>
              <div className="stat-box-mini">POP: <span className={pop && pop > 50 ? 'text-profit' : 'text-loss'}>{pop !== null ? `${pop.toFixed(1)}%` : '—'}</span></div>
              <div className="stat-box-mini" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                B.E.: <span style={{ color: '#fff' }}>{breakevens.length > 0 ? breakevens.map(b => b.toLocaleString()).join(', ') : 'None'}</span>
              </div>
              <div className="stat-box-mini">RoC p.a.: <span className="text-profit">{maxProfit !== null ? `${annualizedRoc.toFixed(0)}%` : '—'}</span></div>
            </div>
          </div>

          <div className="profile-chart" style={{ flex: 1, minHeight: 320, position: 'relative' }} onWheel={handleWheel}>
            {chartData.length > 0 ? (
              <>
                <button onClick={resetChart} className="button-glass" style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, fontSize: 10 }}>Reset</button>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} style={{ cursor: 'crosshair' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    {refAreaLeft && refAreaRight && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} fill="rgba(59,130,246,0.2)" />}
                    <XAxis dataKey="price" stroke="#90a0b6" fontSize={10} domain={[chartRange.min, chartRange.max]} type="number" allowDataOverflow ticks={axisTicks} tickFormatter={v => (v / 1000).toFixed(1) + 'k'} />
                    <YAxis stroke="#90a0b6" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(10,12,16,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} 
                      labelStyle={{ color: '#fff', fontWeight: 600 }}
                      labelFormatter={v => `Цена БА: ${v.toLocaleString()}`} 
                    />
                    
                    {/* Probability Cone / ±1 STD Expected Move */}
                    <ReferenceArea 
                      x1={expectedMove.lower} 
                      x2={expectedMove.upper} 
                      fill="rgba(16, 185, 129, 0.05)" 
                      strokeOpacity={0} 
                    />
                    <ReferenceLine x={expectedMove.lower} stroke="rgba(16, 185, 129, 0.25)" strokeDasharray="3 3" label={{ position: 'insideBottomLeft', value: '-1σ', fill: 'rgba(16, 185, 129, 0.7)', fontSize: 10, offset: 10 }} />
                    <ReferenceLine x={expectedMove.upper} stroke="rgba(16, 185, 129, 0.25)" strokeDasharray="3 3" label={{ position: 'insideBottomRight', value: '+1σ', fill: 'rgba(16, 185, 129, 0.7)', fontSize: 10, offset: 10 }} />

                    <ReferenceLine x={spotPrice} stroke="#3b82f6" strokeDasharray="3 3" label={{ position: 'top', value: 'Spot', fill: '#3b82f6', fontSize: 10, fontWeight: 600 }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    {timeSteps.map((step, idx) => (
                      <Line 
                        key={step.key} 
                        type="linear" 
                        dataKey={step.key} 
                        name={step.label} 
                        stroke={TIME_LINE_COLORS[idx % TIME_LINE_COLORS.length]} 
                        strokeWidth={step.dte === 0 ? 3 : (idx === 0 ? 2.5 : 1.2)} 
                        dot={false} 
                        animationDuration={300}
                      />
                    ))}
                    <Legend iconType="line" wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>Выберите опционы в доске слева</div>
            )}
          </div>

          {/* LARGE HORIZONTAL LEGS AREA */}
          <div className="active-legs-horizontal" style={{ borderTop: '1px solid #333', marginTop: 16, paddingTop: 16 }}>
            <div className="widget-title" style={{ fontSize: 15, marginBottom: 12 }}>Active Portfolio Legs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {legs.map(leg => {
                const T = Math.max(0.001, totalDTE) / 365;
                const sign = leg.position === 'Long' ? 1 : -1;
                const qtyMult = leg.qty * sign;
                const currentIV = leg.iv || IV;
                const currentVal = bsPrice(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type);
                const legProfit = Math.round((currentVal - leg.premium) * leg.qty * sign);
                const d = bsDelta(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * qtyMult;
                const g = bsGamma(spotPrice, leg.strike, T, RISK_FREE, currentIV) * qtyMult;
                const v = bsVega(spotPrice, leg.strike, T, RISK_FREE, currentIV) * qtyMult;
                const th = bsTheta(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * qtyMult;
                const ch = bsCharm(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * qtyMult;

                return (
                  <div key={leg.id} className="leg-row" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '12px 20px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, fontSize: 14, borderLeft: `5px solid ${leg.type === 'Call' ? '#10b981' : '#ef4444'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 130 }}>
                      <button 
                        className="leg-toggle" 
                        onClick={() => updateLeg(leg.id, { position: leg.position === 'Long' ? 'Short' : 'Long' })} 
                        style={{ 
                          width: 28, 
                          height: 28, 
                          fontSize: 18, 
                          color: leg.position === 'Long' ? '#10b981' : '#ef4444',
                          borderColor: leg.position === 'Long' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                          background: 'rgba(255,255,255,0.03)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold'
                        }}
                      >
                        {leg.position === 'Long' ? '+' : '−'}
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button className="leg-qty-btn" onClick={() => updateLeg(leg.id, { qty: Math.max(1, leg.qty - 1) })} style={{ width: 20, height: 20 }}>−</button>
                        <input 
                          type="number"
                          className="leg-input"
                          value={leg.qty}
                          onChange={e => updateLeg(leg.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                          style={{ 
                            width: 45, 
                            textAlign: 'center', 
                            fontWeight: 'bold', 
                            fontSize: 14, 
                            padding: '2px 0', 
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '4px',
                            color: '#fff'
                          }}
                        />
                        <button className="leg-qty-btn" onClick={() => updateLeg(leg.id, { qty: leg.qty + 1 })} style={{ width: 20, height: 20 }}>+</button>
                      </div>
                    </div>
                    <div style={{ width: 60, fontWeight: 'bold', fontSize: 15 }}>{leg.type}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 230 }}>
                      <input className="leg-input" type="number" value={leg.strike} onChange={e => updateLeg(leg.id, { strike: Number(e.target.value) })} style={{ width: 85, fontSize: 14 }} />
                      <span style={{ opacity: 0.4 }}>@</span>
                      <input className="leg-input" type="number" value={leg.premium} onChange={e => updateLeg(leg.id, { premium: Number(e.target.value) })} style={{ width: 85, fontSize: 14 }} />
                    </div>
                    <div className={legProfit >= 0 ? 'text-profit' : 'text-loss'} style={{ width: 100, textAlign: 'center', fontWeight: 'bold', fontSize: 16 }}>{legProfit >= 0 ? '+' : ''}{legProfit.toLocaleString()}</div>
                    <div style={{ display: 'flex', gap: 25, flex: 1, paddingLeft: 20, borderLeft: '1px solid #444' }}>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.4, fontSize: 11 }}>Δ </span>{d.toFixed(2)}</div>
                      <div style={{ width: 90 }}><span style={{ opacity: 0.4, fontSize: 11 }}>Γ </span>{g.toFixed(4)}</div>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.4, fontSize: 11 }}>ν </span>{v.toFixed(1)}</div>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.4, fontSize: 11 }}>Θ </span>{th.toFixed(1)}</div>
                      <div style={{ width: 90 }}><span style={{ opacity: 0.4, fontSize: 11 }}>Chm </span>{ch.toFixed(4)}</div>
                    </div>
                    <button onClick={() => removeLeg(leg.id)} style={{ background: 'transparent', border: 'none', color: '#fff', opacity: 0.3, cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>
                );
              })}

              {legs.length > 0 && (() => {
                let tPnL = 0, tD = 0, tG = 0, tV = 0, tTh = 0, tCh = 0;
                const T = Math.max(0.001, totalDTE) / 365;
                legs.forEach(leg => {
                  const s = leg.position === 'Long' ? 1 : -1;
                  const q = leg.qty * s;
                  const currentIV = leg.iv || IV;
                  const curVal = bsPrice(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type);
                  tPnL += Math.round((curVal - leg.premium) * leg.qty * s);
                  tD += bsDelta(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * q;
                  tG += bsGamma(spotPrice, leg.strike, T, RISK_FREE, currentIV) * q;
                  tV += bsVega(spotPrice, leg.strike, T, RISK_FREE, currentIV) * q;
                  tTh += bsTheta(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * q;
                  tCh += bsCharm(spotPrice, leg.strike, T, RISK_FREE, currentIV, leg.type) * q;
                });

                return (
                  <div className="leg-row total-row" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '15px 20px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 10, fontSize: 14, marginTop: 4, borderLeft: '5px solid #3b82f6' }}>
                    <div style={{ width: 130, fontWeight: 800, color: '#3b82f6', letterSpacing: '1px' }}>TOTAL</div>
                    <div style={{ width: 60 }}></div>
                    <div style={{ width: 230 }}></div>
                    <div className={tPnL >= 0 ? 'text-profit' : 'text-loss'} style={{ width: 100, textAlign: 'center', fontWeight: 800, fontSize: 18 }}>
                        {tPnL >= 0 ? '+' : ''}{tPnL.toLocaleString()}
                    </div>
                    <div style={{ display: 'flex', gap: 25, flex: 1, paddingLeft: 20, borderLeft: '1px solid rgba(59, 130, 246, 0.3)', fontWeight: 700 }}>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.5, fontSize: 11 }}>Δ </span>{tD.toFixed(2)}</div>
                      <div style={{ width: 90 }}><span style={{ opacity: 0.5, fontSize: 11 }}>Γ </span>{tG.toFixed(4)}</div>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.5, fontSize: 11 }}>ν </span>{tV.toFixed(1)}</div>
                      <div style={{ width: 70 }}><span style={{ opacity: 0.5, fontSize: 11 }}>Θ </span>{tTh.toFixed(1)}</div>
                      <div style={{ width: 90 }}><span style={{ opacity: 0.5, fontSize: 11 }}>Chm </span>{tCh.toFixed(4)}</div>
                    </div>
                    <div style={{ width: 16 }}></div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {greeksData.length > 0 && (
        <div className="greeks-panel">
          <div className="greeks-panel-header"><Triangle size={16} color="#8b5cf6" /> <span>Portfolio Greeks Detail</span></div>
          <div className="greeks-grid">
            {GREEKS_META.map(g => (
              <div key={g.key} className="greek-card glass-panel">
                <div className="greek-card-title">{g.label} <span className="text-muted" style={{ fontSize: 10 }}>{g.unit}</span></div>
                <div className="greek-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={greeksData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="price" stroke="#90a0b6" fontSize={9} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
                      <YAxis stroke="#90a0b6" fontSize={9} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'rgba(10,12,16,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11 }}
                        labelFormatter={v => `Цена БА: ${v}`} 
                      />
                      <ReferenceLine x={spotPrice} stroke="#3b82f6" strokeDasharray="2 2" />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                      {timeSteps.map((step, idx) => (
                        <Line
                          key={step.key}
                          type="monotone"
                          dataKey={`${g.key}${step.key.replace('pnl', '')}`}
                          stroke={TIME_LINE_COLORS[idx % TIME_LINE_COLORS.length]}
                          strokeWidth={step.dte === 0 ? 2.5 : idx === 0 ? 2 : 1.2}
                          strokeDasharray={step.dte === 0 ? undefined : '5 5'}
                          dot={false}
                          opacity={step.dte === 0 || idx === 0 ? 1 : 0.45}
                          animationDuration={0}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
