import React, { useEffect, useState } from 'react';
import { Calendar, Flag, Plus, Trash2 } from 'lucide-react';
import type { GoalPriority, RunningGoal, UserProfile } from '../types';
import { createGoal, removeGoal, updateGoalStatus, updateUserPhysiology } from '../lib/store';
import { computeHeartRateZones, formatDurationSeconds, formatPace } from '../lib/trainingMath';

interface GoalsViewProps {
  uid: string;
  profile: UserProfile | null;
  goals: RunningGoal[];
}

const GOAL_PRESETS = [
  { title: '10 km wedstrijd', location: '', distanceKm: 10, defaultMinutes: 48 },
  { title: '10 Engelse Mijl', location: '', distanceKm: 16.1, defaultMinutes: 80 },
  { title: 'Halve Marathon', location: '', distanceKm: 21.1, defaultMinutes: 108 },
];

export function GoalsView({ uid, profile, goals }: GoalsViewProps) {
  const [title, setTitle] = useState('10 km doel');
  const [location, setLocation] = useState('');
  const [distanceKm, setDistanceKm] = useState(10);
  const [raceDate, setRaceDate] = useState(() => {
    const d = new Date(Date.now() + 60 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(48);
  const [seconds, setSeconds] = useState(0);
  const [priority, setPriority] = useState<GoalPriority>('A');
  const [notes, setNotes] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  // Physiology form
  const [displayName, setDisplayName] = useState(profile?.displayName || 'Atleet');
  const [maxHr, setMaxHr] = useState(profile?.maxHr || 188);
  const [restingHr, setRestingHr] = useState(profile?.restingHr || 52);
  const [treadmillMaxSpeedKmh, setTreadmillMaxSpeedKmh] = useState(profile?.treadmillMaxSpeedKmh || 20);
  const [treadmillMaxInclinePct, setTreadmillMaxInclinePct] = useState(profile?.treadmillMaxInclinePct || 15);
  const [sensitiveAreas, setSensitiveAreas] = useState(profile?.sensitiveAreas || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setMaxHr(profile.maxHr);
      setRestingHr(profile.restingHr);
      setTreadmillMaxSpeedKmh(profile.treadmillMaxSpeedKmh);
      setTreadmillMaxInclinePct(profile.treadmillMaxInclinePct);
      setSensitiveAreas(profile.sensitiveAreas);
    }
  }, [profile]);

  const targetTimeSeconds = Math.max(60, hours * 3600 + minutes * 60 + seconds);
  const targetPaceSec = distanceKm > 0 ? targetTimeSeconds / distanceKm : 0;
  const targetKmh = targetPaceSec > 0 ? (3600 / targetPaceSec).toFixed(1) : '—';

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || distanceKm <= 0) return;
    setSavingGoal(true);
    try {
      await createGoal(uid, {
        title: title.trim(),
        location: location.trim(),
        distanceKm: Number(distanceKm),
        raceDate,
        targetTimeSeconds,
        priority,
        status: 'active',
        notes: notes.trim(),
      });
      setNotes('');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedMsg(false);
    try {
      await updateUserPhysiology(uid, {
        displayName,
        maxHr,
        restingHr,
        treadmillMaxSpeedKmh,
        treadmillMaxInclinePct,
        sensitiveAreas,
      });
      setProfileSavedMsg(true);
      setTimeout(() => setProfileSavedMsg(false), 3000);
    } finally {
      setSavingProfile(false);
    }
  };

  const zones = computeHeartRateZones(maxHr, restingHr);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Goal Creator */}
        <form onSubmit={handleAddGoal} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-semibold text-slate-900">Nieuw hardloopdoel vastleggen</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kies een veelvoorkomende afstand of stel je eigen wedstrijd, datum en streeftijd in.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {GOAL_PRESETS.map((preset) => (
              <button
                key={preset.title}
                type="button"
                onClick={() => {
                  setTitle(preset.title);
                  setLocation(preset.location);
                  setDistanceKm(preset.distanceKm);
                  setHours(Math.floor(preset.defaultMinutes / 60));
                  setMinutes(preset.defaultMinutes % 60);
                  setSeconds(0);
                }}
                className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-md text-slate-700 whitespace-nowrap shrink-0"
              >
                {preset.title}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Naam van doel / wedstrijd</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Afstand (km)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="250"
                  required
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Wedstrijddatum</label>
                <input
                  type="date"
                  required
                  value={raceDate}
                  onChange={(e) => setRaceDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Streeftijd (uur : min : sec)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hours}
                  onChange={(e) => setHours(Math.max(0, Number(e.target.value)))}
                  aria-label="Uren"
                  className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
                  aria-label="Minuten"
                  className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(e) => setSeconds(Math.max(0, Math.min(59, Number(e.target.value))))}
                  aria-label="Seconden"
                  className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
                Streeftempo: {formatPace(targetPaceSec)} · {targetKmh} km/u
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Locatie</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Prioriteit</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as GoalPriority)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="A">A-doel (Hoofddoel)</option>
                  <option value="B">B-doel (Tussendoel)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notities (parcours, ondergrond)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bijv. asfalt & enkele bospaden, heuvelachtig parcours"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingGoal}
            className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {savingGoal ? 'Opslaan...' : 'Doel vastleggen'}
          </button>
        </form>

        {/* Goals List */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Jouw hardloopdoelen</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                De coach stemt elke dagelijkse training automatisch af op je eerstvolgende A-doel.
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs text-slate-500">{goals.length} doelen</span>
          </div>

          {goals.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Nog geen doelen vastgelegd. Gebruik het formulier links om je eerste hardloopdoel toe te voegen.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {goals.map((g) => {
                const daysLeft = Math.ceil((new Date(g.raceDate).getTime() - Date.now()) / 86400000);
                const pace = g.targetTimeSeconds / g.distanceKm;
                return (
                  <div key={g.id} className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-800">{g.priority}-doel</span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1 font-mono tabular-nums">
                          <Calendar className="w-3.5 h-3.5" /> {g.raceDate}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {daysLeft >= 0 ? `nog ${daysLeft} dagen` : 'verstreken'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={g.status === 'active' ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                          {g.status === 'active' ? 'Actief' : g.status === 'completed' ? 'Voltooid' : 'Gearchiveerd'}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <Flag className="w-4 h-4 text-emerald-700 shrink-0" />
                        {g.title}
                      </h3>
                      <p className="text-sm text-slate-600 font-mono tabular-nums">
                        {g.distanceKm} km · Streeftijd {formatDurationSeconds(g.targetTimeSeconds)} · Tempo{' '}
                        {formatPace(pace)}
                      </p>
                      {g.notes && <p className="text-xs text-slate-500">{g.notes}</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {g.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => updateGoalStatus(uid, g.id, 'completed')}
                          className="px-3 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 whitespace-nowrap shrink-0"
                        >
                          Voltooid
                        </button>
                      )}
                      {g.status !== 'archived' && (
                        <button
                          type="button"
                          onClick={() => updateGoalStatus(uid, g.id, 'archived')}
                          className="px-3 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 whitespace-nowrap shrink-0"
                        >
                          Archiveer
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeGoal(uid, g.id)}
                        aria-label="Verwijder doel"
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Athlete Physiology & Treadmill Settings + HR Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form onSubmit={handleSaveProfile} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Atleetprofiel, Loopband &amp; Gevoelige Plekken</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gebruikt voor TRIMP-belasting, hartslagzones en blessurepreventie.
              </p>
            </div>
            {profileSavedMsg && <span className="text-xs font-medium text-emerald-700">Opgeslagen</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roepnaam</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max hartslag (bpm)</label>
              <input
                type="number"
                min={120}
                max={220}
                value={maxHr}
                onChange={(e) => setMaxHr(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rusthartslag (bpm)</label>
              <input
                type="number"
                min={30}
                max={110}
                value={restingHr}
                onChange={(e) => setRestingHr(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Loopband max snelheid (km/u)</label>
              <input
                type="number"
                step="0.5"
                min={8}
                max={25}
                value={treadmillMaxSpeedKmh}
                onChange={(e) => setTreadmillMaxSpeedKmh(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Loopband max helling (%)</label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={30}
                value={treadmillMaxInclinePct}
                onChange={(e) => setTreadmillMaxInclinePct(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Bekende blessurehistorie / gevoelige plekken
            </label>
            <input
              type="text"
              value={sensitiveAreas}
              onChange={(e) => setSensitiveAreas(e.target.value)}
              placeholder="Bijv. gevoelige achillespees links, lichte onderrug na zware bootcamp"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg whitespace-nowrap"
          >
            {savingProfile ? 'Opslaan...' : 'Profiel opslaan'}
          </button>
        </form>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Hartslagzones (Karvonen HRR)
          </h3>
          <div className="divide-y divide-slate-100">
            {zones.map((z) => (
              <div key={z.name} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{z.name}</p>
                  <p className="text-xs text-slate-500">{z.desc}</p>
                </div>
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  {z.min}–{z.max} bpm
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
