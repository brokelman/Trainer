import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const app = express();
app.use(express.json({ limit: '2mb' }));

function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return '-';
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/km`;
}

function formatDurationSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '-';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.round(totalSeconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const FIREBASE_PROJECT_ID = 'gen-lang-client-0022152490';

function verifyAuthenticatedUser(req: express.Request, res: express.Response): string | null {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Niet ingelogd: geldig authenticatietoken ontbreekt.' });
    return null;
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    res.status(401).json({ error: 'Ongeldig authenticatietoken.' });
    return null;
  }

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload.aud !== FIREBASE_PROJECT_ID) {
      res.status(403).json({ error: 'Token hoort niet bij dit project.' });
      return null;
    }
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
      res.status(403).json({ error: 'Ongeldige token-uitgever.' });
      return null;
    }
    if (typeof payload.exp === 'number' && payload.exp < nowSec - 30) {
      res.status(401).json({ error: 'Sessie is verlopen. Log opnieuw in.' });
      return null;
    }

    const tokenUid: string = payload.user_id || payload.sub || '';
    if (!tokenUid) {
      res.status(401).json({ error: 'Geen gebruikers-ID gevonden in sessietoken.' });
      return null;
    }

    const headerUid = typeof req.headers['x-user-uid'] === 'string' ? req.headers['x-user-uid'] : '';
    const bodyUid = typeof req.body?.userId === 'string' ? req.body.userId : '';

    if ((headerUid && headerUid !== tokenUid) || (bodyUid && bodyUid !== tokenUid)) {
      res.status(403).json({ error: 'Toegang geweigerd: poging om gegevens van een andere gebruiker te raadplegen.' });
      return null;
    }

    if (req.body?.profile?.userId && req.body.profile.userId !== tokenUid) {
      res.status(403).json({ error: 'Toegang geweigerd: profieldata hoort bij een andere gebruiker.' });
      return null;
    }

    if (req.body?.checkin?.userId && req.body.checkin.userId !== tokenUid) {
      res.status(403).json({ error: 'Toegang geweigerd: check-in hoort bij een andere gebruiker.' });
      return null;
    }

    return tokenUid;
  } catch {
    res.status(401).json({ error: 'Kon sessietoken niet verifiëren.' });
    return null;
  }
}

function sanitizeUserScopedData(authUid: string, body: any) {
  const safeProfile =
    body?.profile && (!body.profile.userId || body.profile.userId === authUid) ? body.profile : null;

  const safeGoals = Array.isArray(body?.goals)
    ? body.goals.filter((g: any) => g && (!g.userId || g.userId === authUid))
    : [];

  const safeActivities = Array.isArray(body?.recentActivities)
    ? body.recentActivities.filter((a: any) => a && (!a.userId || a.userId === authUid))
    : [];

  const safeMessages = Array.isArray(body?.messages)
    ? body.messages.filter((m: any) => m && (!m.userId || m.userId === authUid))
    : [];

  return { safeProfile, safeGoals, safeActivities, safeMessages };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/coach/daily-plan', async (req, res) => {
  try {
    const authUid = verifyAuthenticatedUser(req, res);
    if (!authUid) return;

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is niet geconfigureerd op de server.' });
      return;
    }

    const { loadMetrics, checkin } = req.body ?? {};
    const { safeProfile: profile, safeGoals: goals, safeActivities: recentActivities } = sanitizeUserScopedData(
      authUid,
      req.body
    );

    if (!checkin) {
      res.status(400).json({ error: 'Check-in gegevens ontbreken.' });
      return;
    }

    const isIndoor = checkin.environment === 'indoor_treadmill' || checkin.environment === 'indoor_core';
    const cappedMinutes = !checkin.wantsToTrain
      ? 0
      : isIndoor
        ? Math.min(Number(checkin.availableMinutes) || 45, 60)
        : Math.min(Number(checkin.availableMinutes) || 60, 240);

    const activeGoalsText =
      goals.length > 0
        ? goals
            .filter((g: any) => g.status === 'active')
            .map((g: any) => {
              const paceSec = g.targetTimeSeconds / g.distanceKm;
              const daysLeft = Math.ceil(
                (new Date(g.raceDate).getTime() - new Date(checkin.date).getTime()) / 86400000
              );
              return `- [${g.priority}-doel] ${g.title}${g.location ? ` (${g.location})` : ''} | Afstand: ${g.distanceKm} km | Datum: ${g.raceDate} (nog ${daysLeft} dagen) | Streeftijd: ${formatDurationSeconds(g.targetTimeSeconds)} (streeftempo ${formatPace(paceSec)}) | Notities: ${g.notes || 'geen'}`;
            })
            .join('\n')
        : 'Geen actief hardloopdoel ingesteld. Werk aan algemene aerobe basis, kracht en blessurevrije opbouw.';

    const recentText =
      recentActivities.length > 0
        ? recentActivities
            .slice(0, 20)
            .map((a: any) => {
              return `- ${a.date} | ${a.source.toUpperCase()} | ${a.activityType} | "${a.title}" | ${a.durationMinutes} min | ${a.distanceKm} km | tempo ${formatPace(a.avgPaceSecPerKm)} | HR gem ${a.avgHr || '-'} / max ${a.maxHr || '-'} | helling ${a.inclinePct || 0}% / +${a.elevationGainM || 0}m | RPE ${a.rpe}/10 | load ${a.trainingLoad}${a.bootcampFocus ? ` | focus: ${a.bootcampFocus}` : ''}${a.sorenessNote ? ` | notitie: ${a.sorenessNote}` : ''}`;
            })
            .join('\n')
        : 'Nog geen recente activiteiten geregistreerd.';

    const systemInstruction = `Je bent een topniveau Nederlandse hardloopcoach én sportfysiotherapeut, werkend volgens de oorzaakgerichte sportfysiotherapie-aanpak van Dorien Janse Personal Fysio & Training (dorienjanse.nl): een combinatie van specifieke krachttraining/core stability, looptechniek en verantwoorde opbouw.

