import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Activity, ArrowRight, CalendarCheck, Database, Flag, ListChecks, LogOut, Menu, Stethoscope, X } from 'lucide-react';
import { auth, loginWithGoogle, logoutUser, testFirestoreConnection } from './lib/firebase';
import {
  ensureUserProfile,
  subscribeActivities,
  subscribeCheckIn,
  subscribeCheckInMessages,
  subscribeGoals,
  subscribePhysioConsults,
  subscribeProfile,
} from './lib/store';
import { computeLoadMetrics, todayIsoDate } from './lib/trainingMath';
import type { CoachMessage, DailyCheckIn, PhysioConsult, RunningGoal, TrainingActivity, UserProfile } from './types';
import { TodayCoachView } from './components/TodayCoachView';
import { GoalsView } from './components/GoalsView';
import { DataImportView } from './components/DataImportView';
import { LoadPhysioView } from './components/LoadPhysioView';
import { ActivityLogView } from './components/ActivityLogView';
import { PhysioDorienView } from './components/PhysioDorienView';

type TabKey = 'today' | 'physio' | 'goals' | 'import' | 'load' | 'log';

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: typeof CalendarCheck }> = [
  { key: 'today', label: 'Vandaag & Coach', icon: CalendarCheck },
  { key: 'physio', label: 'AI Fysio & Intake', icon: Stethoscope },
  { key: 'goals', label: 'Doelen & Profiel', icon: Flag },
  { key: 'import', label: 'Data & Import', icon: Database },
  { key: 'load', label: 'Belasting & Fysio', icon: Activity },
  { key: 'log', label: 'Activiteitenlogboek', icon: ListChecks },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('today');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [goals, setGoals] = useState<RunningGoal[]>([]);
  const [activities, setActivities] = useState<TrainingActivity[]>([]);
  const [todayCheckIn, setTodayCheckIn] = useState<DailyCheckIn | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [physioConsults, setPhysioConsults] = useState<PhysioConsult[]>([]);
  const [initialRouted, setInitialRouted] = useState(false);

  const today = todayIsoDate();

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (u) => {
      // Immediately purge any previous user state on auth change
      setProfile(null);
      setGoals([]);
      setActivities([]);
      setTodayCheckIn(null);
      setMessages([]);
      setPhysioConsults([]);
      setAuthError(null);
      setUser(u);
      setAuthReady(true);
      setInitialRouted(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // Always clear state before subscribing to a user's personal collections
    setProfile(null);
    setGoals([]);
    setActivities([]);
    setTodayCheckIn(null);
    setMessages([]);
    setPhysioConsults([]);

    if (!authReady || !user) {
      return;
    }

    const activeUid = user.uid;
    let unsubs: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      try {
        await ensureUserProfile(activeUid, user.displayName || 'Atleet');
        if (cancelled) return;
        unsubs = [
          subscribeProfile(activeUid, setProfile),
          subscribeGoals(activeUid, setGoals),
          subscribeActivities(activeUid, setActivities),
          subscribeCheckIn(activeUid, today, setTodayCheckIn),
          subscribeCheckInMessages(activeUid, today, setMessages),
          subscribePhysioConsults(activeUid, setPhysioConsults),
        ];
      } catch (err: any) {
        if (!cancelled) setAuthError(err?.message || 'Databaseverbinding mislukt.');
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user, today]);

  const scopedProfile = useMemo(
    () => (user && profile && profile.userId === user.uid ? profile : null),
    [user, profile]
  );
  const scopedGoals = useMemo(
    () => (user ? goals.filter((g) => g.userId === user.uid) : []),
    [user, goals]
  );
  const scopedActivities = useMemo(
    () => (user ? activities.filter((a) => a.userId === user.uid) : []),
    [user, activities]
  );
  const scopedTodayCheckIn = useMemo(
    () => (user && todayCheckIn && todayCheckIn.userId === user.uid ? todayCheckIn : null),
    [user, todayCheckIn]
  );
  const scopedMessages = useMemo(
    () => (user ? messages.filter((m) => m.userId === user.uid) : []),
    [user, messages]
  );
  const scopedPhysioConsults = useMemo(
    () => (user ? physioConsults.filter((c) => c.userId === user.uid) : []),
    [user, physioConsults]
  );

  useEffect(() => {
    if (scopedProfile && !initialRouted) {
      if (!scopedProfile.intakeCompleted) {
        setActiveTab('physio');
      }
      setInitialRouted(true);
    }
  }, [scopedProfile, initialRouted]);

  const loadMetrics = useMemo(
    () => computeLoadMetrics(scopedActivities, today),
    [scopedActivities, today]
  );

  const handleLogin = async () => {
    setAuthError(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setAuthError(err?.message || 'Inloggen met Google is niet gelukt.');
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] text-slate-600 text-sm">
        Gegevens laden...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#070B12] text-white flex flex-col lg:flex-row">
        {/* Left Athletic Hero Column */}
        <div className="relative lg:w-7/12 min-h-[340px] lg:min-h-screen overflow-hidden bg-gradient-to-br from-[#0B1220] via-[#0F172A] to-[#064E3B] flex flex-col justify-between p-8 lg:p-14">
          <img
            src="/src/assets/images/futuristic_running_track_hero_1794642293160.jpg"
            alt="Atletische hardloopbaan met moderne baanverlichting"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070B12] via-[#070B12]/55 to-[#070B12]/35" />

          <div className="relative z-10">
            <span className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap">
              Run Coach
            </span>
          </div>

          <div className="relative z-10 max-w-xl space-y-5 pt-16 lg:pt-0">
            <p className="text-xs font-mono tracking-wider uppercase text-emerald-400">
              Adaptieve Hardloopbegeleiding · AI Sportfysiotherapie
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white text-balance leading-[1.1]">
              Train slimmer voor jouw volgende doel.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-lg">
              Dynamische dagschema&apos;s die meebewegen met jouw agenda, belastbaarheid en herstel — ondersteund door
              een persoonlijke AI-sportfysiotherapeut en hardloopcoach.
            </p>
            <div className="grid grid-cols-3 gap-6 pt-4 border-t border-white/15 text-xs text-slate-300">
              <div>
                <p className="font-semibold text-white">Fysio Intake</p>
                <p className="mt-0.5 text-slate-400">Conditie, klachten &amp; plan</p>
              </div>
              <div>
                <p className="font-semibold text-white">Dagelijkse Check-in</p>
                <p className="mt-0.5 text-slate-400">Adaptief per trainingsdag</p>
              </div>
              <div>
                <p className="font-semibold text-white">ACWR Bewaking</p>
                <p className="mt-0.5 text-slate-400">Blessurepreventie op maat</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Login Panel */}
        <div className="lg:w-5/12 flex items-center justify-center p-8 lg:p-14 bg-[#0B101B] border-t lg:border-t-0 lg:border-l border-white/10">
          <div className="w-full max-w-sm space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                Start jouw training
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Log in om direct met je AI-fysiotherapeut je intake te starten en je persoonlijke trainingsschema op te
                bouwen.
              </p>
            </div>

            {authError && (
              <p className="text-xs text-red-300 bg-red-950/60 border border-red-800/60 rounded-lg p-3">{authError}</p>
            )}

            <button
              type="button"
              onClick={handleLogin}
              className="w-full py-3 px-5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              Inloggen met Google
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-xs text-slate-500 leading-relaxed">
              Jouw trainingshistorie, doelen en fysio-dossier worden strikt gescheiden opgeslagen in je eigen profiel.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentNav = NAV_ITEMS.find((n) => n.key === activeTab)!;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-[256px] lg:shrink-0 bg-white border-r border-slate-200 flex-col justify-between p-5">
        <div className="space-y-8">
          <div className="px-2 pt-1">
            <span className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap block">
              Run Coach
            </span>
          </div>

          <nav className="space-y-1" aria-label="Hoofdnavigatie">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors text-left whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white font-medium'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="px-2">
            <p className="text-xs font-medium text-slate-900 truncate">{scopedProfile?.displayName || user.displayName || 'Atleet'}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logoutUser}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Uitloggen
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: 3 clean zones */}
        <header className="bg-white border-b border-slate-200 px-5 lg:px-8 py-3.5 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Menu openen"
              className="lg:hidden p-2 -ml-2 text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="lg:hidden font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Run Coach
            </span>
            <span className="hidden lg:inline text-sm font-medium text-slate-500 whitespace-nowrap shrink-0">
              Workspace / <span className="text-slate-900">{currentNav.label}</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('today')}
              className={`hover:text-slate-900 whitespace-nowrap shrink-0 ${activeTab === 'today' ? 'text-slate-900 font-medium underline underline-offset-4' : ''}`}
            >
              Vandaag
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('physio')}
              className={`hover:text-slate-900 whitespace-nowrap shrink-0 ${activeTab === 'physio' ? 'text-slate-900 font-medium underline underline-offset-4' : ''}`}
            >
              Fysio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('goals')}
              className={`hover:text-slate-900 whitespace-nowrap shrink-0 ${activeTab === 'goals' ? 'text-slate-900 font-medium underline underline-offset-4' : ''}`}
            >
              Doelen
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('load')}
              className={`hover:text-slate-900 whitespace-nowrap shrink-0 ${activeTab === 'load' ? 'text-slate-900 font-medium underline underline-offset-4' : ''}`}
            >
              Belasting
            </button>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('physio')}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Fysio Advies
            </button>
          </div>
        </header>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.key);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left ${
                    activeTab === item.key ? 'bg-slate-900 text-white font-medium' : 'text-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={logoutUser}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-600"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Uitloggen
            </button>
          </div>
        )}

        {/* Viewport Container keyed by user.uid to guarantee zero cross-account state leakage */}
        <main key={user.uid} className="flex-1 p-5 lg:p-8 max-w-[1200px] w-full mx-auto">
          {authError && (
            <div className="mb-5 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">
              {authError}
            </div>
          )}

          {activeTab === 'today' && (
            <TodayCoachView
              uid={user.uid}
              profile={scopedProfile}
              goals={scopedGoals}
              activities={scopedActivities}
              loadMetrics={loadMetrics}
              todayCheckIn={scopedTodayCheckIn}
              messages={scopedMessages}
              onNavigate={(t) => setActiveTab(t)}
            />
          )}

          {activeTab === 'physio' && (
            <PhysioDorienView
              uid={user.uid}
              profile={scopedProfile}
              goals={scopedGoals}
              activities={scopedActivities}
              loadMetrics={loadMetrics}
              consults={scopedPhysioConsults}
              onNavigate={(t) => setActiveTab(t)}
            />
          )}

          {activeTab === 'goals' && <GoalsView uid={user.uid} profile={scopedProfile} goals={scopedGoals} />}

          {activeTab === 'import' && (
            <DataImportView uid={user.uid} profile={scopedProfile} goals={scopedGoals} activities={scopedActivities} />
          )}

          {activeTab === 'load' && (
            <LoadPhysioView
              loadMetrics={loadMetrics}
              profile={scopedProfile}
              onNavigateToToday={() => setActiveTab('today')}
            />
          )}

          {activeTab === 'log' && (
            <ActivityLogView
              uid={user.uid}
              activities={scopedActivities}
              onNavigateToImport={() => setActiveTab('import')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
