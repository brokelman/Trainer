import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Flame, HeartPulse, Home, MessageSquare, Send, ShieldAlert, Trees } from 'lucide-react';
import type {
  CheckInEnvironment,
  CoachMessage,
  DailyCheckIn,
  LoadMetrics,
  RunningGoal,
  TrainingActivity,
  UserProfile,
} from '../types';
import { authenticatedFetch } from '../lib/firebase';
import { addCoachMessage, markCheckInCompleted, saveDailyCheckIn, addActivitiesBatch } from '../lib/store';
import { calculateTrainingLoad, formatDurationSeconds, formatPace, todayIsoDate } from '../lib/trainingMath';

interface TodayCoachViewProps {
  uid: string;
  profile: UserProfile | null;
  goals: RunningGoal[];
  activities: TrainingActivity[];
  loadMetrics: LoadMetrics;
  todayCheckIn: DailyCheckIn | null;
  messages: CoachMessage[];
  onNavigate: (tab: 'goals' | 'import' | 'physio') => void;
}

const PLAN_TYPE_LABELS: Record<string, string> = {
  easy_run: 'Rustige Duurloop',
  tempo_run: 'Tempotraining',
  intervals: 'Intervaltraining',
  long_run: 'Lange Duurloop',
  treadmill_incline: 'Loopband met Helling',
  core_physio: 'Core & Fysio Thuisworkout',
  rest_recovery: 'Rust & Herstel',
};

