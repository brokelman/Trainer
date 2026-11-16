import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import type {
  AccessEvaluation,
  CoachMessage,
  DailyCheckIn,
  FitnessLevel,
  PhysioConsult,
  PhysioConsultKind,
  RunningGoal,
  TrainingActivity,
  UserAccessRecord,
  UserAccessStatus,
  UserProfile,
} from '../types';

export const SUPERADMIN_EMAIL = 'brokelman@gmail.com';

export function isSuperAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === SUPERADMIN_EMAIL);
}

export function emailToAccessId(email: string): string {
  const clean = email.trim().toLowerCase();
  const slug = clean
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/[^a-z0-9_-]/g, '_');
  return slug.slice(0, 120) || 'unknown_user';
}

export function addThreeMonthsIso(startIso: string): string {
  const base = startIso ? new Date(`${startIso.slice(0, 10)}T12:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date(Date.now() + 90 * 86400000);
    return fallback.toISOString().slice(0, 10);
  }
  base.setUTCMonth(base.getUTCMonth() + 3);
  return base.toISOString().slice(0, 10);
}

export function evaluateUserAccess(
  email: string | null | undefined,
  record: UserAccessRecord | null,
  todayIso: string
): AccessEvaluation {
  if (isSuperAdminEmail(email)) {
    return {
      allowed: true,
      state: 'allowed_superadmin',
      isSuperAdmin: true,
      trialDaysRemaining: 9999,
      record,
    };
  }

  if (!record) {
    return {
      allowed: false,
      state: 'denied_not_invited',
      isSuperAdmin: false,
      trialDaysRemaining: 0,
      record: null,
    };
  }

  if (record.accessStatus === 'revoked') {
    return {
      allowed: false,
      state: 'denied_revoked',
      isSuperAdmin: false,
      trialDaysRemaining: 0,
      record,
    };
  }

  const todayMs = new Date(`${todayIso.slice(0, 10)}T00:00:00Z`).getTime();
  const trialEndMs = new Date(`${(record.trialEndsAt || todayIso).slice(0, 10)}T23:59:59Z`).getTime();
  const trialDaysRemaining = Math.max(0, Math.ceil((trialEndMs - todayMs) / 86400000));

  const paidValid =
    record.hasPaidSubscription &&
    (!record.paidUntil || record.paidUntil.slice(0, 10) >= todayIso.slice(0, 10));

  if (paidValid) {
    return {
      allowed: true,
      state: 'allowed_paid',
      isSuperAdmin: false,
      trialDaysRemaining,
      record,
    };
  }

  if (record.trialEndsAt.slice(0, 10) >= todayIso.slice(0, 10)) {
    return {
      allowed: true,
      state: 'allowed_trial',
      isSuperAdmin: false,
      trialDaysRemaining,
      record,
    };
  }

  return {
    allowed: false,
    state: 'denied_trial_expired',
    isSuperAdmin: false,
    trialDaysRemaining: 0,
    record,
  };
}

function assertActiveUser(uid: string): void {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Toegang geweigerd: gebruikerssessie komt niet overeen met de opgevraagde data.');
  }
}

export async function ensureUserProfile(uid: string, displayName: string): Promise<void> {
  assertActiveUser(uid);
  const ref = doc(db, 'users', uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: uid,
        displayName: (displayName || 'Atleet').slice(0, 120),
        maxHr: 188,
        restingHr: 52,
        treadmillMaxSpeedKmh: 20,
        treadmillMaxInclinePct: 15,
        sensitiveAreas: '',
        stravaBaselineSummary: '',
        stravaImportedCount: 0,
        stravaLastImportedAt: '',
        intakeCompleted: false,
        fitnessLevel: 'recreational',
        currentWeeklyKm: 0,
        currentComplaints: '',
        complaintSeverity: 0,
        physioPlanSummary: '',
        referralRecommended: false,
        referralReason: '',
        lastPhysioCheckinAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.intakeCompleted === undefined) {
      await updateDoc(ref, {
        intakeCompleted: false,
        fitnessLevel: 'recreational',
        currentWeeklyKm: 0,
        currentComplaints: '',
        complaintSeverity: 0,
        physioPlanSummary: '',
        referralRecommended: false,
        referralReason: '',
        lastPhysioCheckinAt: '',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}

export async function updateUserPhysiology(
  uid: string,
  payload: Pick<
    UserProfile,
    'displayName' | 'maxHr' | 'restingHr' | 'treadmillMaxSpeedKmh' | 'treadmillMaxInclinePct' | 'sensitiveAreas'
  >
): Promise<void> {
  assertActiveUser(uid);
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      displayName: (payload.displayName || 'Atleet').slice(0, 120),
      maxHr: Math.max(120, Math.min(220, Number(payload.maxHr) || 188)),
      restingHr: Math.max(30, Math.min(110, Number(payload.restingHr) || 52)),
      treadmillMaxSpeedKmh: Math.max(8, Math.min(25, Number(payload.treadmillMaxSpeedKmh) || 20)),
      treadmillMaxInclinePct: Math.max(0, Math.min(30, Number(payload.treadmillMaxInclinePct) || 15)),
      sensitiveAreas: (payload.sensitiveAreas || '').slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function updateUserStravaBaseline(
  uid: string,
  summary: string,
  importedCount: number
): Promise<void> {
  assertActiveUser(uid);
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      stravaBaselineSummary: (summary || '').slice(0, 4000),
      stravaImportedCount: Math.max(0, Math.min(50000, importedCount)),
      stravaLastImportedAt: new Date().toISOString().slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export function subscribeProfile(uid: string, onData: (profile: UserProfile | null) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (auth.currentUser?.uid !== uid) {
        onData(null);
        return;
      }
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as UserProfile;
      onData(data.userId === uid ? data : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeGoals(uid: string, onData: (goals: RunningGoal[]) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}/goals`;
  const q = query(collection(db, 'users', uid, 'goals'), orderBy('raceDate', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      if (auth.currentUser?.uid !== uid) {
        onData([]);
        return;
      }
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RunningGoal, 'id'>) }))
          .filter((g) => g.userId === uid)
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeActivities(uid: string, onData: (activities: TrainingActivity[]) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}/activities`;
  const q = query(collection(db, 'users', uid, 'activities'), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      if (auth.currentUser?.uid !== uid) {
        onData([]);
        return;
      }
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<TrainingActivity, 'id'>) }))
          .filter((a) => a.userId === uid)
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeCheckIn(uid: string, date: string, onData: (checkin: DailyCheckIn | null) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}/checkins/${date}`;
  return onSnapshot(
    doc(db, 'users', uid, 'checkins', date),
    (snap) => {
      if (auth.currentUser?.uid !== uid || !snap.exists()) {
        onData(null);
        return;
      }
      const data = { id: snap.id, ...(snap.data() as Omit<DailyCheckIn, 'id'>) };
      onData(data.userId === uid ? data : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeCheckInMessages(uid: string, date: string, onData: (messages: CoachMessage[]) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}/checkins/${date}/messages`;
  const q = query(collection(db, 'users', uid, 'checkins', date, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      if (auth.currentUser?.uid !== uid) {
        onData([]);
        return;
      }
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CoachMessage, 'id'>) }))
          .filter((m) => m.userId === uid)
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createGoal(
  uid: string,
  goal: Omit<RunningGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/goals`;
  try {
    await ensureUserProfile(uid, 'Atleet');
    await addDoc(collection(db, 'users', uid, 'goals'), {
      userId: uid,
      title: goal.title.slice(0, 140),
      location: (goal.location || '').slice(0, 120),
      distanceKm: Math.max(0.5, Math.min(250, Number(goal.distanceKm))),
      raceDate: goal.raceDate.slice(0, 20),
      targetTimeSeconds: Math.max(60, Math.min(86400, Math.round(goal.targetTimeSeconds))),
      priority: goal.priority,
      status: goal.status || 'active',
      notes: (goal.notes || '').slice(0, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateGoalStatus(uid: string, goalId: string, status: RunningGoal['status']): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/goals/${goalId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'goals', goalId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeGoal(uid: string, goalId: string): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/goals/${goalId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'goals', goalId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function addActivitiesBatch(
  uid: string,
  items: Array<Omit<TrainingActivity, 'id' | 'userId' | 'createdAt'>>,
  existingExternalIds: Set<string>
): Promise<number> {
  assertActiveUser(uid);
  const path = `users/${uid}/activities`;
  try {
    await ensureUserProfile(uid, 'Atleet');
    const unique = items.filter((item) => !item.externalId || !existingExternalIds.has(item.externalId));
    const toWrite = unique.slice(0, 120);
    if (toWrite.length === 0) return 0;

    for (let i = 0; i < toWrite.length; i += 40) {
      const chunk = toWrite.slice(i, i + 40);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(collection(db, 'users', uid, 'activities'));
        batch.set(ref, {
          userId: uid,
          source: item.source,
          activityType: item.activityType,
          title: (item.title || 'Training').slice(0, 180),
          date: item.date.slice(0, 40),
          durationMinutes: Math.max(1, Math.min(1440, Math.round(item.durationMinutes))),
          distanceKm: Math.max(0, Math.min(300, Number(item.distanceKm) || 0)),
          avgPaceSecPerKm: Math.max(0, Math.min(1800, Math.round(item.avgPaceSecPerKm || 0))),
          avgHr: Math.max(0, Math.min(230, Math.round(item.avgHr || 0))),
          maxHr: Math.max(0, Math.min(240, Math.round(item.maxHr || 0))),
          elevationGainM: Math.max(0, Math.min(10000, Math.round(item.elevationGainM || 0))),
          inclinePct: Math.max(0, Math.min(30, Number(item.inclinePct) || 0)),
          rpe: Math.max(1, Math.min(10, Math.round(item.rpe || 5))),
          trainingLoad: Math.max(0, Math.min(2000, Math.round(item.trainingLoad || 0))),
          bootcampFocus: (item.bootcampFocus || '').slice(0, 60),
          sorenessNote: (item.sorenessNote || '').slice(0, 500),
          externalId: (item.externalId || '').slice(0, 128),
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return toWrite.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removeActivity(uid: string, activityId: string): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/activities/${activityId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'activities', activityId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function saveDailyCheckIn(
  uid: string,
  date: string,
  data: Omit<DailyCheckIn, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  alreadyExists: boolean
): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/checkins/${date}`;
  try {
    await ensureUserProfile(uid, 'Atleet');
    const isIndoor = data.environment === 'indoor_treadmill' || data.environment === 'indoor_core';
    const safeMinutes = !data.wantsToTrain
      ? 0
      : isIndoor
        ? Math.min(60, Math.max(10, Math.round(data.availableMinutes)))
        : Math.min(300, Math.max(10, Math.round(data.availableMinutes)));

    const payload = {
      wantsToTrain: Boolean(data.wantsToTrain),
      environment: data.environment,
      availableMinutes: safeMinutes,
      energyLevel: Math.max(1, Math.min(5, Math.round(data.energyLevel))),
      muscleSoreness: Math.max(1, Math.min(5, Math.round(data.muscleSoreness))),
      painArea: (data.painArea || '').slice(0, 140),
      painSeverity: Math.max(0, Math.min(10, Math.round(data.painSeverity))),
      notes: (data.notes || '').slice(0, 600),
      coachPlanTitle: (data.coachPlanTitle || '').slice(0, 180),
      coachPlanType: data.coachPlanType,
      coachReasoning: (data.coachReasoning || '').slice(0, 2500),
      physioAdvice: (data.physioAdvice || '').slice(0, 2000),
      workoutWarmup: (data.workoutWarmup || '').slice(0, 1500),
      workoutMain: (data.workoutMain || '').slice(0, 2500),
      workoutCooldown: (data.workoutCooldown || '').slice(0, 1500),
      treadmillSpeedKmh: (data.treadmillSpeedKmh || '').slice(0, 80),
      treadmillInclinePct: (data.treadmillInclinePct || '').slice(0, 80),
      targetHrZone: (data.targetHrZone || '').slice(0, 80),
      estimatedLoad: Math.max(0, Math.min(500, Math.round(data.estimatedLoad || 0))),
      updatedAt: serverTimestamp(),
    };

    const ref = doc(db, 'users', uid, 'checkins', date);
    if (alreadyExists) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, {
        ...payload,
        userId: uid,
        date: date.slice(0, 20),
        completed: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function markCheckInCompleted(uid: string, date: string): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/checkins/${date}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'checkins', date), {
      completed: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function addCoachMessage(uid: string, date: string, role: 'user' | 'coach', text: string): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/checkins/${date}/messages`;
  try {
    await addDoc(collection(db, 'users', uid, 'checkins', date, 'messages'), {
      userId: uid,
      role,
      text: text.slice(0, 3500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribePhysioConsults(uid: string, onData: (consults: PhysioConsult[]) => void) {
  assertActiveUser(uid);
  const path = `users/${uid}/physioConsults`;
  const q = query(collection(db, 'users', uid, 'physioConsults'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      if (auth.currentUser?.uid !== uid) {
        onData([]);
        return;
      }
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<PhysioConsult, 'id'>) }))
          .filter((c) => c.userId === uid)
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function savePhysioIntakeOrCheckin(
  uid: string,
  payload: {
    intakeCompleted: boolean;
    fitnessLevel: FitnessLevel;
    currentWeeklyKm: number;
    currentComplaints: string;
    complaintSeverity: number;
    sensitiveAreas: string;
    physioPlanSummary: string;
    referralRecommended: boolean;
    referralReason: string;
    lastPhysioCheckinAt: string;
  }
): Promise<void> {
  assertActiveUser(uid);
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      intakeCompleted: Boolean(payload.intakeCompleted),
      fitnessLevel: payload.fitnessLevel,
      currentWeeklyKm: Math.max(0, Math.min(300, Number(payload.currentWeeklyKm) || 0)),
      currentComplaints: (payload.currentComplaints || '').slice(0, 1000),
      complaintSeverity: Math.max(0, Math.min(10, Math.round(Number(payload.complaintSeverity) || 0))),
      sensitiveAreas: (payload.sensitiveAreas || '').slice(0, 500),
      physioPlanSummary: (payload.physioPlanSummary || '').slice(0, 4000),
      referralRecommended: Boolean(payload.referralRecommended),
      referralReason: (payload.referralReason || '').slice(0, 1000),
      lastPhysioCheckinAt: (payload.lastPhysioCheckinAt || '').slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function addPhysioConsult(
  uid: string,
  consult: {
    kind: PhysioConsultKind;
    date: string;
    complaintsSummary: string;
    painSeverity: number;
    userQuestion: string;
    physioResponse: string;
    planRecommendations: string;
    referralRecommended: boolean;
    referralReason: string;
  }
): Promise<void> {
  assertActiveUser(uid);
  const path = `users/${uid}/physioConsults`;
  try {
    await ensureUserProfile(uid, 'Atleet');
    await addDoc(collection(db, 'users', uid, 'physioConsults'), {
      userId: uid,
      kind: consult.kind,
      date: consult.date.slice(0, 20),
      complaintsSummary: (consult.complaintsSummary || '').slice(0, 1000),
      painSeverity: Math.max(0, Math.min(10, Math.round(Number(consult.painSeverity) || 0))),
      userQuestion: (consult.userQuestion || '').slice(0, 2000),
      physioResponse: (consult.physioResponse || 'Advies opgeslagen.').slice(0, 4000),
      planRecommendations: (consult.planRecommendations || '').slice(0, 3000),
      referralRecommended: Boolean(consult.referralRecommended),
      referralReason: (consult.referralReason || '').slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function ensureSuperAdminAccessRecord(email: string, displayName: string): Promise<void> {
  if (!isSuperAdminEmail(email)) return;
  const normalizedEmail = email.trim().toLowerCase();
  const accessId = emailToAccessId(normalizedEmail);
  const path = `userAccess/${accessId}`;
  const ref = doc(db, 'userAccess', accessId);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email: normalizedEmail,
        displayName: (displayName || 'Super Admin').slice(0, 120),
        role: 'superadmin',
        accessStatus: 'active',
        hasPaidSubscription: true,
        trialStartDate: today,
        trialEndsAt: '2099-12-31',
        paidUntil: '2099-12-31',
        notes: 'Super User account — altijd en overal toegang',
        lastLoginAt: new Date().toISOString().slice(0, 40),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        lastLoginAt: new Date().toISOString().slice(0, 40),
        displayName: (displayName || snap.data()?.displayName || 'Super Admin').slice(0, 120),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function recordMemberLoginIfAuthorized(email: string, displayName: string): Promise<void> {
  if (!email) return;
  const normalizedEmail = email.trim().toLowerCase();
  if (isSuperAdminEmail(normalizedEmail)) {
    await ensureSuperAdminAccessRecord(normalizedEmail, displayName);
    return;
  }
  const accessId = emailToAccessId(normalizedEmail);
  const path = `userAccess/${accessId}`;
  const ref = doc(db, 'userAccess', accessId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data()?.email === normalizedEmail) {
      await updateDoc(ref, {
        lastLoginAt: new Date().toISOString().slice(0, 40),
        displayName: (displayName || snap.data()?.displayName || 'Atleet').slice(0, 120),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeMyAccessRecord(
  email: string,
  onData: (record: UserAccessRecord | null) => void
) {
  const normalizedEmail = email.trim().toLowerCase();
  const accessId = emailToAccessId(normalizedEmail);
  const path = `userAccess/${accessId}`;
  return onSnapshot(
    doc(db, 'userAccess', accessId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = { id: snap.id, ...(snap.data() as Omit<UserAccessRecord, 'id'>) };
      onData(data.email === normalizedEmail ? data : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export function subscribeAllUserAccessRecords(
  onData: (records: UserAccessRecord[]) => void
) {
  const path = 'userAccess';
  const q = query(collection(db, 'userAccess'), orderBy('email', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      if (!isSuperAdminEmail(auth.currentUser?.email)) {
        onData([]);
        return;
      }
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserAccessRecord, 'id'>) })));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function upsertUserAccessByAdmin(payload: {
  email: string;
  displayName: string;
  accessStatus: UserAccessStatus;
  hasPaidSubscription: boolean;
  trialStartDate: string;
  trialEndsAt: string;
  paidUntil: string;
  notes: string;
}): Promise<void> {
  if (!isSuperAdminEmail(auth.currentUser?.email)) {
    throw new Error('Alleen de Super User (brokelman@gmail.com) kan gebruikerstoegang beheren.');
  }
  const normalizedEmail = payload.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@') || normalizedEmail.length < 3) {
    throw new Error('Voer een geldig e-mailadres in.');
  }
  const accessId = emailToAccessId(normalizedEmail);
  const path = `userAccess/${accessId}`;
  const ref = doc(db, 'userAccess', accessId);
  const role = isSuperAdminEmail(normalizedEmail) ? 'superadmin' : 'member';
  const safeStart = (payload.trialStartDate || new Date().toISOString().slice(0, 10)).slice(0, 20);
  const safeEnd = (payload.trialEndsAt || addThreeMonthsIso(safeStart)).slice(0, 20);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        displayName: (payload.displayName || existingSnap.data()?.displayName || normalizedEmail.split('@')[0]).slice(0, 120),
        role,
        accessStatus: isSuperAdminEmail(normalizedEmail) ? 'active' : payload.accessStatus,
        hasPaidSubscription: isSuperAdminEmail(normalizedEmail) ? true : Boolean(payload.hasPaidSubscription),
        trialStartDate: safeStart,
        trialEndsAt: safeEnd,
        paidUntil: (payload.paidUntil || '').slice(0, 20),
        notes: (payload.notes || '').slice(0, 500),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        email: normalizedEmail.slice(0, 160),
        displayName: (payload.displayName || normalizedEmail.split('@')[0] || 'Atleet').slice(0, 120),
        role,
        accessStatus: isSuperAdminEmail(normalizedEmail) ? 'active' : payload.accessStatus,
        hasPaidSubscription: isSuperAdminEmail(normalizedEmail) ? true : Boolean(payload.hasPaidSubscription),
        trialStartDate: safeStart,
        trialEndsAt: safeEnd,
        paidUntil: (payload.paidUntil || '').slice(0, 20),
        notes: (payload.notes || '').slice(0, 500),
        lastLoginAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removeUserAccessByAdmin(accessId: string, email: string): Promise<void> {
  if (!isSuperAdminEmail(auth.currentUser?.email)) {
    throw new Error('Alleen de Super User kan gebruikers verwijderen.');
  }
  if (isSuperAdminEmail(email)) {
    throw new Error('Het Super User account (brokelman@gmail.com) kan niet worden verwijderd.');
  }
  const path = `userAccess/${accessId}`;
  try {
    await deleteDoc(doc(db, 'userAccess', accessId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}


