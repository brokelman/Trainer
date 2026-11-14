export type FitnessLevel = 'beginner' | 'recreational' | 'intermediate' | 'advanced';

export interface UserProfile {
  userId: string;
  displayName: string;
  maxHr: number;
  restingHr: number;
  treadmillMaxSpeedKmh: number;
  treadmillMaxInclinePct: number;
  sensitiveAreas: string;
  stravaBaselineSummary: string;
  stravaImportedCount: number;
  stravaLastImportedAt: string;
  intakeCompleted: boolean;
  fitnessLevel: FitnessLevel;
  currentWeeklyKm: number;
  currentComplaints: string;
  complaintSeverity: number;
  physioPlanSummary: string;
  referralRecommended: boolean;
  referralReason: string;
  lastPhysioCheckinAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PhysioConsultKind = 'intake' | 'monthly_checkin' | 'ondemand_consult';

export interface PhysioConsult {
  id: string;
  userId: string;
  kind: PhysioConsultKind;
  date: string;
  complaintsSummary: string;
  painSeverity: number;
  userQuestion: string;
  physioResponse: string;
  planRecommendations: string;
  referralRecommended: boolean;
  referralReason: string;
  createdAt?: unknown;
}

export type GoalPriority = 'A' | 'B';
export type GoalStatus = 'active' | 'completed' | 'archived';

export interface RunningGoal {
  id: string;
  userId: string;
  title: string;
  location: string;
  distanceKm: number;
  raceDate: string;
  targetTimeSeconds: number;
  priority: GoalPriority;
  status: GoalStatus;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ActivitySource = 'strava' | 'garmin' | 'bootcamp' | 'manual' | 'coach';
export type ActivityType = 'run_outdoor' | 'run_treadmill' | 'bootcamp' | 'core_physio' | 'cross_train';

export interface TrainingActivity {
  id: string;
  userId: string;
  source: ActivitySource;
  activityType: ActivityType;
  title: string;
  date: string;
  durationMinutes: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  avgHr: number;
  maxHr: number;
  elevationGainM: number;
  inclinePct: number;
  rpe: number;
  trainingLoad: number;
  bootcampFocus: string;
  sorenessNote: string;
  externalId: string;
  createdAt?: unknown;
}

export type CheckInEnvironment = 'outdoor' | 'indoor_treadmill' | 'indoor_core' | 'rest';
export type CoachPlanType =
  | 'easy_run'
  | 'tempo_run'
  | 'intervals'
  | 'long_run'
  | 'treadmill_incline'
  | 'core_physio'
  | 'rest_recovery';

export interface DailyCheckIn {
  id: string;
  userId: string;
  date: string;
  wantsToTrain: boolean;
  environment: CheckInEnvironment;
  availableMinutes: number;
  energyLevel: number;
  muscleSoreness: number;
  painArea: string;
  painSeverity: number;
  notes: string;
  coachPlanTitle: string;
  coachPlanType: CoachPlanType;
  coachReasoning: string;
  physioAdvice: string;
  workoutWarmup: string;
  workoutMain: string;
  workoutCooldown: string;
  treadmillSpeedKmh: string;
  treadmillInclinePct: string;
  targetHrZone: string;
  estimatedLoad: number;
  completed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CoachMessage {
  id: string;
  userId: string;
  role: 'user' | 'coach';
  text: string;
  createdAt?: unknown;
}

export interface LoadMetrics {
  acuteLoad7d: number;
  chronicLoad28d: number;
  acwr: number;
  weeklyRunKm: number;
  weeklyBootcampMin: number;
  weeklyCoreMin: number;
  daysSinceLastRun: number | null;
  daysSinceLastBootcamp: number | null;
  riskStatus: 'optimal' | 'caution' | 'high' | 'underloaded';
  dailySeries: Array<{
    date: string;
    label: string;
    runLoad: number;
    bootcampLoad: number;
    coreLoad: number;
    totalLoad: number;
    runKm: number;
  }>;
}
