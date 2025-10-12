import React from 'react';
import type { CoverageReport, CoverageDebugInfo } from '@/types/coverage';

interface AiInsightsPanelProps {
  report: CoverageReport | null;
  debug: CoverageDebugInfo | null;
  currentAntennaCount: number;
  aiSummary: string | null;
  isLoading: boolean;
  error: string | null;
  onAskAi: () => void;
  onReset: () => void;
}

const AiInsightsPanel: React.FC<AiInsightsPanelProps> = ({
  report,
  debug,
  currentAntennaCount,
  aiSummary,
  isLoading,
  error,
  onAskAi,
  onReset,
}) => {
  const hasReport = Boolean(report);
  const coverageDelta = report ? report.coveragePercent - report.targetPercent : 0;
  const antennaDelta = report ? currentAntennaCount - report.antennaCount : 0;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-sm shadow-inner">
      <div className="flex items-center justify-between gap-2">
  <h4 className="font-semibold text-slate-800">Deterministic Coverage Advisor</h4>
        {aiSummary && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      {!hasReport && (
        <p className="mt-2 text-slate-600">
          Run <strong>Auto Place</strong> to generate antenna coverage. The deterministic advisor will highlight baseline expectations once results are available.
        </p>
      )}

      {hasReport && report && (
        <div className="mt-3 space-y-2 text-slate-700">
          <div className="flex justify-between">
            <span>Coverage achieved</span>
            <span className="font-medium">{report.coveragePercent.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Target coverage</span>
            <span>{report.targetPercent.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Antennas placed</span>
            <span>{report.antennaCount}</span>
          </div>
          {typeof report.baselineCount === 'number' && report.baselineCount > 0 && (
            <div className="flex justify-between text-xs text-slate-600">
              <span>Baseline (85% net eff.)</span>
              <span>≈ {report.baselineCount}</span>
            </div>
          )}
          {currentAntennaCount !== report.antennaCount && (
            <div className="flex justify-between text-xs text-amber-600">
              <span>Canvas antenna count</span>
              <span>{currentAntennaCount} ({antennaDelta >= 0 ? '+' : ''}{antennaDelta})</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-slate-500">
            <span>Solver</span>
            <span>{report.solver}{report.fallbackApplied ? ' + fallback' : ''}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Uncovered samples</span>
            <span>{report.uncoveredSamples} / {report.sampleCount}</span>
          </div>
          {debug && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <div>Sample step: {debug.sampleStep.toFixed(2)}</div>
              <div>Hard cap: {debug.hardCap}</div>
              <div>Candidates: {debug.candidateCount}</div>
              <div>Passes: {debug.iterations}</div>
            </div>
          )}
          <div className={`rounded-lg border px-3 py-2 text-xs ${coverageDelta >= 0 ? 'border-emerald-300 bg-emerald-50/80 text-emerald-700' : 'border-amber-300 bg-amber-50/80 text-amber-700'}`}>
            {coverageDelta >= 0
              ? `Coverage exceeds target by ${coverageDelta.toFixed(2)}%.`
              : `Coverage misses target by ${Math.abs(coverageDelta).toFixed(2)}%.`}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onAskAi}
          disabled={!hasReport || isLoading}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium text-white transition ${
            !hasReport || isLoading
              ? 'bg-slate-400'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {isLoading ? 'Preparing guidance…' : 'Show deterministic guidance'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {aiSummary && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 whitespace-pre-line">
          {aiSummary}
        </div>
      )}
    </div>
  );
};

export default AiInsightsPanel;
