import Papa from 'papaparse';
import { unzipSync, strFromU8 } from 'fflate';
import FitParser from 'fit-file-parser';
import type { ActivitySource, ActivityType, TrainingActivity } from '../types';
import { calculateTrainingLoad, normalizeDateStr } from './trainingMath';

export interface ParsedImportResult {
  activities: Array<Omit<TrainingActivity, 'id' | 'userId' | 'createdAt'>>;
  totalParsedCount: number;
  stravaStats?: {
    totalActivities: number;
    totalRuns: number;
    totalRunKm: number;
    avgWeeklyRunKmRecent12w: number;
    longestRunKm: number;
    avgRunPaceSecPerKm: number;
    avgRunHr: number;
    totalElevationM: number;
    dateRange: { earliest: string; latest: string };
    otherActivitiesCount: number;
  };
}

function parseNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val !== 'string') return 0;
  const cleaned = val.replace(',', '.').replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function getField(row: Record<string, string>, candidates: string[]): string {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
    const found = Object.keys(row).find((k) => k.toLowerCase().trim() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return '';
}

function parseStravaDate(raw: string): string {
  if (!raw) return normalizeDateStr('');
  // Handle Dutch/English Strava export strings like "12 nov. 2025 18:14:22" or "Nov 12, 2025, 6:14:22 PM" or ISO
  const nlMonths: Record<string, string> = {
    jan: '01', feb: '02', mrt: '03', mar: '03', apr: '04', mei: '05', may: '05',
    jun: '06', jul: '07', aug: '08', sep: '09', okt: '10', oct: '10', nov: '11', dec: '12',
  };
  const nlMatch = raw.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})/);
  if (nlMatch) {
    const day = nlMatch[1].padStart(2, '0');
    const month = nlMonths[nlMatch[2]] || '01';
    const year = nlMatch[3];
    return `${year}-${month}-${day}`;
  }
  return normalizeDateStr(raw);
}

function mapStravaType(rawType: string, title: string): ActivityType {
  const t = `${rawType} ${title}`.toLowerCase();
  if (t.includes('treadmill') || t.includes('loopband')) return 'run_treadmill';
  if (t.includes('run') || t.includes('hardloop') || t.includes('trail')) return 'run_outdoor';
  if (t.includes('bootcamp') || t.includes('hiit') || t.includes('crossfit') || t.includes('workout')) return 'bootcamp';
  if (t.includes('core') || t.includes('yoga') || t.includes('pilates') || t.includes('stretch')) return 'core_physio';
  return 'cross_train';
}

