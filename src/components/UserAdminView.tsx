import React, { useMemo, useState } from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  CreditCard,
  MailPlus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import type { UserAccessRecord } from '../types';
import {
  addThreeMonthsIso,
  evaluateUserAccess,
  isSuperAdminEmail,
  removeUserAccessByAdmin,
  SUPERADMIN_EMAIL,
  upsertUserAccessByAdmin,
} from '../lib/store';
import { todayIsoDate } from '../lib/trainingMath';

interface UserAdminViewProps {
  records: UserAccessRecord[];
}

type FilterMode = 'all' | 'trial' | 'paid' | 'expired_or_revoked';

export function UserAdminView({ records }: UserAdminViewProps) {
  const today = todayIsoDate();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [trialStartDate, setTrialStartDate] = useState(today);
  const [trialEndsAt, setTrialEndsAt] = useState(() => addThreeMonthsIso(today));
  const [hasPaidSubscription, setHasPaidSubscription] = useState(false);
  const [paidUntil, setPaidUntil] = useState('');
  const [notes, setNotes] = useState('Eerste 3 maanden gratis toegang');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const handleStartDateChange = (newStart: string) => {
    setTrialStartDate(newStart);
    if (newStart) {
      setTrialEndsAt(addThreeMonthsIso(newStart));
    }
  };

  const handleAddOrUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await upsertUserAccessByAdmin({
        email,
        displayName: displayName.trim() || email.trim().split('@')[0] || 'Atleet',
        accessStatus: 'active',
        hasPaidSubscription,
        trialStartDate,
        trialEndsAt,
        paidUntil: hasPaidSubscription ? paidUntil : '',
        notes,
      });
      setFeedback({
        type: 'ok',
        text: `Toegang opgeslagen voor ${email.trim().toLowerCase()} (gratis proefperiode t/m ${trialEndsAt}).`,
      });
      setEmail('');
      setDisplayName('');
      setHasPaidSubscription(false);
      setPaidUntil('');
      setNotes('Eerste 3 maanden gratis toegang');
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Kon gebruiker niet opslaan.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePaid = async (rec: UserAccessRecord) => {
    setFeedback(null);
    const nextPaid = !rec.hasPaidSubscription;
    const defaultPaidUntil = nextPaid
      ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
      : '';
    try {
      await upsertUserAccessByAdmin({
        email: rec.email,
        displayName: rec.displayName,
        accessStatus: rec.accessStatus,
        hasPaidSubscription: nextPaid,
        trialStartDate: rec.trialStartDate,
        trialEndsAt: rec.trialEndsAt,
        paidUntil: nextPaid ? rec.paidUntil || defaultPaidUntil : '',
        notes: rec.notes,
      });
      setFeedback({
        type: 'ok',
        text: `${rec.email}: betaald abonnement ${nextPaid ? 'geactiveerd' : 'uitgezet'}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Wijziging mislukt.' });
    }
  };

  const handleExtendTrial3Months = async (rec: UserAccessRecord) => {
    setFeedback(null);
    const baseDate = rec.trialEndsAt > today ? rec.trialEndsAt : today;
    const newTrialEnd = addThreeMonthsIso(baseDate);
    try {
      await upsertUserAccessByAdmin({
        email: rec.email,
        displayName: rec.displayName,
        accessStatus: 'active',
        hasPaidSubscription: rec.hasPaidSubscription,
        trialStartDate: rec.trialStartDate || today,
        trialEndsAt: newTrialEnd,
        paidUntil: rec.paidUntil,
        notes: rec.notes,
      });
      setFeedback({
        type: 'ok',
        text: `Gratis proefperiode voor ${rec.email} verlengd met 3 maanden t/m ${newTrialEnd}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Verlengen mislukt.' });
    }
  };

  const handleToggleAccessStatus = async (rec: UserAccessRecord) => {
    if (isSuperAdminEmail(rec.email)) return;
    setFeedback(null);
    const nextStatus = rec.accessStatus === 'active' ? 'revoked' : 'active';
    try {
      await upsertUserAccessByAdmin({
        email: rec.email,
        displayName: rec.displayName,
        accessStatus: nextStatus,
        hasPaidSubscription: rec.hasPaidSubscription,
        trialStartDate: rec.trialStartDate,
        trialEndsAt: rec.trialEndsAt,
        paidUntil: rec.paidUntil,
        notes: rec.notes,
      });
      setFeedback({
        type: 'ok',
        text: `Toegang voor ${rec.email} is nu ${nextStatus === 'active' ? 'actief' : 'ingetrokken'}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Status wijzigen mislukt.' });
    }
  };

  const handleDeleteUser = async (rec: UserAccessRecord) => {
    if (isSuperAdminEmail(rec.email)) return;
    setFeedback(null);
    try {
      await removeUserAccessByAdmin(rec.id, rec.email);
      setFeedback({
        type: 'ok',
        text: `${rec.email} is verwijderd uit de toegangslijst.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Verwijderen mislukt.' });
    }
  };

  const enrichedRecords = useMemo(() => {
    return records.map((rec) => ({
      rec,
      evalResult: evaluateUserAccess(rec.email, rec, today),
    }));
  }, [records, today]);

  const counts = useMemo(() => {
    let trial = 0;
    let paid = 0;
    let expiredOrRevoked = 0;
    for (const item of enrichedRecords) {
      if (item.evalResult.state === 'allowed_trial') trial++;
      else if (item.evalResult.state === 'allowed_paid' || item.evalResult.state === 'allowed_superadmin') paid++;
      else expiredOrRevoked++;
    }
    return {
      total: enrichedRecords.length,
      trial,
      paid,
      expiredOrRevoked,
    };
  }, [enrichedRecords]);

  const filteredRecords = useMemo(() => {
    return enrichedRecords.filter(({ rec, evalResult }) => {
      const q = searchQuery.trim().toLowerCase();
      if (q && !rec.email.toLowerCase().includes(q) && !rec.displayName.toLowerCase().includes(q)) {
        return false;
      }
      if (filterMode === 'trial') return evalResult.state === 'allowed_trial';
      if (filterMode === 'paid') {
        return evalResult.state === 'allowed_paid' || evalResult.state === 'allowed_superadmin';
      }
      if (filterMode === 'expired_or_revoked') return !evalResult.allowed;
      return true;
    });
  }, [enrichedRecords, searchQuery, filterMode]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <p className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            Super User Beheer · {SUPERADMIN_EMAIL}
          </p>
          <h2 className="text-2xl font-semibold text-slate-900">
            Gebruikersbeheer &amp; Abonnementen
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Geef atleten toegang op basis van hun e-mailadres. Nieuwe gebruikers krijgen standaard de{' '}
            <strong className="font-semibold text-slate-900">eerste 3 maanden gratis</strong>. Daarna is een actief
            betaald abonnement vereist om toegang te behouden.
          </p>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Totaal Gebruikers</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{counts.total}</p>
          <p className="text-xs text-slate-500 mt-1">Op e-mailadres geautoriseerd</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Gratis Proefperiode (3 mnd)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">{counts.trial}</p>
          <p className="text-xs text-slate-500 mt-1">Binnen eerste 3 maanden</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Betaald / Super User</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{counts.paid}</p>
          <p className="text-xs text-slate-500 mt-1">Actief abonnement</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Verlopen / Geblokkeerd</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">{counts.expiredOrRevoked}</p>
          <p className="text-xs text-slate-500 mt-1">Betaling vereist na proefperiode</p>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl p-4 text-sm border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Main Grid: Add/Authorize User Form + User Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Authorize Email Form */}
        <form
          onSubmit={handleAddOrUpdateUser}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <MailPlus className="w-4 h-4 text-emerald-700" />
              Geef toegang op e-mailadres
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Voeg een nieuwe gebruiker toe of werk een bestaand e-mailadres bij.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              E-mailadres (Google-account van gebruiker)
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="bijv. loper@gmail.com"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Naam / Omschrijving</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Bijv. Jan Jansen"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start proefperiode</label>
              <input
                type="date"
                required
                value={trialStartDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gratis t/m (3 mnd)</label>
              <input
                type="date"
                required
                value={trialEndsAt}
                onChange={(e) => setTrialEndsAt(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={hasPaidSubscription}
                onChange={(e) => setHasPaidSubscription(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Heeft betaald abonnement afgesloten
            </label>

            {hasPaidSubscription && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Abonnement betaald t/m (optioneel)
                </label>
                <input
                  type="date"
                  value={paidUntil}
                  onChange={(e) => setPaidUntil(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notitie</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Bijv. Eerste 3 maanden gratis"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={saving || !email.trim()}
            className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {saving ? 'Opslaan...' : 'Toegang toekennen / opslaan'}
          </button>
        </form>

        {/* Right: Authorized Users List */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Geautoriseerde E-mailadressen ({filteredRecords.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Beheer proefperiodes (3 maanden gratis), abonnementsbetalingen en directe toegang.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Zoek e-mail of naam..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">Alle gebruikers</option>
                <option value="trial">3 mnd gratis proef</option>
                <option value="paid">Betaald / Super User</option>
                <option value="expired_or_revoked">Verlopen / Geblokkeerd</option>
              </select>
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              Geen gebruikers gevonden voor deze selectie.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredRecords.map(({ rec, evalResult }) => {
                const isSuper = isSuperAdminEmail(rec.email);
                return (
                  <div
                    key={rec.id}
                    className="py-4 first:pt-1 last:pb-1 flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {rec.displayName}
                        </span>
                        <span className="text-xs font-mono text-slate-600 truncate">
                          ({rec.email})
                        </span>
                        {isSuper && (
                          <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                            Super User (Altijd toegang)
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                        <span>
                          Proefperiode: {rec.trialStartDate} t/m {rec.trialEndsAt}
                        </span>
                        {rec.paidUntil && <span>· Betaald t/m: {rec.paidUntil}</span>}
                        {rec.lastLoginAt && (
                          <span>· Laatste login: {rec.lastLoginAt.slice(0, 10)}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {evalResult.state === 'allowed_superadmin' && (
                          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Onbeperkte Super User toegang
                          </span>
                        )}
                        {evalResult.state === 'allowed_paid' && (
                          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Toegang actief · Betaald abonnement
                          </span>
                        )}
                        {evalResult.state === 'allowed_trial' && (
                          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Toegang actief · Eerste 3 mnd gratis (nog{' '}
                            {evalResult.trialDaysRemaining} dagen)
                          </span>
                        )}
                        {evalResult.state === 'denied_trial_expired' && (
                          <span className="text-xs font-semibold text-amber-800">
                            3 maanden gratis verlopen — wacht op betaling abonnement
                          </span>
                        )}
                        {evalResult.state === 'denied_revoked' && (
                          <span className="text-xs font-semibold text-red-700">
                            Toegang geblokkeerd door beheerder
                          </span>
                        )}
                        {rec.notes && (
                          <span className="text-xs text-slate-500">· {rec.notes}</span>
                        )}
                      </div>
                    </div>

                    {!isSuper && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePaid(rec)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                            rec.hasPaidSubscription
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          {rec.hasPaidSubscription ? 'Betaald ✓' : 'Markeer als betaald'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleExtendTrial3Months(rec)}
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" />
                          +3 mnd gratis
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleAccessStatus(rec)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 whitespace-nowrap ${
                            rec.accessStatus === 'active'
                              ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                          }`}
                        >
                          {rec.accessStatus === 'active' ? (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              Blokkeer
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Activeer
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteUser(rec)}
                          aria-label={`Verwijder ${rec.email}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
