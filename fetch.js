const fs = require('fs');

const API = 'https://transport.opendata.ch/v1';
const STATIONS = [
  { name: 'Klosbach', id: '8591231' },
  { name: 'Römerhof', id: '8591324' }
];

async function fetchLine33(stationId, stopName) {
  const r = await fetch(`${API}/stationboard?id=${stationId}&limit=50`);
  if (!r.ok) throw new Error(`HTTP Fehler ${r.status}`);
  const d = await r.json();
  const board = d.stationboard ?? [];
  const now = new Date();

  return board
    .filter(e => {
      const nr = String(e.number ?? '').trim();
      const ln = String(e.line ?? '').trim();
      return nr === '33' || ln === '33' || nr.includes('33') || ln.includes('33');
    })
    .map(e => {
      const stop = e.stop ?? {};
      const planned = stop.departure;
      if (!planned) return null;

      const plannedDt = new Date(planned);
      const progRaw = stop.prognosis?.departure;
      const actualDt = progRaw ? new Date(progRaw) : plannedDt;
      const delayMin = Math.round((actualDt - plannedDt) / 60000);

      return {
        key: `${stopName}_${planned}`,
        stop: stopName,
        planned: plannedDt.toISOString(),
        delay: delayMin,
        direction: e.to ?? '',
        category: e.category ?? '',
        departed: actualDt <= now,
      };
    })
    .filter(Boolean)
    .filter(p => p.departed);
}

async function main() {
  const dataPath = './data.json';
  let existingData = [];

  if (fs.existsSync(dataPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (e) {
      existingData = [];
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  existingData = existingData.filter(p => p.planned.startsWith(todayStr));

  for (const station of STATIONS) {
    try {
      console.log(`Lade Daten für ${station.name}...`);
      const fresh = await fetchLine33(station.id, station.name);
      
      const keys = new Set(existingData.map(p => p.key));
      const uniqueFresh = fresh.filter(p => !keys.has(p.key));
      
      existingData = [...existingData, ...uniqueFresh];
    } catch (e) {
      console.error(`Fehler bei Station ${station.name}:`, e.message);
    }
  }

  fs.writeFileSync(dataPath, JSON.stringify(existingData, null, 2), 'utf8');
  console.log(`Erfolgreich! Datenpunkte heute gesamt: ${existingData.length}`);
}

main();