export async function parseStravaUpload(
  file: File,
  maxHr: number,
  restingHr: number
): Promise<ParsedImportResult> {
  let csvText = '';
  if (file.name.toLowerCase().endsWith('.zip')) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const unzipped = unzipSync(buffer);
    const csvKey = Object.keys(unzipped).find((k) => k.toLowerCase().endsWith('activities.csv'));
    if (!csvKey) {
      throw new Error('Geen activities.csv gevonden in het Strava ZIP-bestand.');
    }
    csvText = strFromU8(unzipped[csvKey]);
  } else {
    csvText = await file.text();
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) {
    throw new Error('Het Strava CSV-bestand bevat geen activiteiten.');
  }

  const allActivities: Array<Omit<TrainingActivity, 'id' | 'userId' | 'createdAt'>> = [];
  let totalRuns = 0;
  let totalRunKm = 0;
  let longestRunKm = 0;
  let totalElevationM = 0;
  let paceSum = 0;
  let paceCount = 0;
  let hrSum = 0;
  let hrCount = 0;
  let otherCount = 0;
  let earliest = '9999-12-31';
  let latest = '0000-01-01';

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rawDate = getField(row, ['Activity Date', 'Activiteitsdatum', 'Date', 'Datum']);
    const title = getField(row, ['Activity Name', 'Activiteitsnaam', 'Name', 'Naam']) || 'Strava training';
    const rawType = getField(row, ['Activity Type', 'Activiteitstype', 'Type']);
    const extId = getField(row, ['Activity ID', 'Activiteits-ID', 'ID']) || `strava-${i}-${rawDate}`;

    const movingSec = parseNumber(getField(row, ['Moving Time', 'Beweegtijd', 'Elapsed Time', 'Verstreken tijd']));
    const durationMinutes = Math.max(1, Math.round((movingSec > 300 ? movingSec / 60 : movingSec) || 30));

    let distanceVal = parseNumber(getField(row, ['Distance', 'Afstand']));
    // Strava activities.csv stores Distance in km if < 300 or meters if > 300 (some exports use meters, some km)
    const rawTypeLower = rawType.toLowerCase();
    if (distanceVal > 250 || (rawTypeLower.includes('run') && distanceVal > 120)) {
      distanceVal = distanceVal / 1000;
    }
    const distanceKm = Number(Math.max(0, Math.min(300, distanceVal)).toFixed(2));

    const avgHr = Math.round(parseNumber(getField(row, ['Average Heart Rate', 'Gemiddelde hartslag', 'Avg HR'])));
    const rowMaxHr = Math.round(parseNumber(getField(row, ['Max Heart Rate', 'Maximale hartslag', 'Max HR'])));
    const elevationGainM = Math.round(parseNumber(getField(row, ['Elevation Gain', 'Hoogteverschil', 'Totale stijging'])));
    const relativeEffort = parseNumber(getField(row, ['Relative Effort', 'Ervaren inspanning', 'Perceived Exertion']));

    const activityType = mapStravaType(rawType, title);
    const date = parseStravaDate(rawDate);
    if (date < earliest) earliest = date;
    if (date > latest) latest = date;

    const avgPaceSecPerKm =
      (activityType === 'run_outdoor' || activityType === 'run_treadmill') && distanceKm > 0.2
        ? Math.round((durationMinutes * 60) / distanceKm)
        : 0;

    const rpe = relativeEffort > 0 ? Math.min(10, Math.max(1, Math.round(relativeEffort / 15))) : 5;
    const trainingLoad = calculateTrainingLoad({
      durationMinutes,
      activityType,
      avgHr,
      maxHr,
      restingHr,
      rpe,
    });

    if (activityType === 'run_outdoor' || activityType === 'run_treadmill') {
      totalRuns++;
      totalRunKm += distanceKm;
      if (distanceKm > longestRunKm) longestRunKm = distanceKm;
      if (avgPaceSecPerKm > 150 && avgPaceSecPerKm < 700) {
        paceSum += avgPaceSecPerKm;
        paceCount++;
      }
      if (avgHr > 80) {
        hrSum += avgHr;
        hrCount++;
      }
      totalElevationM += elevationGainM;
    } else {
      otherCount++;
    }

    allActivities.push({
      source: 'strava',
      activityType,
      title: title.slice(0, 175),
      date,
      durationMinutes,
      distanceKm,
      avgPaceSecPerKm,
      avgHr: Math.min(230, avgHr),
      maxHr: Math.min(240, rowMaxHr),
      elevationGainM: Math.min(10000, elevationGainM),
      inclinePct: 0,
      rpe,
      trainingLoad,
      bootcampFocus: activityType === 'bootcamp' ? 'full_body' : '',
      sorenessNote: '',
      externalId: String(extId).slice(0, 120),
    });
  }

  // Sort newest first
  allActivities.sort((a, b) => b.date.localeCompare(a.date));

  // Recent 12-week average weekly km
  const nowMs = Date.now();
  const twelveWeeksAgoMs = nowMs - 84 * 86400000;
  const recent12wKm = allActivities
    .filter((a) => (a.activityType === 'run_outdoor' || a.activityType === 'run_treadmill') && new Date(a.date).getTime() >= twelveWeeksAgoMs)
    .reduce((acc, a) => acc + a.distanceKm, 0);

  return {
    activities: allActivities,
    totalParsedCount: allActivities.length,
    stravaStats: {
      totalActivities: allActivities.length,
      totalRuns,
      totalRunKm: Number(totalRunKm.toFixed(1)),
      avgWeeklyRunKmRecent12w: Number((recent12wKm / 12).toFixed(1)),
      longestRunKm: Number(longestRunKm.toFixed(1)),
      avgRunPaceSecPerKm: paceCount > 0 ? Math.round(paceSum / paceCount) : 0,
      avgRunHr: hrCount > 0 ? Math.round(hrSum / hrCount) : 0,
      totalElevationM,
      dateRange: { earliest, latest },
      otherActivitiesCount: otherCount,
    },
  };
}

