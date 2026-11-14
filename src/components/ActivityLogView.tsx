import React, { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import type { ActivityType, TrainingActivity } from '../types';
import { removeActivity } from '../lib/store';
import { formatPace } from '../lib/trainingMath';

interface ActivityLogViewProps {
  uid: string;
  activities: TrainingActivity[];
  onNavigateToImport: () => void;
}

const TYPE_LABELS: Record<ActivityType, string> = {
  run_outdoor: 'Hardlopen',
  run_treadmill: 'Loopband',
  bootcamp: 'Bootcamp',
  core_physio: 'Core / Fysio',
  cross_train: 'Crosstraining',
};

export function ActivityLogView({ uid, activities, onNavigateToImport }: ActivityLogViewProps) {
  const [filter, setFilter] = useState<'all' | ActivityType>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (filter !== 'all' && a.activityType !== filter) return false;
      if (q && !`${a.title} ${a.source} ${a.sorenessNote}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activities, filter, search]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Activiteitenlogboek</h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {activities.length} geregistreerde trainingen uit Strava, Garmin, Bootcamp &amp; Coach
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op titel of bron..."
              className="pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 w-full sm:w-56"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                ['all', 'Alle'],
                ['run_outdoor', 'Hardlopen'],
                ['run_treadmill', 'Loopband'],
                ['bootcamp', 'Bootcamp'],
                ['core_physio', 'Core'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-slate-600">
            {activities.length === 0
              ? 'Nog geen trainingen geïmporteerd of gelogd.'
              : 'Geen activiteiten gevonden voor deze filter.'}
          </p>
          {activities.length === 0 && (
            <button
              type="button"
              onClick={onNavigateToImport}
              className="px-4 py-2 bg-[#0F172A] text-white text-sm font-medium rounded-lg whitespace-nowrap"
            >
              Strava / Garmin / Bootcamp toevoegen
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4">Datum</th>
                <th className="py-2.5 pr-4">Training</th>
                <th className="py-2.5 pr-4">Type · Bron</th>
                <th className="py-2.5 pr-4 text-right">Duur</th>
                <th className="py-2.5 pr-4 text-right">Afstand</th>
                <th className="py-2.5 pr-4 text-right">Tempo</th>
                <th className="py-2.5 pr-4 text-right">Gem. HR</th>
                <th className="py-2.5 pr-4 text-right">Load</th>
                <th className="py-2.5 text-right">Actie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((act) => (
                <tr key={act.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                    {act.date}
                  </td>
                  <td className="py-2.5 pr-4">
                    <p className="font-medium text-slate-900 truncate max-w-[240px]">{act.title}</p>
                    {act.sorenessNote && (
                      <p className="text-xs text-slate-500 truncate max-w-[240px]">{act.sorenessNote}</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-slate-600 whitespace-nowrap">
                    {TYPE_LABELS[act.activityType]} · <span className="uppercase">{act.source}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                    {act.durationMinutes} min
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                    {act.distanceKm > 0 ? `${act.distanceKm.toFixed(1)} km` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {act.avgPaceSecPerKm > 0 ? formatPace(act.avgPaceSecPerKm) : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {act.avgHr > 0 ? `${act.avgHr} bpm` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                    {act.trainingLoad}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeActivity(uid, act.id)}
                      aria-label="Verwijder activiteit"
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
