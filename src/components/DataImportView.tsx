import React, { useState } from 'react';
import { CheckCircle2, Dumbbell, FileUp, Info, Plus, Watch } from 'lucide-react';
import type { ActivityType, RunningGoal, TrainingActivity, UserProfile } from '../types';
import { authenticatedFetch } from '../lib/firebase';
import { parseGarminFile, parseStravaUpload } from '../lib/activityParsers';
import { addActivitiesBatch, updateUserStravaBaseline } from '../lib/store';
import { calculateTrainingLoad, formatPace, todayIsoDate } from '../lib/trainingMath';

interface DataImportViewProps {
  uid: string;
  profile: UserProfile | null;
  goals: RunningGoal[];
  activities: TrainingActivity[];
}

export function DataImportView({ uid, profile, goals, activities }: DataImportViewProps) {
  const maxHr = profile?.maxHr || 188;
  const restingHr = profile?.restingHr || 52;
  const existingExternalIds = new Set(activities.map((a) => a.externalId).filter(Boolean));

  // Strava state
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaMsg, setStravaMsg] = useState<string | null>(null);
  const [stravaErr, setStravaErr] = useState<string | null>(null);

  // Garmin state
  const [garminBusy, setGarminBusy] = useState(false);
  const [garminMsg, setGarminMsg] = useState<string | null>(null);
  const [garminErr, setGarminErr] = useState<string | null>(null);

  // Bootcamp / Manual state
  const [logType, setLogType] = useState<ActivityType>('bootcamp');
  const [logTitle, setLogTitle] = useState('Bootcamp sessie');
  const [logDate, setLogDate] = useState(todayIsoDate());
  const [logDuration, setLogDuration] = useState(60);
  const [logDistance, setLogDistance] = useState(0);
  const [logAvgHr, setLogAvgHr] = useState(0);
  const [logIncline, setLogIncline] = useState(1.0);
  const [logRpe, setLogRpe] = useState(7);
  const [bootcampFocus, setBootcampFocus] = useState('full_body');
  const [sorenessNote, setSorenessNote] = useState('');
  const [logSaving, setLogSaving] = useState(false);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);

  const handleStravaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStravaBusy(true);
    setStravaMsg(null);
    setStravaErr(null);

    try {
      const result = await parseStravaUpload(file, maxHr, restingHr);
      const aiResp = await authenticatedFetch('/api/coach/analyze-strava', {
        stats: result.stravaStats,
        goals: goals.filter((g) => g.status === 'active' && g.userId === uid),
      });
      const aiData = await aiResp.json();
      const summary =
        aiResp.ok && aiData?.summary
          ? aiData.summary
          : `${result.stravaStats?.totalRuns || 0} hardloopsessies (${result.stravaStats?.totalRunKm || 0} km totaal), gemiddeld ${result.stravaStats?.avgWeeklyRunKmRecent12w || 0} km/week.`;

      await updateUserStravaBaseline(uid, summary, result.totalParsedCount);
      const savedCount = await addActivitiesBatch(uid, result.activities.slice(0, 80), existingExternalIds);

      setStravaMsg(
        `Strava-archief geanalyseerd: ${result.totalParsedCount} historische activiteiten gelezen (${result.stravaStats?.totalRuns} runs, ${result.stravaStats?.totalRunKm} km). ${savedCount} recente activiteiten opgeslagen in je logboek.`
      );
    } catch (err: any) {
      setStravaErr(err?.message || 'Kon Strava-bestand niet verwerken.');
    } finally {
      setStravaBusy(false);
      e.target.value = '';
    }
  };

  const handleGarminFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setGarminBusy(true);
    setGarminMsg(null);
    setGarminErr(null);

    try {
      const parsedAll: Array<Omit<TrainingActivity, 'id' | 'userId' | 'createdAt'>> = [];
      for (const file of Array.from(files)) {
        const items = await parseGarminFile(file, maxHr, restingHr);
        parsedAll.push(...items);
      }
      const savedCount = await addActivitiesBatch(uid, parsedAll, existingExternalIds);
      setGarminMsg(
        savedCount > 0
          ? `${savedCount} Garmin-training(en) succesvol geïmporteerd en verwerkt in je belastingsanalyse.`
          : `${parsedAll.length} training(en) herkend, maar stonden al in je logboek.`
      );
    } catch (err: any) {
      setGarminErr(err?.message || 'Kon Garmin-bestand niet inlezen.');
    } finally {
      setGarminBusy(false);
      e.target.value = '';
    }
  };

  const handleManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setLogSaving(true);
    setLogSuccess(null);

    try {
      const isRun = logType === 'run_outdoor' || logType === 'run_treadmill';
      const dist = isRun ? Number(logDistance) : 0;
      const pace = isRun && dist > 0.2 ? Math.round((logDuration * 60) / dist) : 0;
      const load = calculateTrainingLoad({
        durationMinutes: logDuration,
        activityType: logType,
        avgHr: logAvgHr,
        maxHr,
        restingHr,
        rpe: logRpe,
        inclinePct: logType === 'run_treadmill' ? logIncline : 0,
        bootcampFocus: logType === 'bootcamp' ? bootcampFocus : '',
      });

      await addActivitiesBatch(
        uid,
        [
          {
            source: logType === 'bootcamp' ? 'bootcamp' : 'manual',
            activityType: logType,
            title: logTitle.trim() || 'Training',
            date: logDate,
            durationMinutes: logDuration,
            distanceKm: dist,
            avgPaceSecPerKm: pace,
            avgHr: logAvgHr,
            maxHr: 0,
            elevationGainM: 0,
            inclinePct: logType === 'run_treadmill' ? logIncline : 0,
            rpe: logRpe,
            trainingLoad: load,
            bootcampFocus: logType === 'bootcamp' ? bootcampFocus : '',
            sorenessNote: sorenessNote.trim(),
            externalId: `manual-${logDate}-${Date.now()}`,
          },
        ],
        existingExternalIds
      );

      setLogSuccess(`Opgeslagen (${logTitle}) met berekende belastingscore ${load}.`);
      setSorenessNote('');
    } finally {
      setLogSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* 1. Strava One-Time History Upload */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">1. Eenmalige Strava-historie uploaden</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload je Strava-export (<span className="font-mono">.zip</span> of <span className="font-mono">activities.csv</span>) zodat de coach je basisniveau leert kennen.
              </p>
            </div>
            <FileUp className="w-5 h-5 text-emerald-700 shrink-0" />
          </div>

          <div className="text-xs text-slate-600 space-y-1 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <p className="font-medium text-slate-800">Zo download je jouw Strava-archief:</p>
            <p>Strava.com → Instellingen → Mijn account → Download of verwijder uw account → Aanvraag archief → upload hier de ontvangen <span className="font-mono">.zip</span> of <span className="font-mono">activities.csv</span>.</p>
          </div>

          <label className="block border border-dashed border-slate-300 hover:border-emerald-600 rounded-xl p-5 text-center cursor-pointer transition-colors">
            <input
              type="file"
              accept=".csv,.zip"
              disabled={stravaBusy}
              onChange={handleStravaFile}
              className="hidden"
            />
            <span className="text-sm font-medium text-slate-800 block">
              {stravaBusy ? 'Strava-historie wordt geanalyseerd door coach...' : 'Klik om Strava .zip of activities.csv te kiezen'}
            </span>
            <span className="text-xs text-slate-500 mt-1 block">Verwerking gebeurt veilig en direct</span>
          </label>

          {stravaMsg && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{stravaMsg}</span>
            </p>
          )}
          {stravaErr && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{stravaErr}</p>
          )}

          {profile?.stravaBaselineSummary && (
            <div className="border-t border-slate-100 pt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-800">Geleerd Strava-profiel</span>
                <span className="font-mono tabular-nums">{profile.stravaImportedCount} activiteiten geanalyseerd</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                {profile.stravaBaselineSummary}
              </p>
            </div>
          )}
        </div>

        {/* 2. Garmin Latest Training Upload */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">2. Laatste Garmin-training toevoegen</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Importeer <span className="font-mono">.fit</span>, <span className="font-mono">.tcx</span>, <span className="font-mono">.gpx</span> of <span className="font-mono">.csv</span> direct uit Garmin Connect.
              </p>
            </div>
            <Watch className="w-5 h-5 text-emerald-700 shrink-0" />
          </div>

          <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <p className="font-medium text-slate-800 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              Over Garmin automatische synchronisatie &amp; 1-klik export
            </p>
            <p>
              Garmin geeft automatische cloud-koppeling (Garmin Health API) uitsluitend vrij aan geregistreerde partnerbedrijven na goedkeuring. Daarom leest deze app direct jouw originele <span className="font-mono">.fit</span> / <span className="font-mono">.tcx</span> / <span className="font-mono">.gpx</span> bestanden met alle hartslag-, tempo- en hoogtedata.
            </p>
            <p className="text-slate-700 font-medium">
              In Garmin Connect Web: Open activiteit → Tandwiel rechtsboven → &ldquo;Bestand exporteren&rdquo; (.fit) of &ldquo;Exporteren naar TCX/GPX&rdquo;.
            </p>
          </div>

          <label className="block border border-dashed border-slate-300 hover:border-emerald-600 rounded-xl p-5 text-center cursor-pointer transition-colors">
            <input
              type="file"
              accept=".fit,.tcx,.gpx,.csv"
              multiple
              disabled={garminBusy}
              onChange={handleGarminFiles}
              className="hidden"
            />
            <span className="text-sm font-medium text-slate-800 block">
              {garminBusy ? 'Garmin-bestand(en) worden uitgelezen...' : 'Klik om Garmin .fit, .tcx, .gpx of .csv te kiezen'}
            </span>
            <span className="text-xs text-slate-500 mt-1 block">Meerdere bestanden tegelijk selecteren mogelijk</span>
          </label>

          {garminMsg && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{garminMsg}</span>
            </p>
          )}
          {garminErr && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{garminErr}</p>
          )}
        </div>
      </div>

      {/* 3. Bootcamp & Quick Manual Logger */}
      <form onSubmit={handleManualLog} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">3. Bootcamp, Core of Looptraining snel loggen</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Neem bootcamp-sessies mee in je trainingsbelasting zodat je coach weet wanneer je benen herstel nodig hebben.
            </p>
          </div>
          <Dumbbell className="w-5 h-5 text-emerald-700 shrink-0" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Type training</label>
            <select
              value={logType}
              onChange={(e) => {
                const next = e.target.value as ActivityType;
                setLogType(next);
                if (next === 'bootcamp') setLogTitle('Bootcamp sessie');
                else if (next === 'run_outdoor') setLogTitle('Buitenloop');
                else if (next === 'run_treadmill') setLogTitle('Loopbandtraining');
                else if (next === 'core_physio') setLogTitle('Core & Buikspieren');
              }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="bootcamp">Bootcamp</option>
              <option value="run_outdoor">Hardlopen buiten</option>
              <option value="run_treadmill">Loopband (binnen)</option>
              <option value="core_physio">Core / Buikspieren / Fysio</option>
              <option value="cross_train">Overige crosstraining</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Titel</label>
            <input
              type="text"
              required
              value={logTitle}
              onChange={(e) => setLogTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Datum</label>
            <input
              type="date"
              required
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Duur (minuten)</label>
            <input
              type="number"
              min={5}
              max={360}
              required
              value={logDuration}
              onChange={(e) => setLogDuration(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {logType === 'bootcamp' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Bootcamp focus</label>
              <select
                value={bootcampFocus}
                onChange={(e) => setBootcampFocus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="full_body">Full-body circuit</option>
                <option value="legs_plyo">Benen, squats &amp; sprongkracht</option>
                <option value="upper_core">Bovenlichaam &amp; core</option>
                <option value="cardio_hiit">Cardio HIIT</option>
              </select>
            </div>
          )}

          {(logType === 'run_outdoor' || logType === 'run_treadmill') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Afstand (km)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={200}
                value={logDistance}
                onChange={(e) => setLogDistance(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
              {logDistance > 0.2 && (
                <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                  Tempo: {formatPace(Math.round((logDuration * 60) / logDistance))}
                </p>
              )}
            </div>
          )}

          {logType === 'run_treadmill' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gem. helling (%)</label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={25}
                value={logIncline}
                onChange={(e) => setLogIncline(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Gem. hartslag (optioneel)</label>
            <input
              type="number"
              min={0}
              max={230}
              value={logAvgHr}
              onChange={(e) => setLogAvgHr(Number(e.target.value))}
              placeholder="0 = onbekend"
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
              <span>Zwaarte (RPE 1–10)</span>
              <span className="font-mono tabular-nums">{logRpe}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={logRpe}
              onChange={(e) => setLogRpe(Number(e.target.value))}
              className="w-full accent-emerald-600 mt-2"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">Spierpijn / fysio-notitie (optioneel)</label>
            <input
              type="text"
              value={sorenessNote}
              onChange={(e) => setSorenessNote(e.target.value)}
              placeholder="Bijv. veel lunges en box jumps, lichte vermoeidheid in hamstrings"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={logSaving}
            className="px-5 py-2.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {logSaving ? 'Opslaan...' : 'Training toevoegen'}
          </button>
        </div>

        {logSuccess && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            {logSuccess}
          </p>
        )}
      </form>
    </div>
  );
}