export function TodayCoachView({
  uid,
  profile,
  goals,
  activities,
  loadMetrics,
  todayCheckIn,
  messages,
  onNavigate,
}: TodayCoachViewProps) {
  const today = todayIsoDate();
  const activeGoals = goals.filter((g) => g.status === 'active');
  const primaryGoal = activeGoals.find((g) => g.priority === 'A') || activeGoals[0] || null;

  const [wantsToTrain, setWantsToTrain] = useState<boolean>(todayCheckIn?.wantsToTrain ?? true);
  const [environment, setEnvironment] = useState<CheckInEnvironment>(todayCheckIn?.environment ?? 'outdoor');
  const [availableMinutes, setAvailableMinutes] = useState<number>(todayCheckIn?.availableMinutes ?? 45);
  const [energyLevel, setEnergyLevel] = useState<number>(todayCheckIn?.energyLevel ?? 4);
  const [muscleSoreness, setMuscleSoreness] = useState<number>(todayCheckIn?.muscleSoreness ?? 2);
  const [painArea, setPainArea] = useState<string>(todayCheckIn?.painArea ?? '');
  const [painSeverity, setPainSeverity] = useState<number>(todayCheckIn?.painSeverity ?? 0);
  const [notes, setNotes] = useState<string>(todayCheckIn?.notes ?? '');

  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    if (todayCheckIn) {
      setWantsToTrain(todayCheckIn.wantsToTrain);
      setEnvironment(todayCheckIn.environment);
      setAvailableMinutes(todayCheckIn.availableMinutes);
      setEnergyLevel(todayCheckIn.energyLevel);
      setMuscleSoreness(todayCheckIn.muscleSoreness);
      setPainArea(todayCheckIn.painArea);
      setPainSeverity(todayCheckIn.painSeverity);
      setNotes(todayCheckIn.notes);
    }
  }, [todayCheckIn?.id]);

  const isIndoor = environment === 'indoor_treadmill' || environment === 'indoor_core';
  const maxMinutesForEnv = isIndoor ? 60 : 150;

  useEffect(() => {
    if (isIndoor && availableMinutes > 60) {
      setAvailableMinutes(60);
    }
  }, [environment, isIndoor, availableMinutes]);

  const handleGeneratePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setGenerating(true);

    const effectiveEnv: CheckInEnvironment = !wantsToTrain ? 'rest' : environment === 'rest' ? 'outdoor' : environment;
    const effectiveMins = !wantsToTrain ? 0 : isIndoor ? Math.min(60, availableMinutes) : availableMinutes;

    const checkinInput = {
      date: today,
      wantsToTrain,
      environment: effectiveEnv,
      availableMinutes: effectiveMins,
      energyLevel,
      muscleSoreness,
      painArea: painArea.trim(),
      painSeverity,
      notes: notes.trim(),
    };

    try {
      const resp = await authenticatedFetch('/api/coach/daily-plan', {
        profile,
        goals: activeGoals.filter((g) => g.userId === uid),
        recentActivities: activities.filter((a) => a.userId === uid).slice(0, 25),
        loadMetrics,
        checkin: { ...checkinInput, userId: uid },
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Kon trainingsplan niet ophalen.');
      }

      await saveDailyCheckIn(
        uid,
        today,
        {
          ...checkinInput,
          coachPlanTitle: data.coachPlanTitle || 'Training van vandaag',
          coachPlanType: data.coachPlanType || 'easy_run',
          coachReasoning: data.coachReasoning || '',
          physioAdvice: data.physioAdvice || '',
          workoutWarmup: data.workoutWarmup || '',
          workoutMain: data.workoutMain || '',
          workoutCooldown: data.workoutCooldown || '',
          treadmillSpeedKmh: data.treadmillSpeedKmh || 'N.v.t.',
          treadmillInclinePct: data.treadmillInclinePct || 'N.v.t.',
          targetHrZone: data.targetHrZone || 'Z2',
          estimatedLoad: Number(data.estimatedLoad) || 40,
          completed: false,
        },
        Boolean(todayCheckIn)
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Er ging iets mis bij het genereren van het plan.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompleteWorkout = async () => {
    if (!todayCheckIn || todayCheckIn.completed) return;
    setCompleting(true);
    setErrorMsg(null);
    try {
      await markCheckInCompleted(uid, today);
      if (todayCheckIn.wantsToTrain && todayCheckIn.availableMinutes > 0) {
        const actType =
          todayCheckIn.coachPlanType === 'core_physio' || todayCheckIn.environment === 'indoor_core'
            ? 'core_physio'
            : todayCheckIn.environment === 'indoor_treadmill' || todayCheckIn.coachPlanType === 'treadmill_incline'
              ? 'run_treadmill'
              : 'run_outdoor';
        const rpe = todayCheckIn.coachPlanType === 'intervals' || todayCheckIn.coachPlanType === 'tempo_run' ? 7 : 5;
        await addActivitiesBatch(
          uid,
          [
            {
              source: 'coach',
              activityType: actType,
              title: todayCheckIn.coachPlanTitle || 'Coach training',
              date: today,
              durationMinutes: todayCheckIn.availableMinutes,
              distanceKm: actType === 'core_physio' ? 0 : Number(((todayCheckIn.availableMinutes / 6) * 0.95).toFixed(1)),
              avgPaceSecPerKm: actType === 'core_physio' ? 0 : 345,
              avgHr: 0,
              maxHr: 0,
              elevationGainM: 0,
              inclinePct: todayCheckIn.environment === 'indoor_treadmill' ? 1.5 : 0,
              rpe,
              trainingLoad:
                todayCheckIn.estimatedLoad ||
                calculateTrainingLoad({
                  durationMinutes: todayCheckIn.availableMinutes,
                  activityType: actType,
                  maxHr: profile?.maxHr,
                  restingHr: profile?.restingHr,
                  rpe,
                }),
              bootcampFocus: '',
              sorenessNote: todayCheckIn.painArea ? `${todayCheckIn.painArea} (${todayCheckIn.painSeverity}/10)` : '',
              externalId: `coach-plan-${today}`,
            },
          ],
          new Set(activities.map((a) => a.externalId))
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kon training niet afronden.');
    } finally {
      setCompleting(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading || !todayCheckIn) return;
    setChatInput('');
    setChatLoading(true);
    setErrorMsg(null);
    try {
      await addCoachMessage(uid, today, 'user', trimmed);
      const resp = await authenticatedFetch('/api/coach/chat', {
        profile,
        goals: activeGoals.filter((g) => g.userId === uid),
        loadMetrics,
        checkin: todayCheckIn,
        messages: messages.filter((m) => m.userId === uid),
        userMessage: trimmed,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Coach kon niet antwoorden.');
      await addCoachMessage(uid, today, 'coach', data.reply);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Fout bij verzenden naar coach.');
    } finally {
      setChatLoading(false);
    }
  };

  const daysUntilGoal = primaryGoal
    ? Math.ceil((new Date(primaryGoal.raceDate).getTime() - new Date(today).getTime()) / 86400000)
    : null;

  return (
    <div className="space-y-6">
      {/* Context strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">
            Dagelijkse Coach &amp; Fysio · {today}
          </p>
          {primaryGoal ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold text-slate-900 text-balance">{primaryGoal.title}</h2>
              <span className="text-sm text-slate-600 font-mono tabular-nums">
                {primaryGoal.distanceKm} km · {formatDurationSeconds(primaryGoal.targetTimeSeconds)} (
                {formatPace(primaryGoal.targetTimeSeconds / primaryGoal.distanceKm)}) · nog {daysUntilGoal} dagen
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-900">Stel eerst je hardloopdoel in</h2>
              <button
                type="button"
                onClick={() => onNavigate('goals')}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800 underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Doel toevoegen
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-6 text-sm border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
          <div>
            <p className="text-xs text-slate-500">7d Hardlopen</p>
            <p className="font-mono tabular-nums font-semibold text-slate-900">{loadMetrics.weeklyRunKm} km</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">7d Bootcamp</p>
            <p className="font-mono tabular-nums font-semibold text-slate-900">{loadMetrics.weeklyBootcampMin} min</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">ACWR Ratio</p>
            <p
              className={`font-mono tabular-nums font-semibold ${
                loadMetrics.riskStatus === 'high'
                  ? 'text-red-600'
                  : loadMetrics.riskStatus === 'caution'
                    ? 'text-amber-600'
                    : 'text-emerald-700'
              }`}
            >
              {loadMetrics.acwr > 0 ? loadMetrics.acwr.toFixed(2) : '—'} ·{' '}
              {loadMetrics.riskStatus === 'high'
                ? 'Overbelasting'
                : loadMetrics.riskStatus === 'caution'
                  ? 'Let op'
                  : loadMetrics.riskStatus === 'underloaded'
                    ? 'Opbouwfase'
                    : 'Optimaal'}
            </p>
          </div>
          {!profile?.stravaImportedCount && (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="px-3.5 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Strava / Garmin uploaden
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Daily Check-In Form */}
        <form
          onSubmit={handleGeneratePlan}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Check-in van vandaag</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Geen vaste weekdagen: bepaal per dag wat past.
              </p>
            </div>
            {todayCheckIn?.completed && (
              <span className="text-xs font-medium text-emerald-700 flex items-center gap-1 whitespace-nowrap shrink-0">
                <CheckCircle2 className="w-4 h-4" /> Voltooid
              </span>
            )}
          </div>

          {/* 1. Train today? */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-800">1. Wil en kan je vandaag trainen?</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                disabled={todayCheckIn?.completed}
                onClick={() => {
                  setWantsToTrain(true);
                  if (environment === 'rest') setEnvironment('outdoor');
                }}
                className={`py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  wantsToTrain ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ja, trainen
              </button>
              <button
                type="button"
                disabled={todayCheckIn?.completed}
                onClick={() => {
                  setWantsToTrain(false);
                  setEnvironment('rest');
                }}
                className={`py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  !wantsToTrain ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Nee, rustdag
              </button>
            </div>
          </div>

          {wantsToTrain && (
            <>
              {/* 2. Environment */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-800">2. Waar kun je vandaag trainen?</label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    disabled={todayCheckIn?.completed}
                    onClick={() => setEnvironment('outdoor')}
                    className={`flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg border text-left transition-colors ${
                      environment === 'outdoor'
                        ? 'border-emerald-600 bg-emerald-50/60 text-slate-900 font-medium'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Trees className="w-4 h-4 text-emerald-700 shrink-0" />
                      Buiten hardlopen
                    </span>
                    <span className="text-xs text-slate-500">Vrije duur</span>
                  </button>

                  <button
                    type="button"
                    disabled={todayCheckIn?.completed}
                    onClick={() => setEnvironment('indoor_treadmill')}
                    className={`flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg border text-left transition-colors ${
                      environment === 'indoor_treadmill'
                        ? 'border-emerald-600 bg-emerald-50/60 text-slate-900 font-medium'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Activity className="w-4 h-4 text-emerald-700 shrink-0" />
                      Binnen op loopband (met helling)
                    </span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">Max 60 min</span>
                  </button>

                  <button
                    type="button"
                    disabled={todayCheckIn?.completed}
                    onClick={() => setEnvironment('indoor_core')}
                    className={`flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg border text-left transition-colors ${
                      environment === 'indoor_core'
                        ? 'border-emerald-600 bg-emerald-50/60 text-slate-900 font-medium'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Home className="w-4 h-4 text-emerald-700 shrink-0" />
                      Binnen thuisworkout (core &amp; buikspieren)
                    </span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">Max 60 min</span>
                  </button>
                </div>
              </div>

              {/* 3. Duration */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="minutes-range" className="text-sm font-medium text-slate-800">
                    3. Hoelang kun je trainen?
                  </label>
                  <span className="font-mono tabular-nums text-sm font-semibold text-emerald-700">
                    {Math.min(availableMinutes, maxMinutesForEnv)} min
                  </span>
                </div>
                <input
                  id="minutes-range"
                  type="range"
                  min={15}
                  max={maxMinutesForEnv}
                  step={5}
                  disabled={todayCheckIn?.completed}
                  value={Math.min(availableMinutes, maxMinutesForEnv)}
                  onChange={(e) => setAvailableMinutes(Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
                <div className="flex flex-wrap gap-1.5">
                  {(isIndoor ? [20, 30, 45, 60] : [30, 45, 60, 75, 90, 120]).map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      disabled={todayCheckIn?.completed}
                      onClick={() => setAvailableMinutes(mins)}
                      className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border transition-colors ${
                        availableMinutes === mins
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 4. Physio & readiness check */}
          <div className="border-t border-slate-100 pt-4 space-y-4">
            <p className="text-sm font-medium text-slate-800">4. Fysio-check &amp; herstelstatus</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span>Energiepeil</span>
                  <span className="font-mono tabular-nums font-medium">{energyLevel}/5</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  disabled={todayCheckIn?.completed}
                  value={energyLevel}
                  onChange={(e) => setEnergyLevel(Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span>Spierpijn (bijv. na bootcamp)</span>
                  <span className="font-mono tabular-nums font-medium">{muscleSoreness}/5</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  disabled={todayCheckIn?.completed}
                  value={muscleSoreness}
                  onChange={(e) => setMuscleSoreness(Number(e.target.value))}
                  className="w-full accent-amber-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="pain-area" className="block text-xs text-slate-600 mb-1">
                  Gevoelige plek / pijntje (optioneel)
                </label>
                <input
                  id="pain-area"
                  type="text"
                  disabled={todayCheckIn?.completed}
                  placeholder="Bijv. rechter kuit, achilles, knie"
                  value={painArea}
                  onChange={(e) => setPainArea(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
              <div>
                <label htmlFor="pain-sev" className="block text-xs text-slate-600 mb-1">
                  Pijnscore (0–10)
                </label>
                <input
                  id="pain-sev"
                  type="number"
                  min={0}
                  max={10}
                  disabled={todayCheckIn?.completed}
                  value={painSeverity}
                  onChange={(e) => setPainSeverity(Math.max(0, Math.min(10, Number(e.target.value))))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="checkin-notes" className="block text-xs text-slate-600 mb-1">
                Opmerking voor coach / fysio (optioneel)
              </label>
              <textarea
                id="checkin-notes"
                rows={2}
                disabled={todayCheckIn?.completed}
                placeholder="Bijv. gisteren zware bootcamp met veel squats gehad, of wil iets op snelheid testen"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>
          </div>

          {!todayCheckIn?.completed && (
            <button
              type="submit"
              disabled={generating}
              className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {generating
                ? 'Coach & fysio analyseren je belasting...'
                : todayCheckIn
                  ? 'Training opnieuw afstemmen'
                  : 'Stel training voor vandaag op'}
            </button>
          )}
        </form>

        {/* Right column: Prescribed Workout + Interactive Chat */}
        <div className="lg:col-span-7 space-y-6">
          {todayCheckIn ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-emerald-700">
                    {PLAN_TYPE_LABELS[todayCheckIn.coachPlanType] || todayCheckIn.coachPlanType} · Geschatte load{' '}
                    <span className="font-mono tabular-nums">{todayCheckIn.estimatedLoad}</span>
                  </p>
                  <h3 className="text-xl font-semibold text-slate-900 text-balance">
                    {todayCheckIn.coachPlanTitle}
                  </h3>
                </div>

                {!todayCheckIn.completed ? (
                  <button
                    type="button"
                    disabled={completing}
                    onClick={handleCompleteWorkout}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {completing ? 'Opslaan...' : 'Training voltooid'}
                  </button>
                ) : (
                  <span className="text-sm font-medium text-emerald-700 whitespace-nowrap shrink-0">
                    Opgeslagen in logboek
                  </span>
                )}
              </div>

              {/* Target metrics strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-slate-100 text-sm">
                <div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Duur
                  </p>
                  <p className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {todayCheckIn.availableMinutes} min
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <HeartPulse className="w-3.5 h-3.5" /> Doelzone
                  </p>
                  <p className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {todayCheckIn.targetHrZone || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5" /> Loopband Snelheid
                  </p>
                  <p className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {todayCheckIn.treadmillSpeedKmh || 'N.v.t.'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Loopband Helling</p>
                  <p className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                    {todayCheckIn.treadmillInclinePct || 'N.v.t.'}
                  </p>
                </div>
              </div>

              {/* Workout Blocks */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Warming-up</h4>
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">{todayCheckIn.workoutWarmup}</p>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Kern van de training</h4>
                  <p className="text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-line">
                    {todayCheckIn.workoutMain}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Cooling-down</h4>
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">{todayCheckIn.workoutCooldown}</p>
                </div>
              </div>

              {/* Coach & Physio Rationale */}
              <div className="border-t border-slate-200 pt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <h4 className="text-sm font-semibold text-slate-900">Waarom deze training (Coach)</h4>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {todayCheckIn.coachReasoning}
                  </p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Fysio &amp; Blessurepreventie
                  </h4>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {todayCheckIn.physioAdvice}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('physio')}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 underline underline-offset-4 whitespace-nowrap"
                  >
                    Schakel AI-Fysio Dorien Janse (dorienjanse.nl) in
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
              <h3 className="text-lg font-semibold text-slate-900">Klaar voor jouw training van vandaag?</h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                Vul links je beschikbaarheid voor vandaag in (buiten, binnen op de loopband of thuis core/fysio). Je
                coach kijkt direct naar je hardloopdoel, Strava-historie, laatste Garmin-runs en bootcamp-belasting.
              </p>
            </div>
          )}

          {/* Interactive Coach & Physio Chat */}
          {todayCheckIn && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <MessageSquare className="w-4 h-4 text-slate-700" />
                <h4 className="text-base font-semibold text-slate-900">Overleg met je Coach &amp; Fysio</h4>
              </div>

              {messages.length > 0 ? (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-3.5 rounded-lg text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-slate-900 text-white ml-8'
                          : 'bg-slate-50 border border-slate-200 text-slate-800 mr-8'
                      }`}
                    >
                      <p className="text-xs font-medium opacity-70 mb-1">
                        {m.role === 'user' ? 'Jij' : 'Coach & Fysio'}
                      </p>
                      <p className="whitespace-pre-line">{m.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Vraag bijvoorbeeld: &ldquo;Mijn kuit voelt wat stijf, hoe pas ik het tempo of de helling aan?&rdquo; of
                  &ldquo;Welke extra buikspieroefening past na de bootcamp van gisteren?&rdquo;
                </p>
              )}

              <form onSubmit={handleSendChat} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Stel een vraag of vraag om een aanpassing..."
                  className="flex-1 px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  {chatLoading ? 'Denkt...' : 'Stuur'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