export async function parseGarminFile(
  file: File,
  maxHr: number,
  restingHr: number
): Promise<Array<Omit<TrainingActivity, 'id' | 'userId' | 'createdAt'>>> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.fit')) {
    const buffer = await file.arrayBuffer();
    const fitParser = new FitParser({
      force: true,
      speedUnit: 'km/h',
      lengthUnit: 'km',
      elapsedRecordField: true,
      mode: 'cascade',
    });

    const data: any = await new Promise((resolve, reject) => {
      fitParser.parse(buffer, (err: any, parsedData: any) => {
        if (err) reject(new Error(`Kon FIT-bestand niet lezen: ${err}`));
        else resolve(parsedData);
      });
    });

    const session = data?.activity?.sessions?.[0] || data?.sessions?.[0] || {};
    const sport = String(session.sport || 'running').toLowerCase();
    const subSport = String(session.sub_sport || '').toLowerCase();
    const isTreadmill = subSport.includes('treadmill') || sport.includes('treadmill');
    const isRun = sport.includes('run');

    const activityType: ActivityType = isTreadmill
      ? 'run_treadmill'
      : isRun
        ? 'run_outdoor'
        : sport.includes('training') || sport.includes('fitness')
          ? 'bootcamp'
          : 'cross_train';

    const durationMinutes = Math.max(1, Math.round((session.total_timer_time || session.total_elapsed_time || 1800) / 60));
    const distanceKm = Number((session.total_distance || 0).toFixed(2));
    const avgHr = Math.round(session.avg_heart_rate || 0);
    const sessionMaxHr = Math.round(session.max_heart_rate || 0);
    const elevationGainM = Math.round(session.total_ascent || 0);
    const startTime = session.start_time || data?.activity?.timestamp || new Date().toISOString();
    const date = normalizeDateStr(String(startTime));
    const avgPaceSecPerKm = isRun && distanceKm > 0.2 ? Math.round((durationMinutes * 60) / distanceKm) : 0;

    return [
      {
        source: 'garmin' as ActivitySource,
        activityType,
        title: file.name.replace(/\.fit$/i, '').slice(0, 175) || 'Garmin training',
        date,
        durationMinutes,
        distanceKm,
        avgPaceSecPerKm,
        avgHr,
        maxHr: sessionMaxHr,
        elevationGainM,
        inclinePct: 0,
        rpe: 6,
        trainingLoad: calculateTrainingLoad({
          durationMinutes,
          activityType,
          avgHr,
          maxHr,
          restingHr,
          rpe: 6,
        }),
        bootcampFocus: '',
        sorenessNote: '',
        externalId: `garmin-fit-${date}-${durationMinutes}-${distanceKm}`,
      },
    ];
  }

  if (lower.endsWith('.tcx')) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const activities = Array.from(doc.querySelectorAll('Activity'));
    if (activities.length === 0) throw new Error('Geen activiteiten gevonden in TCX-bestand.');

    return activities.map((act, idx) => {
      const sport = (act.getAttribute('Sport') || 'Running').toLowerCase();
      const idText = act.querySelector('Id')?.textContent || new Date().toISOString();
      const date = normalizeDateStr(idText);
      const laps = Array.from(act.querySelectorAll('Lap'));

      let totalTimeSec = 0;
      let totalDistM = 0;
      let hrSum = 0;
      let hrCount = 0;
      let maxHrFound = 0;

      laps.forEach((lap) => {
        totalTimeSec += parseNumber(lap.querySelector('TotalTimeSeconds')?.textContent);
        totalDistM += parseNumber(lap.querySelector('DistanceMeters')?.textContent);
        const lapAvgHr = parseNumber(lap.querySelector('AverageHeartRateBpm > Value')?.textContent);
        const lapMaxHr = parseNumber(lap.querySelector('MaximumHeartRateBpm > Value')?.textContent);
        if (lapAvgHr > 0) {
          hrSum += lapAvgHr;
          hrCount++;
        }
        if (lapMaxHr > maxHrFound) maxHrFound = lapMaxHr;
      });

      const durationMinutes = Math.max(1, Math.round(totalTimeSec / 60));
      const distanceKm = Number((totalDistM / 1000).toFixed(2));
      const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
      const isRun = sport.includes('run');
      const activityType: ActivityType = isRun ? 'run_outdoor' : 'cross_train';
      const avgPaceSecPerKm = isRun && distanceKm > 0.2 ? Math.round((durationMinutes * 60) / distanceKm) : 0;

      return {
        source: 'garmin',
        activityType,
        title: `${file.name.replace(/\.tcx$/i, '')}${activities.length > 1 ? ` #${idx + 1}` : ''}`.slice(0, 175),
        date,
        durationMinutes,
        distanceKm,
        avgPaceSecPerKm,
        avgHr,
        maxHr: Math.round(maxHrFound),
        elevationGainM: 0,
        inclinePct: 0,
        rpe: 6,
        trainingLoad: calculateTrainingLoad({ durationMinutes, activityType, avgHr, maxHr, restingHr, rpe: 6 }),
        bootcampFocus: '',
        sorenessNote: '',
        externalId: `garmin-tcx-${idText}-${idx}`,
      };
    });
  }

  if (lower.endsWith('.gpx')) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const trkpts = Array.from(doc.querySelectorAll('trkpt'));
    if (trkpts.length < 2) throw new Error('Te weinig GPS-punten in GPX-bestand.');

    const name = doc.querySelector('trk > name')?.textContent || file.name.replace(/\.gpx$/i, '');
    const firstTime = trkpts[0].querySelector('time')?.textContent || '';
    const lastTime = trkpts[trkpts.length - 1].querySelector('time')?.textContent || '';
    const date = normalizeDateStr(firstTime);

    let distKm = 0;
    let eleGain = 0;
    let prevLat = parseNumber(trkpts[0].getAttribute('lat'));
    let prevLon = parseNumber(trkpts[0].getAttribute('lon'));
    let prevEle = parseNumber(trkpts[0].querySelector('ele')?.textContent);

    for (let i = 1; i < trkpts.length; i++) {
      const lat = parseNumber(trkpts[i].getAttribute('lat'));
      const lon = parseNumber(trkpts[i].getAttribute('lon'));
      const ele = parseNumber(trkpts[i].querySelector('ele')?.textContent);
      // Haversine
      const R = 6371;
      const dLat = ((lat - prevLat) * Math.PI) / 180;
      const dLon = ((lon - prevLon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((prevLat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      distKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (ele > prevEle) eleGain += ele - prevEle;
      prevLat = lat;
      prevLon = lon;
      prevEle = ele;
    }

    const durationMinutes =
      firstTime && lastTime
        ? Math.max(1, Math.round((new Date(lastTime).getTime() - new Date(firstTime).getTime()) / 60000))
        : Math.max(10, Math.round(distKm * 6));
    const roundedDist = Number(distKm.toFixed(2));
    const avgPaceSecPerKm = roundedDist > 0.2 ? Math.round((durationMinutes * 60) / roundedDist) : 0;

    return [
      {
        source: 'garmin',
        activityType: 'run_outdoor',
        title: name.slice(0, 175),
        date,
        durationMinutes,
        distanceKm: roundedDist,
        avgPaceSecPerKm,
        avgHr: 0,
        maxHr: 0,
        elevationGainM: Math.round(eleGain),
        inclinePct: 0,
        rpe: 6,
        trainingLoad: calculateTrainingLoad({
          durationMinutes,
          activityType: 'run_outdoor',
          maxHr,
          restingHr,
          rpe: 6,
        }),
        bootcampFocus: '',
        sorenessNote: '',
        externalId: `garmin-gpx-${date}-${roundedDist}-${durationMinutes}`,
      },
    ];
  }

  if (lower.endsWith('.csv')) {
    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
    if (!parsed.data || parsed.data.length === 0) throw new Error('Geen rijen gevonden in Garmin CSV.');

    return parsed.data.slice(0, 50).map((row, idx) => {
      const title = getField(row, ['Title', 'Titel', 'Activity Name', 'Activiteitstype']) || 'Garmin activiteit';
      const rawDate = getField(row, ['Date', 'Datum']);
      const date = normalizeDateStr(rawDate);
      const distanceKm = Number(parseNumber(getField(row, ['Distance', 'Afstand'])).toFixed(2));
      const timeStr = getField(row, ['Time', 'Tijd', 'Moving Time', 'Beweegtijd']);
      let durationMinutes = 35;
      if (timeStr.includes(':')) {
        const parts = timeStr.split(':').map((p) => parseNumber(p));
        if (parts.length === 3) durationMinutes = Math.max(1, Math.round(parts[0] * 60 + parts[1] + parts[2] / 60));
        else if (parts.length === 2) durationMinutes = Math.max(1, Math.round(parts[0] + parts[1] / 60));
      } else if (parseNumber(timeStr) > 0) {
        durationMinutes = Math.max(1, Math.round(parseNumber(timeStr)));
      }
      const avgHr = Math.round(parseNumber(getField(row, ['Avg HR', 'Gem. HS', 'Average Heart Rate'])));
      const rowMaxHr = Math.round(parseNumber(getField(row, ['Max HR', 'Max. HS', 'Max Heart Rate'])));
      const elev = Math.round(parseNumber(getField(row, ['Total Ascent', 'Totale stijging', 'Elevation Gain'])));
      const actType = mapStravaType(getField(row, ['Activity Type', 'Activiteitstype']), title);
      const avgPaceSecPerKm =
        (actType === 'run_outdoor' || actType === 'run_treadmill') && distanceKm > 0.2
          ? Math.round((durationMinutes * 60) / distanceKm)
          : 0;

      return {
        source: 'garmin',
        activityType: actType,
        title: title.slice(0, 175),
        date,
        durationMinutes,
        distanceKm,
        avgPaceSecPerKm,
        avgHr,
        maxHr: rowMaxHr,
        elevationGainM: elev,
        inclinePct: 0,
        rpe: 6,
        trainingLoad: calculateTrainingLoad({ durationMinutes, activityType: actType, avgHr, maxHr, restingHr, rpe: 6 }),
        bootcampFocus: actType === 'bootcamp' ? 'full_body' : '',
        sorenessNote: '',
        externalId: `garmin-csv-${date}-${idx}-${distanceKm}`,
      };
    });
  }

  throw new Error('Niet-ondersteund bestandsformaat. Gebruik .fit, .tcx, .gpx of .csv.');
}
