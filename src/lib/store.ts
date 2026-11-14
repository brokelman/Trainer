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
  CoachMessage,
  DailyCheckIn,
  FitnessLevel,
  PhysioConsult,
  PhysioConsultKind,
  RunningGoal,
  TrainingActivity,
  UserProfile,
} from '../types';

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

