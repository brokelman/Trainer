import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Database,
  ExternalLink,
  Flag,
  HeartHandshake,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react';
import type {
  FitnessLevel,
  LoadMetrics,
  PhysioConsult,
  RunningGoal,
  TrainingActivity,
  UserProfile,
} from '../types';
import { authenticatedFetch } from '../lib/firebase';
import { addPhysioConsult, createGoal, savePhysioIntakeOrCheckin } from '../lib/store';
import { formatDurationSeconds, todayIsoDate } from '../lib/trainingMath';

interface PhysioDorienViewProps {
  uid: string;
  profile: UserProfile | null;
  goals: RunningGoal[];
  activities: TrainingActivity[];
  loadMetrics: LoadMetrics;
  consults: PhysioConsult[];
  onNavigate: (tab: 'today' | 'goals' | 'import' | 'load') => void;
}

const FITNESS_LABELS: Record<FitnessLevel, string> = {
  beginner: 'Beginner (opbouwend naar 5–10 km)',
  recreational: 'Recreatief (1–2x per week lopen)',
  intermediate: 'Gevorderd (3–4x per week, wedstrijdervaring)',
  advanced: 'Prestatiegericht (4+ trainingen/week)',
};

export function PhysioDorienView({
  uid,
  profile,
  goals,
  activities,
  loadMetrics,
  consults,
  onNavigate,
}: PhysioDorienViewProps) {
  const today = todayIsoDate();
  const activeGoals = goals.filter((g) => g.status === 'active');

  const daysSinceCheckin = profile?.lastPhysioCheckinAt
    ? Math.floor((new Date(today).getTime() - new Date(profile.lastPhysioCheckinAt).getTime()) / 86400000)
    : null;
  const monthlyCheckinDue = Boolean(profile?.intakeCompleted) && (daysSinceCheckin === null || daysSinceCheckin >= 28);

  const [showIntakeOrMonthlyForm, setShowIntakeOrMonthlyForm] = useState<boolean>(!profile?.intakeCompleted);
  const [fitnessLevel, setFitnessLevel] = useState<FitnessLevel>(profile?.fitnessLevel || 'recreational');
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState<number>(profile?.currentWeeklyKm ?? 15);
  const [currentComplaints, setCurrentComplaints] = useState<string>(profile?.currentComplaints || '');
  const [painSeverity, setPainSeverity] = useState<number>(profile?.complaintSeverity ?? 0);
  const [sensitiveAreas, setSensitiveAreas] = useState<string>(profile?.sensitiveAreas || '');
  const [intakeNotes, setIntakeNotes] = useState<string>('');

  // Quick goal creator inside intake if user has no goal yet
  const [addGoalInline, setAddGoalInline] = useState(false);
  const [goalTitle, setGoalTitle] = useState('10 km doel');
  const [goalDistance, setGoalDistance] = useState(10);
  const [goalDate, setGoalDate] = useState(() => new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
  const [goalMinutes, setGoalMinutes] = useState(50);

  const [submittingIntake, setSubmittingIntake] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // On-demand consult
  const [consultQuestion, setConsultQuestion] = useState('');
  const [consultComplaints, setConsultComplaints] = useState('');
  const [consultSeverity, setConsultSeverity] = useState(0);
  const [submittingConsult, setSubmittingConsult] = useState(false);

  useEffect(() => {
    if (profile) {
      setFitnessLevel(profile.fitnessLevel || 'recreational');
      setCurrentWeeklyKm(profile.currentWeeklyKm ?? 15);
      setCurrentComplaints(profile.currentComplaints || '');
      setPainSeverity(profile.complaintSeverity ?? 0);
      setSensitiveAreas(profile.sensitiveAreas || '');
      if (!profile.intakeCompleted) {
        setShowIntakeOrMonthlyForm(true);
      }
    }
  }, [profile]);

  const handleSubmitIntakeOrMonthly = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingIntake(true);
    setErrorMsg(null);

    try {
      if (addGoalInline && goalTitle.trim() && goalDistance > 0) {
        await createGoal(uid, {
          title: goalTitle.trim(),
          location: '',
          distanceKm: Number(goalDistance),
          raceDate: goalDate,
          targetTimeSeconds: Math.max(60, goalMinutes * 60),
          priority: 'A',
          status: 'active',
          notes: 'Vastgelegd tijdens fysio-intake',
        });
      }

      const kind = profile?.intakeCompleted ? 'monthly_checkin' : 'intake';
      const resp = await authenticatedFetch('/api/physio/intake-plan', {
        kind,
        profile,
        intake: {
          fitnessLevel,
          currentWeeklyKm,
          currentComplaints: currentComplaints.trim(),
          painSeverity,
          sensitiveAreas: sensitiveAreas.trim(),
          notes: intakeNotes.trim(),
        },
        goals: activeGoals.filter((g) => g.userId === uid),
        recentActivities: activities.filter((a) => a.userId === uid).slice(0, 20),
        loadMetrics,
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Kon fysio-beoordeling niet uitvoeren.');

      await savePhysioIntakeOrCheckin(uid, {
        intakeCompleted: true,
        fitnessLevel,
        currentWeeklyKm,
        currentComplaints: currentComplaints.trim(),
        complaintSeverity: painSeverity,
        sensitiveAreas: sensitiveAreas.trim(),
        physioPlanSummary: data.physioPlanSummary || data.physioResponse || '',
        referralRecommended: Boolean(data.referralRecommended),
        referralReason: data.referralReason || '',
        lastPhysioCheckinAt: today,
      });

      await addPhysioConsult(uid, {
        kind,
        date: today,
        complaintsSummary: currentComplaints.trim() || 'Geen klachten',
        painSeverity,
        userQuestion:
          kind === 'monthly_checkin'
            ? `Maandelijkse fysio check-in (${fitnessLevel}, ${currentWeeklyKm} km/wk)${intakeNotes ? ` — ${intakeNotes}` : ''}`
            : `Eerste fysio intake (${fitnessLevel}, ${currentWeeklyKm} km/wk)${intakeNotes ? ` — ${intakeNotes}` : ''}`,
        physioResponse: data.physioResponse || '',
        planRecommendations: data.planRecommendations || '',
        referralRecommended: Boolean(data.referralRecommended),
        referralReason: data.referralReason || '',
      });

      setShowIntakeOrMonthlyForm(false);
      setIntakeNotes('');
      setAddGoalInline(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Er ging iets mis bij het opslaan van de fysio-intake.');
    } finally {
      setSubmittingIntake(false);
    }
  };

  const handleOnDemandConsult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consultQuestion.trim()) return;
    setSubmittingConsult(true);
    setErrorMsg(null);

    try {
      const resp = await authenticatedFetch('/api/physio/consult', {
        profile,
        goals: activeGoals.filter((g) => g.userId === uid),
        loadMetrics,
        complaintsSummary: consultComplaints.trim(),
        painSeverity: consultSeverity,
        userQuestion: consultQuestion.trim(),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Kon fysio-consult niet uitvoeren.');

      await addPhysioConsult(uid, {
        kind: 'ondemand_consult',
        date: today,
        complaintsSummary: consultComplaints.trim() || profile?.currentComplaints || 'Geen',
        painSeverity: consultSeverity,
        userQuestion: consultQuestion.trim(),
        physioResponse: data.physioResponse || '',
        planRecommendations: data.planRecommendations || '',
        referralRecommended: Boolean(data.referralRecommended),
        referralReason: data.referralReason || '',
      });

      if (data.referralRecommended) {
        await savePhysioIntakeOrCheckin(uid, {
          intakeCompleted: profile?.intakeCompleted ?? true,
          fitnessLevel: profile?.fitnessLevel || 'recreational',
          currentWeeklyKm: profile?.currentWeeklyKm ?? 0,
          currentComplaints: consultComplaints.trim() || profile?.currentComplaints || '',
          complaintSeverity: Math.max(profile?.complaintSeverity ?? 0, consultSeverity),
          sensitiveAreas: profile?.sensitiveAreas || '',
          physioPlanSummary: profile?.physioPlanSummary || '',
          referralRecommended: true,
          referralReason: data.referralReason || 'Fysiek onderzoek bij Dorien Janse geadviseerd.',
          lastPhysioCheckinAt: profile?.lastPhysioCheckinAt || today,
        });
      }

      setConsultQuestion('');
      setConsultComplaints('');
      setConsultSeverity(0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kon consult niet verzenden.');
    } finally {
      setSubmittingConsult(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header by Dorien Janse */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2 max-w-3xl">
          <p className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <Stethoscope className="w-3.5 h-3.5" />
            AI Sportfysiotherapeut · Gebaseerd op dorienjanse.nl
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 text-balance">
            {profile?.intakeCompleted
              ? `Welkom terug ${profile.displayName}, ik ben Dorien Janse (AI Fysio)`
              : `Welkom ${profile?.displayName || ''}, ik ben fysiotherapeut Dorien Janse`}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            {profile?.intakeCompleted
              ? 'Op basis van de oorzaakgerichte sportfysiotherapie van dorienjanse.nl (specifieke kracht, core stability, looptechniek en verantwoorde opbouw) bewaak ik jouw belastbaarheid, voer ik maandelijks een check-in uit en geef ik advies op aanvraag.'
              : 'Fijn dat je er bent! Laten we eerst een korte fysio-intake doen om je huidige conditie, eventuele klachten en hardloopdoelen in kaart te brengen. Upload gerust ook je Strava- of Garmin-historie zodat ik direct een passend plan kan opstellen.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {profile?.intakeCompleted && (
            <button
              type="button"
              onClick={() => setShowIntakeOrMonthlyForm((v) => !v)}
              className="px-4 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <CalendarClock className="w-4 h-4 text-emerald-700" />
              {showIntakeOrMonthlyForm ? 'Sluit check-in formulier' : 'Maandelijkse check-in starten'}
            </button>
          )}
          <a
            href="https://www.dorienjanse.nl"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-xs font-medium bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            Contact via dorienjanse.nl
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Referral Alert Banner if recommended */}
      {profile?.referralRecommended && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-red-950"
        >
          <div className="flex items-start gap-3.5">
            <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold">
                Doorverwijzing geadviseerd naar de praktijk van Dorien Janse
              </h3>
              <p className="text-sm text-red-900 leading-relaxed">
                {profile.referralReason ||
                  'Op basis van je klachtenpatroon of pijnscore adviseert de AI-fysio een persoonlijk onderzoek of loopanalyse.'}
              </p>
              <p className="text-xs font-mono text-red-800">
                Contactformulier: www.dorienjanse.nl · E-mail: info@dorienjanse.nl · Tel: 06-14184448
              </p>
            </div>
          </div>

          <a
            href="https://www.dorienjanse.nl"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start lg:self-center"
          >
            Afspraak maken op dorienjanse.nl
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Monthly Check-in Due Banner */}
      {monthlyCheckinDue && !showIntakeOrMonthlyForm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Tijd voor je maandelijkse fysio check-in
              </h3>
              <p className="text-xs text-amber-900 mt-0.5">
                {daysSinceCheckin !== null
                  ? `Je laatste check-in was ${daysSinceCheckin} dagen geleden.`
                  : 'Tijd voor een periodieke controle.'}{' '}
                Dorien Janse evalueert je klachten, belasting en voortgang voor de komende maand.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowIntakeOrMonthlyForm(true)}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
          >
            Check-in invullen
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">{errorMsg}</div>
      )}

      {/* Intake / Monthly Check-in Form */}
      {showIntakeOrMonthlyForm && (
        <form onSubmit={handleSubmitIntakeOrMonthly} className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {profile?.intakeCompleted ? 'Maandelijkse Fysio Check-in — Dorien Janse' : 'Intakegesprek — Dorien Janse'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bepaal je huidige conditie, klachten en doelen. Daarna stelt Dorien Janse jouw persoonlijke plan op.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">{today}</span>
          </div>

          {/* Step 1: Condition & Volume */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                1. Huidig conditie- &amp; loopniveau
              </label>
              <select
                value={fitnessLevel}
                onChange={(e) => setFitnessLevel(e.target.value as FitnessLevel)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {Object.entries(FITNESS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Gemiddeld loopvolume per week (km)
              </label>
              <input
                type="number"
                min={0}
                max={250}
                value={currentWeeklyKm}
                onChange={(e) => setCurrentWeeklyKm(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          {/* Step 2: Complaints & Sensitive Areas */}
          <div className="border-t border-slate-100 pt-5 space-y-4">
            <p className="text-sm font-medium text-slate-900">2. Klachten, pijntjes &amp; blessurehistorie</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Huidige klachten of stijfheid (indien aanwezig)
                </label>
                <input
                  type="text"
                  value={currentComplaints}
                  onChange={(e) => setCurrentComplaints(e.target.value)}
                  placeholder="Bijv. lichte stijfheid rechter achillespees in de ochtend, of geen klachten"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                  <span>Pijnscore nu</span>
                  <span className="font-mono tabular-nums">{painSeverity}/10</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={painSeverity}
                  onChange={(e) => setPainSeverity(Number(e.target.value))}
                  className="w-full accent-emerald-600 mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bekende zwakke plekken / eerdere blessures
                </label>
                <input
                  type="text"
                  value={sensitiveAreas}
                  onChange={(e) => setSensitiveAreas(e.target.value)}
                  placeholder="Bijv. scheenbenen, knie, onderrug, heupstabiliteit"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Extra toelichting voor Dorien Janse
                </label>
                <input
                  type="text"
                  value={intakeNotes}
                  onChange={(e) => setIntakeNotes(e.target.value)}
                  placeholder="Bijv. wat ik wil bereiken of wanneer klachten optreden"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Data upload & Goals summary */}
          <div className="border-t border-slate-100 pt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-emerald-700" />
                  3a. Historische trainingsgegevens
                </p>
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  {activities.length} sessies · {profile?.stravaImportedCount || 0} Strava
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Upload desgewenst nu (of later) je Strava-archief en Garmin-trainingen zodat Dorien Janse je echte
                trainingshistorie in het plan meeneemt.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('import')}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-md text-slate-800 whitespace-nowrap"
              >
                Strava / Garmin / Bootcamp uploaden
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Flag className="w-4 h-4 text-emerald-700" />
                  3b. Hardloopdoelen ({activeGoals.length})
                </p>
                <button
                  type="button"
                  onClick={() => setAddGoalInline((v) => !v)}
                  className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap"
                >
                  {addGoalInline ? 'Annuleren' : '+ Snel doel toevoegen'}
                </button>
              </div>

              {activeGoals.length > 0 ? (
                <ul className="text-xs text-slate-700 space-y-1 font-mono tabular-nums">
                  {activeGoals.map((g) => (
                    <li key={g.id}>
                      · {g.title} ({g.distanceKm} km · {g.raceDate} · {formatDurationSeconds(g.targetTimeSeconds)})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-600">
                  Nog geen doel vastgelegd. Klik op &ldquo;+ Snel doel toevoegen&rdquo; of ga naar Doelen &amp; Profiel.
                </p>
              )}

              {addGoalInline && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                  <input
                    type="text"
                    value={goalTitle}
                    onChange={(e) => setGoalTitle(e.target.value)}
                    placeholder="Doel naam"
                    className="col-span-2 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={goalDistance}
                    onChange={(e) => setGoalDistance(Number(e.target.value))}
                    placeholder="km"
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white"
                  />
                  <input
                    type="number"
                    value={goalMinutes}
                    onChange={(e) => setGoalMinutes(Number(e.target.value))}
                    placeholder="Streeftijd (min)"
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white"
                  />
                  <input
                    type="date"
                    value={goalDate}
                    onChange={(e) => setGoalDate(e.target.value)}
                    className="col-span-2 px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submittingIntake}
              className="px-5 py-2.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg whitespace-nowrap"
            >
              {submittingIntake
                ? 'Dorien Janse stelt je fysio-plan op...'
                : profile?.intakeCompleted
                  ? 'Maandelijkse check-in afronden & plan bijwerken'
                  : 'Intake afronden & persoonlijk fysio-plan maken'}
            </button>
          </div>
        </form>
      )}

      {/* Main 2-column Physio Plan + On-Demand Consult */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Current Plan & Consult History */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Jouw Dorien Janse Fysio- &amp; Opbouwplan</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  Laatste check-in: {profile?.lastPhysioCheckinAt || 'Nog niet uitgevoerd'} · Niveau:{' '}
                  {profile?.fitnessLevel || 'recreational'}
                </p>
              </div>
              {profile?.intakeCompleted && (
                <span className="text-xs font-medium text-emerald-700 flex items-center gap-1 whitespace-nowrap shrink-0">
                  <CheckCircle2 className="w-4 h-4" /> Actief
                </span>
              )}
            </div>

            {profile?.physioPlanSummary ? (
              <div className="space-y-3 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {profile.physioPlanSummary}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Rond hierboven eerst de fysio-intake af zodat Dorien Janse jouw persoonlijke opbouw- en
                blessurepreventieplan kan opstellen.
              </p>
            )}
          </div>

          {/* History of Consults & Monthly Check-ins */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
              Fysio-dossier &amp; eerdere adviezen ({consults.length})
            </h3>
            {consults.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen consulten of check-ins opgeslagen.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {consults.map((c) => (
                  <div key={c.id} className="py-4 first:pt-1 last:pb-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">
                        {c.kind === 'intake'
                          ? 'Intakegesprek'
                          : c.kind === 'monthly_checkin'
                            ? 'Maandelijkse Check-in'
                            : 'Fysio Consult'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {c.date} · Pijnscore {c.painSeverity}/10
                        {c.referralRecommended ? ' · Doorverwijzing geadviseerd' : ''}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 italic">{c.userQuestion}</p>
                    <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">{c.physioResponse}</p>
                    {c.planRecommendations && (
                      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-line">
                        {c.planRecommendations}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: On-Demand Consult + Dorien Janse Contact Card */}
        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleOnDemandConsult} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <HeartHandshake className="w-4 h-4 text-emerald-700" />
                Vraag AI-Fysio Dorien Janse om advies
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Altijd op verzoek in te schakelen bij opkomende pijntjes, looptechniek of herstelvragen.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Huidige klacht / plek (optioneel)
              </label>
              <input
                type="text"
                value={consultComplaints}
                onChange={(e) => setConsultComplaints(e.target.value)}
                placeholder="Bijv. trekkend gevoel in linkerkuit na interval"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Pijnscore op dit moment</span>
                <span className="font-mono tabular-nums">{consultSeverity}/10</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                value={consultSeverity}
                onChange={(e) => setConsultSeverity(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jouw vraag aan Dorien Janse</label>
              <textarea
                rows={4}
                required
                value={consultQuestion}
                onChange={(e) => setConsultQuestion(e.target.value)}
                placeholder="Bijv. Kan ik hiermee wel mijn duurloop doen, welke krachtoefening helpt, of is een fysieke check nodig?"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={submittingConsult || !consultQuestion.trim()}
              className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              {submittingConsult ? 'Dorien Janse analyseert...' : 'Vraag advies aan Dorien Janse'}
            </button>
          </form>

          {/* Official dorienjanse.nl Referral & Contact Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <p className="text-xs font-medium text-emerald-700">Praktijk voor Sportfysiotherapie &amp; Loopanalyse</p>
              <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                Dorien Janse Personal Fysio &amp; Training
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Blijven klachten aanhouden of adviseert de AI-fysio een fysieke beoordeling of loopanalyse? Neem direct
              contact op met de praktijk via het online contactformulier op dorienjanse.nl:
            </p>

            <div className="space-y-2.5 text-sm text-slate-800">
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Ruimtesonde 7, 3824 MZ Amersfoort</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-slate-500 shrink-0" />
                <a href="tel:0614184448" className="font-mono hover:underline">
                  06-14184448
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                <a href="mailto:info@dorienjanse.nl" className="hover:underline">
                  info@dorienjanse.nl
                </a>
              </div>
            </div>

            <a
              href="https://www.dorienjanse.nl"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-4 border border-slate-300 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              Open contactformulier op www.dorienjanse.nl
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