STRIKTE PRIVACY- & DATA-ISOLATIEREGEL:
- Je adviseert UITSLUITEND de huidig ingelogde atleet (gebruikers-ID: ${authUid}).
- Baseer je analyse en schema voor 100% op de profiel-, doel-, fysio- en trainingsgegevens van déze ingelogde gebruiker die in deze prompt staan. Verwijs nooit naar gegevens van andere personen en verzin geen externe trainingshistorie.

Jouw hoogste prioriteit:
1. Het veilig en realistisch behalen van het ingestelde hardloopdoel (afstand op datum in streeftijd) zónder vaste weekdagen af te dwingen — je past je elke dag dynamisch aan op wat vandaag mogelijk is.
2. Blessurepreventie en fysio-bewaking: kijk kritisch naar de Acute:Chronische Belastingsratio (ACWR), de impact van recente bootcamp-sessies (vooral benen/plyometrie veroorzaakt excentrische spierschade waardoor intensieve intervaltraining de dag erna vaak onverstandig is!), de spierpijn, energie, en specifieke pijntjes.
3. Strikte randvoorwaarden voor vandaag:
   - Als wantsToTrain == false of environment == 'rest': geef een herstel- of volledige rustdag ('rest_recovery') of zeer lichte 10-15 min mobiliteit/fysio als dat passend is.
   - Als environment == 'indoor_treadmill' of 'indoor_core': de totale duur mag NOOIT langer zijn dan ${cappedMinutes} minuten (en absoluut maximaal 60 minuten!).
   - Als environment == 'indoor_treadmill': geef concrete loopband-instellingen (snelheid in km/u en helling in % binnen de limiet van de loopband van de atleet: max ${profile?.treadmillMaxSpeedKmh ?? 20} km/u, max ${profile?.treadmillMaxInclinePct ?? 15}% helling). Vergeet niet dat 1.0% helling buitenweerstand benadert, en 2-6% helling perfect is voor kracht zonder overmatige impact!
   - Als environment == 'indoor_core': geef een doelgerichte thuisworkout voor core, buikspieren, heupstabiliteit en hardloop-fysio (geen apparatuur nodig, maximaal ${cappedMinutes} min).
   - Als pijnscore (painSeverity) >= 6 is: schrijf GEEN intensief hardlopen voor; schakel direct naar 'core_physio' of 'rest_recovery' met gerichte fysio-triage en adviseer eventueel een fysieke beoordeling via dorienjanse.nl.
   - Schrijf alle output in helder, deskundig, motiverend Nederlands, zonder vage algemeenheden. Geef exacte blokken, tijden, tempo's (min/km), snelheden (km/u), hellingspercentages en hartslagzones op basis van max HR (${profile?.maxHr ?? 188}) en rust-HR (${profile?.restingHr ?? 52}).`;

    const prompt = `ATLEETPROFIEL (Ingelogde gebruiker ${authUid}):
- Naam: ${profile?.displayName || 'Atleet'}
- Conditieniveau: ${profile?.fitnessLevel || 'recreational'} | Huidig weekvolume: ${profile?.currentWeeklyKm ?? 0} km/week
- Max hartslag: ${profile?.maxHr ?? 188} bpm | Rusthartslag: ${profile?.restingHr ?? 52} bpm
- Loopband limieten: max ${profile?.treadmillMaxSpeedKmh ?? 20} km/u, max ${profile?.treadmillMaxInclinePct ?? 15}% helling
- Gevoelige plekken / blessurehistorie: ${profile?.sensitiveAreas || 'Geen opgegeven'}
- Huidige fysio-klachten uit intake: ${profile?.currentComplaints || 'Geen'} (ernst ${profile?.complaintSeverity ?? 0}/10)
- Lopend Fysio-plan (Dorien Janse): ${profile?.physioPlanSummary || 'Nog geen intake afgerond'}
- Geleerde Strava-historie samenvatting van deze gebruiker:
${profile?.stravaBaselineSummary || 'Nog geen Strava-archief geüpload.'}

ACTIEVE HARDLOOPDOELEN VAN DEZE GEBRUIKER:
${activeGoalsText}

BELASTINGSANALYSE VAN DEZE GEBRUIKER (inclusief hardlopen + bootcamp):
- Acute belasting (laatste 7 dagen): ${loadMetrics?.acuteLoad7d ?? 0}
- Chronische belasting (28-daags weekgemiddelde): ${loadMetrics?.chronicLoad28d ?? 0}
- ACWR (Acute:Chronische ratio): ${loadMetrics?.acwr ?? 1.0} (ideaal: 0.80–1.30; >1.40 is verhoogd blessurerisico)
- Hardloopvolume laatste 7 dagen: ${loadMetrics?.weeklyRunKm ?? 0} km
- Bootcamp laatste 7 dagen: ${loadMetrics?.weeklyBootcampMin ?? 0} min
- Dagen sinds laatste looptraining: ${loadMetrics?.daysSinceLastRun ?? '-'}
- Dagen sinds laatste bootcamp: ${loadMetrics?.daysSinceLastBootcamp ?? '-'}

RECENTE ACTIVITEITEN VAN DEZE GEBRUIKER (meest recente eerst):
${recentText}

CHECK-IN VOOR VANDAAG (${checkin.date}):
- Wil/kan vandaag trainen: ${checkin.wantsToTrain ? 'JA' : 'NEE (rustdag)'}
- Omgeving: ${checkin.environment}
- Beschikbare tijd vandaag: ${cappedMinutes} minuten (strikte limiet!)
- Energiepeil (1-5): ${checkin.energyLevel}/5
- Spierpijn (1-5): ${checkin.muscleSoreness}/5
- Pijnlocatie: ${checkin.painArea || 'Geen'} (ernst: ${checkin.painSeverity}/10)
- Extra opmerking van atleet: ${checkin.notes || 'Geen'}

Stel nu de optimale training voor VANDAAG op voor uitsluitend deze ingelogde gebruiker.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            coachPlanTitle: { type: Type.STRING, description: 'Korte, duidelijke titel van de training voor vandaag.' },
            coachPlanType: {
              type: Type.STRING,
              enum: ['easy_run', 'tempo_run', 'intervals', 'long_run', 'treadmill_incline', 'core_physio', 'rest_recovery'],
            },
            coachReasoning: { type: Type.STRING, description: 'Onderbouwing waarom deze prikkel vandaag optimaal is gezien doel, historie, bootcamp en belasting.' },
            physioAdvice: { type: Type.STRING, description: 'Fysiotherapeutisch advies, spier/pees-bescherming, looptechniek of hersteltips.' },
            workoutWarmup: { type: Type.STRING, description: 'Concrete warming-up met duur/oefeningen.' },
            workoutMain: { type: Type.STRING, description: 'Exacte kern van de training (tempo, loopband km/u + helling %, of core sets & reps).' },
            workoutCooldown: { type: Type.STRING, description: 'Concrete cooling-down en rek/herstelroutine.' },
            treadmillSpeedKmh: { type: Type.STRING, description: 'Snelheidsrange op loopband (bijv. 10.2 - 11.8 km/u) of N.v.t.' },
            treadmillInclinePct: { type: Type.STRING, description: 'Hellingspercentage (bijv. 1.0% - 4.0%) of N.v.t.' },
            targetHrZone: { type: Type.STRING, description: 'Doel hartslagzone en bpm range (bijv. Zone 2 · 134–148 bpm).' },
            estimatedLoad: { type: Type.NUMBER, description: 'Geschatte training load score (0-350).' },
          },
          required: [
            'coachPlanTitle',
            'coachPlanType',
            'coachReasoning',
            'physioAdvice',
            'workoutWarmup',
            'workoutMain',
            'workoutCooldown',
            'treadmillSpeedKmh',
            'treadmillInclinePct',
            'targetHrZone',
            'estimatedLoad',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error generating daily plan:', err);
    res.status(500).json({ error: err?.message || 'Kon trainingsplan niet genereren.' });
  }
});

app.post('/api/coach/chat', async (req, res) => {
  try {
    const authUid = verifyAuthenticatedUser(req, res);
    if (!authUid) return;

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is niet geconfigureerd.' });
      return;
    }

    const { loadMetrics, checkin, userMessage } = req.body ?? {};
    const { safeProfile: profile, safeGoals: goals, safeMessages: messages } = sanitizeUserScopedData(authUid, req.body);

    if (!userMessage || typeof userMessage !== 'string') {
      res.status(400).json({ error: 'Bericht ontbreekt.' });
      return;
    }

    const historyText = messages
      .slice(-12)
      .map((m: any) => `${m.role === 'user' ? 'Atleet' : 'Coach/Fysio'}: ${m.text}`)
      .join('\n');

    const goalsSummary =
      goals
        .filter((g: any) => g.status === 'active')
        .map((g: any) => `${g.title} (${g.distanceKm}km op ${g.raceDate} in ${formatDurationSeconds(g.targetTimeSeconds)})`)
        .join('; ') || 'Geen';

    const systemInstruction = `Je bent de persoonlijke hardloopcoach én sportfysiotherapeut van uitsluitend deze ingelogde atleet (gebruikers-ID: ${authUid}).
