import type { ActivityType, LoadMetrics, TrainingActivity } from '../types';

export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeDateStr(input: string): string {
  if (!input) return todayIsoDate();
  const isoMatch = input.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return todayIsoDate();
}

export function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0 || !Number.isFinite(secPerKm)) return '—';
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  if (secs === 60) {
    return `${mins + 1}:00 /km`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')} /km`;
}

export function formatDurationSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '—';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.round(totalSeconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function calculateTrainingLoad(params: {
  durationMinutes: number;
  activityType: ActivityType;
  avgHr?: number;
  maxHr?: number;
  restingHr?: number;
  rpe?: number;
  inclinePct?: number;
  bootcampFocus?: string;
}): number {
  const duration = Math.max(1, params.durationMinutes || 0);
  const maxHr = params.maxHr || 188;
  const restingHr = params.restingHr || 52;
  const avgHr = params.avgHr || 0;

  let load = 0;
  if (avgHr > restingHr && maxHr > restingHr) {
    const hrr = Math.max(0.1, Math.min(1.0, (avgHr - restingHr) / (maxHr - restingHr)));
    const trimp = duration * hrr * 0.64 * Math.exp(1.92 * hrr);
    load = trimp;
  } else {
    const rpe = Math.max(1, Math.min(10, params.rpe || 5));
    load = duration * (rpe / 5.5) * 1.15;
  }

  if (params.activityType === 'bootcamp') {
    const legMultiplier = params.bootcampFocus === 'legs_plyo' ? 1.25 : 1.12;
    load *= legMultiplier;
  } else if (params.activityType === 'run_treadmill' && (params.inclinePct || 0) > 1.5) {
    load *= 1 + Math.min(0.25, (params.inclinePct || 0) * 0.02);
  } else if (params.activityType === 'core_physio') {
    load *= 0.65;
  }

  return Math.round(Math.max(5, Math.min(1500, load)));
}

export function computeHeartRateZones(maxHr: number, restingHr: number) {
  const hrr = Math.max(60, maxHr - restingHr);
  const zone = (low: number, high: number) => ({
    min: Math.round(restingHr + hrr * low),
    max: Math.round(restingHr + hrr * high),
  });
  return [
    { name: 'Z1 Herstel', desc: 'Zeer licht, actief herstel', ...zone(0.5, 0.6) },
    { name: 'Z2 Duurloop', desc: 'Aerobe basis, praattempo', ...zone(0.6, 0.72) },
    { name: 'Z3 Tempo', desc: 'Gematigd stevig, marathon/10EM-ritme', ...zone(0.72, 0.82) },
    { name: 'Z4 Drempel', desc: 'Lactaatdrempel, 10 km wedstrijdtempo', ...zone(0.82, 0.9) },
    { name: 'Z5 VO2max', desc: 'Korte intervallen & pieksnelheid', ...zone(0.9, 1.0) },
  ];
}

export function computeLoadMetrics(activities: TrainingActivity[], refDateStr = todayIsoDate()): LoadMetrics {
  const refDate = new Date(`${refDateStr}T12:00:00`);
  const dayMs = 86400000;

  const seriesMap = new Map<
    string,
    { date: string; label: string; runLoad: number; bootcampLoad: number; coreLoad: number; totalLoad: number; runKm: number }
  >();

  for (let i = 27; i >= 0; i--) {
    const d = new Date(refDate.getTime() - i * dayMs);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    seriesMap.set(iso, { date: iso, label, runLoad: 0, bootcampLoad: 0, coreLoad: 0, totalLoad: 0, runKm: 0 });
  }

  let acuteLoad7d = 0;
  let total28dLoad = 0;
  let weeklyRunKm = 0;
  let weeklyBootcampMin = 0;
  let weeklyCoreMin = 0;
  let daysSinceLastRun: number | null = null;
  let daysSinceLastBootcamp: number | null = null;

  for (const act of activities) {
    const actDay = normalizeDateStr(act.date);
    const actDateObj = new Date(`${actDay}T12:00:00`);
    const diffDays = Math.floor((refDate.getTime() - actDateObj.getTime()) / dayMs);

    if (diffDays < 0) continue;

    if (act.activityType === 'run_outdoor' || act.activityType === 'run_treadmill') {
      if (daysSinceLastRun === null || diffDays < daysSinceLastRun) {
        daysSinceLastRun = diffDays;
      }
    }
    if (act.activityType === 'bootcamp') {
      if (daysSinceLastBootcamp === null || diffDays < daysSinceLastBootcamp) {
        daysSinceLastBootcamp = diffDays;
      }
    }

    if (diffDays <= 6) {
      acuteLoad7d += act.trainingLoad;
      if (act.activityType === 'run_outdoor' || act.activityType === 'run_treadmill') {
        weeklyRunKm += act.distanceKm || 0;
      } else if (act.activityType === 'bootcamp') {
        weeklyBootcampMin += act.durationMinutes || 0;
      } else if (act.activityType === 'core_physio') {
        weeklyCoreMin += act.durationMinutes || 0;
      }
    }

    if (diffDays <= 27) {
      total28dLoad += act.trainingLoad;
      const bucket = seriesMap.get(actDay);
      if (bucket) {
        if (act.activityType === 'bootcamp') {
          bucket.bootcampLoad += act.trainingLoad;
        } else if (act.activityType === 'core_physio') {
          bucket.coreLoad += act.trainingLoad;
        } else {
          bucket.runLoad += act.trainingLoad;
          bucket.runKm += act.distanceKm || 0;
        }
        bucket.totalLoad += act.trainingLoad;
      }
    }
  }

  const chronicLoad28d = Math.round(total28dLoad / 4);
  const acwr = chronicLoad28d > 20 ? Number((acuteLoad7d / chronicLoad28d).toFixed(2)) : acuteLoad7d > 0 ? 1.0 : 0;

  let riskStatus: LoadMetrics['riskStatus'] = 'optimal';
  if (chronicLoad28d === 0 && acuteLoad7d === 0) {
    riskStatus = 'underloaded';
  } else if (acwr >= 1.45) {
    riskStatus = 'high';
  } else if (acwr >= 1.3 || (acwr > 0 && acwr < 0.75)) {
    riskStatus = 'caution';
  }

  return {
    acuteLoad7d: Math.round(acuteLoad7d),
    chronicLoad28d,
    acwr,
    weeklyRunKm: Number(weeklyRunKm.toFixed(1)),
    weeklyBootcampMin: Math.round(weeklyBootcampMin),
    weeklyCoreMin: Math.round(weeklyCoreMin),
    daysSinceLastRun,
    daysSinceLastBootcamp,
    riskStatus,
    dailySeries: Array.from(seriesMap.values()),
  };
}
