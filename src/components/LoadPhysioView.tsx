import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck, TrendingUp, X } from 'lucide-react';
import type { LoadMetrics, UserProfile } from '../types';

interface LoadPhysioViewProps {
  loadMetrics: LoadMetrics;
  profile: UserProfile | null;
  onNavigateToToday?: () => void;
}

export function LoadPhysioView({ loadMetrics, profile, onNavigateToToday }: LoadPhysioViewProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const maxDayLoad = Math.max(100, ...loadMetrics.dailySeries.map((d) => d.totalLoad));

  const isHighRapidSpike = loadMetrics.acwr >= 1.45;
  const isCautionRapidSpike = loadMetrics.acwr >= 1.3 && loadMetrics.acwr < 1.45;
  const showRapidBuildupWarning = (isHighRapidSpike || isCautionRapidSpike) && !warningDismissed;

  const pctAboveChronic =
    loadMetrics.chronicLoad28d > 0
      ? Math.round(((loadMetrics.acuteLoad7d - loadMetrics.chronicLoad28d) / loadMetrics.chronicLoad28d) * 100)
      : 0;

  const last7Days = loadMetrics.dailySeries.slice(-7);
  const acuteRunLoad = last7Days.reduce((sum, d) => sum + d.runLoad, 0);
  const acuteBootcampLoad = last7Days.reduce((sum, d) => sum + d.bootcampLoad, 0);

  const statusMeta = {
    optimal: {
      label: 'Optimaal belastingsvenster (0.80 – 1.30)',
      color: 'text-emerald-700',
      summary:
        'Je acute 7-daagse belasting (inclusief bootcamp) sluit goed aan op je 28-daagse basis. Je kunt veilig gericht werken aan tempo en inhoud richting je hardloopdoel.',
    },
    caution: {
      label:
        loadMetrics.acwr >= 1.3
          ? 'Let op: snelle belastingsstijging (ACWR 1.30 – 1.44)'
          : 'Let op: lage recente belasting t.o.v. basis',
      color: 'text-amber-600',
      summary:
        loadMetrics.acwr >= 1.3
          ? 'Je weekbelasting stijgt meer dan 30% boven je 4-weekse gemiddelde. Bouw volume of intensiteit rustig af en plan herstel na zware bootcamp-dagen.'
          : 'Je weekbelasting ligt onder je gebruikelijke 4-weekse basis. Bouw geleidelijk weer op zonder plotselinge pieken.',
    },
    high: {
      label: 'Verhoogd blessurerisico (ACWR >= 1.45)',
      color: 'text-red-600',
      summary:
        'De combinatie van recente looptrainingen en bootcamp-sessies piekt snel. De fysio-modus schakelt intensieve intervallen terug naar rustige duurloop of core-herstel om pezen en spieren te beschermen.',
    },
    underloaded: {
      label: 'Opbouwfase / Weinig recente data',
      color: 'text-slate-700',
      summary:
        'Upload je Strava-historie of Garmin-trainingen en log je bootcamp-sessies zodat we je persoonlijke chronische belastingsbasis nauwkeurig kunnen berekenen.',
    },
  }[loadMetrics.riskStatus];

  const hoveredDay = hoveredIdx !== null ? loadMetrics.dailySeries[hoveredIdx] : null;
  const acwrMarkerPct = Math.min(100, Math.max(0, (loadMetrics.acwr / 2) * 100));

  return (
    <div className="space-y-6">
      {/* ACWR Rapid-Buildup Dashboard Warning Notification */}
      {showRapidBuildupWarning && (
        <div
          role={isHighRapidSpike ? 'alert' : 'status'}
          aria-live={isHighRapidSpike ? 'assertive' : 'polite'}
          className={`rounded-xl border p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4 ${
            isHighRapidSpike
              ? 'bg-red-50 border-red-200 text-red-950'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                isHighRapidSpike ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {isHighRapidSpike ? (
                <ShieldAlert className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-base font-semibold">
                  {isHighRapidSpike
                    ? 'Waarschuwing: Verhoogd blessurerisico door te snelle opbouw'
                    : 'Let op: Snelle stijging van trainingsbelasting gedetecteerd'}
                </h2>
                <span
                  className={`text-xs font-mono tabular-nums font-semibold ${
                    isHighRapidSpike ? 'text-red-700' : 'text-amber-800'
                  }`}
                >
                  ACWR {loadMetrics.acwr.toFixed(2)} · +{pctAboveChronic}% t.o.v. 28d gemiddelde
                </span>
              </div>

              <p className={`text-sm leading-relaxed ${isHighRapidSpike ? 'text-red-900' : 'text-amber-900'}`}>
                {isHighRapidSpike
                  ? `Je acute 7-daagse belasting (${loadMetrics.acuteLoad7d}) ligt ruim boven je chronische weekbasis (${loadMetrics.chronicLoad28d}). Bij een ACWR van 1.45 of hoger neemt de kans op overbelastingsblessures aan achillespees, scheenbeen en knie sterk toe.`
                  : `Je acute 7-daagse belasting (${loadMetrics.acuteLoad7d}) nadert de overbelastingsgrens t.o.v. je chronische weekbasis (${loadMetrics.chronicLoad28d}). Verhoog je loopvolume of intensiteit de komende 48 uur niet verder.`}
              </p>

              <p className={`text-xs font-mono tabular-nums ${isHighRapidSpike ? 'text-red-800' : 'text-amber-800'}`}>
                Verdeling afgelopen 7 dagen: Hardlopen {acuteRunLoad} load ({loadMetrics.weeklyRunKm} km) · Bootcamp{' '}
                {acuteBootcampLoad} load ({loadMetrics.weeklyBootcampMin} min)
                {profile?.sensitiveAreas ? ` · Let extra op: ${profile.sensitiveAreas}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start lg:self-center">
            {onNavigateToToday && (
              <button
                type="button"
                onClick={onNavigateToToday}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  isHighRapidSpike
                    ? 'bg-red-700 hover:bg-red-800 text-white'
                    : 'bg-amber-700 hover:bg-amber-800 text-white'
                }`}
              >
                {isHighRapidSpike ? 'Hersteltraining inplannen' : 'Check training vandaag'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setWarningDismissed(true)}
              aria-label="Sluit waarschuwing"
              className={`p-2 rounded-lg transition-colors ${
                isHighRapidSpike
                  ? 'text-red-700 hover:bg-red-100'
                  : 'text-amber-700 hover:bg-amber-100'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Acute Belasting (7 dagen)</p>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {loadMetrics.acuteLoad7d}
          </p>
          <p className="text-xs text-slate-500 mt-1">Hardlopen + Bootcamp + Core</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Chronische Basis (28d gem/wk)</p>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {loadMetrics.chronicLoad28d}
          </p>
          <p className="text-xs text-slate-500 mt-1">4-weekse belastbaarheid</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">ACWR Blessureratio</p>
          <p className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${statusMeta.color}`}>
            {loadMetrics.acwr > 0 ? loadMetrics.acwr.toFixed(2) : '—'}
          </p>
          <div className="mt-2 space-y-1">
            <div className="relative h-1.5 w-full rounded-full overflow-hidden bg-slate-100 flex">
              <div className="h-full bg-slate-300" style={{ width: '40%' }} title="< 0.80 Opbouw" />
              <div className="h-full bg-emerald-500" style={{ width: '25%' }} title="0.80 – 1.30 Optimaal" />
              <div className="h-full bg-amber-500" style={{ width: '7.5%' }} title="1.30 – 1.45 Let op" />
              <div className="h-full bg-red-500" style={{ width: '27.5%' }} title=">= 1.45 Hoog risico" />
            </div>
            {loadMetrics.acwr > 0 && (
              <div className="relative h-2">
                <span
                  className="absolute top-0 -translate-x-1/2 w-2 h-2 rotate-45 bg-slate-900"
                  style={{ left: `${acwrMarkerPct}%` }}
                />
              </div>
            )}
            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
              Optimaal: 0.80–1.30 · Grens: 1.45
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">7-daags Mixvolume</p>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {loadMetrics.weeklyRunKm} km
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            + {loadMetrics.weeklyBootcampMin}m bootcamp · {loadMetrics.weeklyCoreMin}m core
          </p>
        </div>
      </div>

      {/* 28-day Stacked Load Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-700" />
              Dagelijkse Trainingsbelasting (laatste 28 dagen)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Gecombineerde TRIMP / sRPE belasting van hardlopen, bootcamp en core-fysio.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> Hardlopen
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Bootcamp
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-500 inline-block" /> Core/Fysio
            </span>
          </div>
        </div>

        {/* Hover detail bar */}
        <div className="h-6 text-xs font-mono tabular-nums text-slate-600 flex items-center justify-between">
          {hoveredDay ? (
            <span>
              {hoveredDay.date} · Totaal load {hoveredDay.totalLoad} (Hardlopen {hoveredDay.runLoad} / {hoveredDay.runKm.toFixed(1)} km · Bootcamp {hoveredDay.bootcampLoad} · Core {hoveredDay.coreLoad})
            </span>
          ) : (
            <span className="text-slate-400">Beweeg over een dagbalk voor de exacte verdeling</span>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox="0 0 840 220"
            className="w-full h-52 min-w-[600px]"
            role="img"
            aria-label="28-daagse trainingsbelasting grafiek"
          >
            {/* Horizontal grid lines */}
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = 180 - ratio * 155;
              const val = Math.round(maxDayLoad * ratio);
              return (
                <g key={ratio}>
                  <line x1="36" y1={y} x2="830" y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
                  <text x="30" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                    {val}
                  </text>
                </g>
              );
            })}
            <line x1="36" y1="180" x2="830" y2="180" stroke="#CBD5E1" />

            {loadMetrics.dailySeries.map((day, idx) => {
              const slotW = (830 - 44) / 28;
              const x = 44 + idx * slotW + 3;
              const barW = Math.max(10, slotW - 8);
              const scale = 155 / maxDayLoad;

              const runH = day.runLoad * scale;
              const bootH = day.bootcampLoad * scale;
              const coreH = day.coreLoad * scale;

              const yRun = 180 - runH;
              const yBoot = yRun - bootH;
              const yCore = yBoot - coreH;

              return (
                <g
                  key={day.date}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <rect x={x - 2} y={20} width={barW + 4} height={165} fill="transparent" />
                  {day.runLoad > 0 && (
                    <rect x={x} y={yRun} width={barW} height={runH} rx={2} fill="#059669" opacity={hoveredIdx === idx ? 1 : 0.88} />
                  )}
                  {day.bootcampLoad > 0 && (
                    <rect x={x} y={yBoot} width={barW} height={bootH} rx={2} fill="#F59E0B" opacity={hoveredIdx === idx ? 1 : 0.9} />
                  )}
                  {day.coreLoad > 0 && (
                    <rect x={x} y={yCore} width={barW} height={coreH} rx={2} fill="#64748B" opacity={hoveredIdx === idx ? 1 : 0.88} />
                  )}
                  {(idx % 4 === 0 || idx === 27) && (
                    <text x={x + barW / 2} y={200} textAnchor="middle" className="fill-slate-500 text-[10px] font-mono">
                      {day.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Physio & Bootcamp Analysis */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h3 className={`text-base font-semibold flex items-center gap-2 ${statusMeta.color}`}>
            {loadMetrics.riskStatus === 'high' ? (
              <ShieldAlert className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 shrink-0" />
            )}
            {statusMeta.label}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">{statusMeta.summary}</p>
        </div>

        <div className="space-y-2 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
          <h3 className="text-base font-semibold text-slate-900">Aandachtspunten vanuit Fysio-profiel</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            Gevoelige regio&apos;s: <span className="font-medium text-slate-800">{profile?.sensitiveAreas || 'Geen opgegeven'}</span>.
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Bootcamp-sessies met veel squats, lunges of sprongvormen (plyometrie) krijgen een weegfactor van 1.25× in je belastingsanalyse. De coach vermijdt de dag erna zware baanintervallen om achillespees, knie en scheenbeen te ontzien.
          </p>
        </div>
      </div>
    </div>
  );
}