Je geeft directe, praktische, medisch verantwoorde en motiverende antwoorden in het Nederlands op basis van alleen de gegevens van deze atleet.
Regels:
- Houd altijd rekening met de maximale binnentijd (nooit > 60 min binnen), loopbandhelling, recente bootcamp-belasting en eventuele pijntjes van deze gebruiker.
- Als de atleet een aanpassing vraagt (bijv. zwaarder, lichter, pijnklacht, andere loopbandhelling of extra core-oefeningen), geef direct een concreet aangepast blok terug.
- Blijf beknopt en helder gestructureerd.`;

    const prompt = `CONTEXT (Ingelogde gebruiker ${authUid}):
- Atleet: ${profile?.displayName || 'Atleet'}, Max HR ${profile?.maxHr ?? 188}, Rust HR ${profile?.restingHr ?? 52}, Gevoelige plekken: ${profile?.sensitiveAreas || 'geen'}
- Actieve doelen: ${goalsSummary}
- Belasting: ACWR ${loadMetrics?.acwr ?? '-'}, 7d hardlopen ${loadMetrics?.weeklyRunKm ?? 0} km, 7d bootcamp ${loadMetrics?.weeklyBootcampMin ?? 0} min
- Vandaag (${checkin?.date}): omgeving=${checkin?.environment}, tijd=${checkin?.availableMinutes} min, energie=${checkin?.energyLevel}/5, spierpijn=${checkin?.muscleSoreness}/5, pijn=${checkin?.painArea || 'geen'} (${checkin?.painSeverity ?? 0}/10)
- Huidig dagplan: ${checkin?.coachPlanTitle || 'Nog geen'}
  Warmup: ${checkin?.workoutWarmup || '-'}
  Kern: ${checkin?.workoutMain || '-'}
  Fysio-advies: ${checkin?.physioAdvice || '-'}

