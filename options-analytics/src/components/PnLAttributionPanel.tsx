import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { calculateCurrentGreeksPnL } from '../utils/blackScholes';
import type { OptionLegData } from '../utils/blackScholes';

interface PnLAttributionPanelProps {
  legs: OptionLegData[];
  spotPrice: number;
  spotEntry: number;      // Цена входа в позицию (Spot)
  ivCurrent: number;
  ivEntry: number;        // IV при входе
  daysHeld: number;       // Дней в позиции
}

interface AttributionDataPoint {
  name: string;
  value: number;
  color: string;
  percent: number;
}

export function PnLAttributionPanel({
  legs,
  spotPrice,
  spotEntry,
  ivCurrent,
  ivEntry,
  daysHeld
}: PnLAttributionPanelProps) {
  const attribution = useMemo(() => {
    if (legs.length === 0) return null;
    return calculateCurrentGreeksPnL(legs, spotPrice, spotEntry, ivCurrent, ivEntry, daysHeld);
  }, [legs, spotPrice, spotEntry, ivCurrent, ivEntry, daysHeld]);

  const chartData: AttributionDataPoint[] = useMemo(() => {
    if (!attribution) return [];

    const components = [
      { name: 'Delta PnL', value: attribution.deltaPnL, color: '#10b981' },
      { name: 'Gamma PnL', value: attribution.gammaPnL, color: '#8b5cf6' },
      { name: 'Vega PnL', value: attribution.vegaPnL, color: '#f59e0b' },
      { name: 'Theta PnL', value: attribution.thetaPnL, color: '#ef4444' }
    ];

    const totalAbs = components.reduce((sum, c) => sum + Math.abs(c.value), 0);

    return components.map(c => ({
      ...c,
      percent: totalAbs > 0 ? (Math.abs(c.value) / totalAbs * 100) : 0
    })).filter(c => Math.abs(c.value) > 0);
  }, [attribution]);

  const totalPnL = attribution?.totalPnL ?? 0;
  const isProfit = totalPnL >= 0;

  if (!attribution || legs.length === 0) {
    return (
      <div className="pnl-attribution-panel glass-panel">
        <div className="pnl-attribution-header">
          <span style={{ fontSize: 15, fontWeight: 600 }}>P&L Attribution</span>
        </div>
        <div className="pnl-attribution-empty">
          Добавьте позиции в портфель для анализа
        </div>
      </div>
    );
  }

  return (
    <div className="pnl-attribution-panel glass-panel">
      <div className="pnl-attribution-header">
        <span style={{ fontSize: 15, fontWeight: 600 }}>P&L Attribution</span>
        <span className="text-muted" style={{ fontSize: 11 }}>
          Дней в позиции: {daysHeld}
        </span>
      </div>

      {/* Total PnL Display */}
      <div className="pnl-attribution-total">
        <span className="pnl-attribution-label">Total PnL:</span>
        <span className={`pnl-attribution-value ${isProfit ? 'text-profit' : 'text-loss'}`}>
          {isProfit ? '+' : ''}{totalPnL.toLocaleString()}
        </span>
      </div>

      {/* Attribution Breakdown */}
      <div className="pnl-attribution-breakdown">
        <div className="attribution-row">
          <div className="attribution-label">
            <span className="attribution-color-dot" style={{ background: '#10b981' }} />
            Delta PnL
            <span className="attribution-description">(от движения Spot)</span>
          </div>
          <div className={`attribution-value ${attribution.deltaPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
            {attribution.deltaPnL >= 0 ? '+' : ''}{attribution.deltaPnL.toLocaleString()}
          </div>
        </div>

        <div className="attribution-row">
          <div className="attribution-label">
            <span className="attribution-color-dot" style={{ background: '#8b5cf6' }} />
            Gamma PnL
            <span className="attribution-description">(от ускорения Delta)</span>
          </div>
          <div className={`attribution-value ${attribution.gammaPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
            {attribution.gammaPnL >= 0 ? '+' : ''}{attribution.gammaPnL.toLocaleString()}
          </div>
        </div>

        <div className="attribution-row">
          <div className="attribution-label">
            <span className="attribution-color-dot" style={{ background: '#f59e0b' }} />
            Vega PnL
            <span className="attribution-description">(от изменения IV)</span>
          </div>
          <div className={`attribution-value ${attribution.vegaPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
            {attribution.vegaPnL >= 0 ? '+' : ''}{attribution.vegaPnL.toLocaleString()}
          </div>
        </div>

        <div className="attribution-row">
          <div className="attribution-label">
            <span className="attribution-color-dot" style={{ background: '#ef4444' }} />
            Theta PnL
            <span className="attribution-description">(временной распад)</span>
          </div>
          <div className={`attribution-value ${attribution.thetaPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
            {attribution.thetaPnL >= 0 ? '+' : ''}{attribution.thetaPnL.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Visual Chart */}
      {chartData.length > 0 && (
        <div className="pnl-attribution-chart">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: 'rgba(10,12,16,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12
                }}
                formatter={(value) => {
                  const numValue = typeof value === 'number' ? value : 0;
                  return [`${numValue >= 0 ? '+' : ''}${numValue.toLocaleString()}`, 'PnL'];
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => <span style={{ color: '#90a0b6', fontSize: 11 }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Summary Text */}
      <div className="pnl-attribution-summary">
        {getAttributionSummary(attribution)}
      </div>
    </div>
  );
}

// Helper function to generate summary text
function getAttributionSummary(attribution: {
  deltaPnL: number;
  gammaPnL: number;
  vegaPnL: number;
  thetaPnL: number;
  totalPnL: number;
}): string {
  const components = [
    { name: 'Delta', value: attribution.deltaPnL },
    { name: 'Gamma', value: attribution.gammaPnL },
    { name: 'Vega', value: attribution.vegaPnL },
    { name: 'Theta', value: attribution.thetaPnL }
  ];

  // Find the biggest contributor
  const sorted = [...components].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const topContributor = sorted[0];
  const topDrag = sorted.filter(c => Math.sign(c.value) !== Math.sign(topContributor.value))[0];

  if (Math.abs(attribution.totalPnL) < 100) {
    return 'Позиция около безубытка';
  }

  const isProfit = attribution.totalPnL > 0;
  const driver = isProfit ? 'движет прибыль' : 'движет убыток';
  const drag = topDrag ? `, ${topDrag.name} ${isProfit ? 'снижает' : 'увеличивает'} PnL` : '';

  return `${topContributor.name} ${driver}${drag}`;
}