EERDERE BERICHTEN VAN DEZE GEBRUIKER:
${historyText || '(Nog geen eerdere berichten vandaag)'}

NIEUWE VRAAG VAN ATLEET:
${userMessage}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    res.json({ reply: (response.text ?? '').trim() });
  } catch (err: any) {
    console.error('Error in coach chat:', err);
    res.status(500).json({ error: err?.message || 'Kon coach-antwoord niet ophalen.' });
  }
});

app.post('/api/coach/analyze-strava', async (req, res) => {
  try {
    const authUid = verifyAuthenticatedUser(req, res);
    if (!authUid) return;

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is niet geconfigureerd.' });
      return;
    }

    const { stats } = req.body ?? {};
    const { safeGoals: goals } = sanitizeUserScopedData(authUid, req.body);

    if (!stats) {
      res.status(400).json({ error: 'Strava statistieken ontbreken.' });
      return;
    }

    const goalsSummary =
      goals.length > 0
        ? goals.map((g: any) => `${g.title}: ${g.distanceKm} km op ${g.raceDate}`).join(', ')
        : 'Algemene 10km / halve marathon opbouw';

    const prompt = `Analyseer deze eenmalig geüploade Strava-trainingshistorie van uitsluitend de ingelogde gebruiker (ID: ${authUid}) en schrijf een compacte, scherpe profielsamenvatting (maximaal 2200 tekens) in het Nederlands voor de coach & fysio van deze gebruiker.
Benoem:
1. Aerobe basis & gemiddeld weekvolume
2. Meest voorkomende looptempo's en duur
3. Hartslagprofiel (indien aanwezig) en hoogtemeters
4. Aandachtspunten voor opbouw en blessurepreventie richting doelen (${goalsSummary}).

STATISTIEKEN UIT STRAVA ARCHIEF VAN DEZE GEBRUIKER:
${JSON.stringify(stats, null, 2)}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    res.json({ summary: (response.text ?? '').trim().slice(0, 3800) });
  } catch (err: any) {
    console.error('Error analyzing Strava:', err);
    res.status(500).json({ error: err?.message || 'Kon Strava-analyse niet uitvoeren.' });
  }
});

const DORIEN_JANSE_SYSTEM = `Je bent AI-fysiotherapeut Dorien Janse van Dorien Janse Personal Fysio & Training (www.dorienjanse.nl).
Jouw werkwijze en uitgangspunten volgens dorienjanse.nl:
- Strikte individuele dossier-isolatie: je baseert je intake, maandelijkse check-in en consulten UITSLUITEND op de trainingshistorie, klachten en doelen van de ingelogde gebruiker in deze aanvraag. Je gebruikt nooit trainingsdata van een andere persoon.
- Oorzaakgericht en holistisch: behandel niet alleen symptomen, maar zoek de onderliggende oorzaak van disbalans, stijfheid of overbelasting.
- Gecombineerde aanpak: specifieke krachttraining / core stability + verbetering van looptechniek (eventueel via loopanalyse) + verantwoorde opbouw van hardlopen en running bootcamp.
- Ervaringsdeskundigheid: als bewegingswetenschapper, sportfysiotherapeut en zelf hardloper spreek je warm, helder, deskundig en realistisch Nederlands.
- Doorverwijzing naar de echte praktijk (dorienjanse.nl): adviseer altijd eerlijk en tijdig een fysieke afspraak/loopanalyse bij de echte praktijk van Dorien Janse (via het contactformulier op https://www.dorienjanse.nl, info@dorienjanse.nl, 06-14184448, Ruimtesonde 7, 3824 MZ Amersfoort) wanneer:
  * pijnscore >= 6/10 is,
  * klachten langer dan 2–3 weken aanhouden of verergeren tijdens het lopen,
  * er sprake is van scherpe peespijn (achillespees, kniepees, scheenbeen/shin splints), zwelling, nachtpijn of tintelingen/uitstraling.`;

app.post('/api/physio/intake-plan', async (req, res) => {
  try {
    const authUid = verifyAuthenticatedUser(req, res);
    if (!authUid) return;

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is niet geconfigureerd.' });
      return;
    }

    const { kind, intake, loadMetrics } = req.body ?? {};
    const { safeProfile: profile, safeGoals: goals, safeActivities: recentActivities } = sanitizeUserScopedData(
      authUid,
      req.body
    );

    const goalsText =
      goals.length > 0
        ? goals
            .filter((g: any) => g.status === 'active')
            .map((g: any) => `- ${g.title}: ${g.distanceKm} km op ${g.raceDate} (streeftijd ${formatDurationSeconds(g.targetTimeSeconds)})`)
            .join('\n')
        : 'Nog geen specifiek wedstrijddoel ingesteld.';

    const recentText =
      recentActivities.length > 0
        ? recentActivities
            .slice(0, 15)
            .map((a: any) => `- ${a.date}: ${a.activityType} "${a.title}" (${a.durationMinutes} min, ${a.distanceKm} km, load ${a.trainingLoad})`)
            .join('\n')
        : 'Nog geen recente activiteiten geüpload.';

    const prompt = `TYPE BEOORDELING: ${kind === 'monthly_checkin' ? 'MAANDELIJKSE FYSIO CHECK-IN' : 'EERSTE FYSIO INTAKE'}

GEGEVENS VAN DE INGELOGDE ATLEET (Gebruikers-ID: ${authUid}):
- Naam: ${profile?.displayName || 'Atleet'}
- Conditieniveau: ${intake?.fitnessLevel || profile?.fitnessLevel || 'recreational'}
- Huidig gemiddeld loopvolume: ${intake?.currentWeeklyKm ?? profile?.currentWeeklyKm ?? 0} km/week
- Huidige klachten / pijntjes: ${intake?.currentComplaints || 'Geen klachten gemeld'} (pijnscore: ${intake?.painSeverity ?? 0}/10)
- Gevoelige plekken / blessurehistorie: ${intake?.sensitiveAreas || profile?.sensitiveAreas || 'Geen'}
- Extra toelichting / vragen: ${intake?.notes || 'Geen'}

PERSOONLIJKE HISTORIE & BELASTING VAN DEZE GEBRUIKER:
- Strava-archief van deze gebruiker: ${profile?.stravaBaselineSummary || 'Nog niet geüpload'}
- ACWR ratio: ${loadMetrics?.acwr ?? 0} | 7d hardlopen: ${loadMetrics?.weeklyRunKm ?? 0} km | 7d bootcamp: ${loadMetrics?.weeklyBootcampMin ?? 0} min
- Recente sessies van deze gebruiker:
${recentText}

DOELEN VAN DEZE GEBRUIKER:
${goalsText}

Stel vanuit de rol van Dorien Janse (dorienjanse.nl) uitsluitend op basis van de gegevens van deze ingelogde gebruiker een persoonlijk welkom/beoordeling, een helder oorzaakgericht fysio- & opbouwplan en concrete aanbevelingen voor de komende 4 weken op. Bepaal ook of een fysieke doorverwijzing naar dorienjanse.nl nodig is.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction: `${DORIEN_JANSE_SYSTEM}\nActieve sessie-gebruiker: ${authUid}.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            physioResponse: {
              type: Type.STRING,
              description: 'Persoonlijke reactie en fysio-analyse door Dorien Janse op conditie, klachten, historie en doel.',
            },
            physioPlanSummary: {
              type: Type.STRING,
              description: 'Overkoepelend fysiotherapeutisch opbouw-, kracht/core- en looptechniekplan (gebruikt door dagelijkse coach).',
            },
            planRecommendations: {
              type: Type.STRING,
              description: 'Concrete actiepunten en oefeningen voor de komende 4 weken tot de volgende maandelijkse check-in.',
            },
            referralRecommended: {
              type: Type.BOOLEAN,
              description: 'True als fysiek onderzoek, behandeling of loopanalyse bij Dorien Janse (dorienjanse.nl) geadviseerd wordt.',
            },
            referralReason: {
              type: Type.STRING,
              description: 'Reden voor doorverwijzing en advies om contact op te nemen via het contactformulier op dorienjanse.nl (of lege string als niet nodig).',
            },
          },
          required: [
            'physioResponse',
            'physioPlanSummary',
            'planRecommendations',
            'referralRecommended',
            'referralReason',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error in physio intake-plan:', err);
    res.status(500).json({ error: err?.message || 'Kon fysio-intakeplan niet opstellen.' });
  }
});

app.post('/api/physio/consult', async (req, res) => {
  try {
    const authUid = verifyAuthenticatedUser(req, res);
    if (!authUid) return;

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is niet geconfigureerd.' });
      return;
    }

    const { loadMetrics, complaintsSummary, painSeverity, userQuestion } = req.body ?? {};
    const { safeProfile: profile, safeGoals: goals } = sanitizeUserScopedData(authUid, req.body);

    if (!userQuestion) {
      res.status(400).json({ error: 'Vraag ontbreekt.' });
      return;
    }

    const goalsSummary =
      goals
        .filter((g: any) => g.status === 'active')
        .map((g: any) => `${g.title} (${g.distanceKm}km op ${g.raceDate})`)
        .join('; ') || 'Geen';

    const prompt = `CONSULT AANVRAAG VAN INGELOGDE ATLEET (${profile?.displayName || 'Atleet'}, ID: ${authUid}):
- Conditieniveau: ${profile?.fitnessLevel || 'recreational'} | Weekvolume: ${profile?.currentWeeklyKm ?? 0} km
- Huidige fysio-plan van deze atleet: ${profile?.physioPlanSummary || 'Nog geen intake'}
- Gevoelige plekken: ${profile?.sensitiveAreas || 'Geen'}
- Actuele klachten bij dit consult: ${complaintsSummary || profile?.currentComplaints || 'Geen opgegeven'} (pijnscore ${painSeverity ?? 0}/10)
- ACWR belasting van deze atleet: ${loadMetrics?.acwr ?? 0} | 7d hardlopen: ${loadMetrics?.weeklyRunKm ?? 0} km | 7d bootcamp: ${loadMetrics?.weeklyBootcampMin ?? 0} min
- Actieve doelen van deze atleet: ${goalsSummary}

VRAAG VAN DE ATLEET:
${userQuestion}

Geef gericht, oorzaakgericht sportfysiotherapeutisch advies namens Dorien Janse (dorienjanse.nl) uitsluitend op basis van de gegevens van deze ingelogde gebruiker en bepaal of een fysieke doorverwijzing naar dorienjanse.nl verstandig is.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction: `${DORIEN_JANSE_SYSTEM}\nActieve sessie-gebruiker: ${authUid}.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            physioResponse: { type: Type.STRING },
            planRecommendations: { type: Type.STRING },
            referralRecommended: { type: Type.BOOLEAN },
            referralReason: { type: Type.STRING },
          },
          required: ['physioResponse', 'planRecommendations', 'referralRecommended', 'referralReason'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err: any) {
    console.error('Error in physio consult:', err);
    res.status(500).json({ error: err?.message || 'Kon fysio-consult niet uitvoeren.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Run Coach server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
