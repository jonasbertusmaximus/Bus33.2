const fs = require('fs');
const path = require('path');

const API = 'https://transport.opendata.ch/v1';
const DATA_FILE = 'bus_data.json';

const STATIONS = [
  { name: 'Klosbach', id: '8591231' },
  { name: 'Römerhof', id: '8591324' }
];

// Lade existierende Daten
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Fehler beim Laden:', e.message);
  }
  return [];
}

// Speichere Daten
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ ${data.length} Datenpunkte gespeichert`);
}

// Hole Bus 33 Daten
async function fetchLine33(stationId, stopName) {
  try {
    const response = await fetch(`${API}/stationboard?id=${stationId}&limit=50`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const board = data.stationboard ?? [];
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
          fetchedAt: new Date().toISOString()
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error(`✗ Fehler bei ${stopName}:`, e.message);
    return [];
  }
}

// Haupt-Funktion
async function main() {
  console.log(`🚌 Bus 33 Datensammler - ${new Date().toLocaleString('de-CH')}`);
  
  let allData = loadData();
  const today = new Date().toISOString().slice(0, 10);
  
  // Nur Daten von heute behalten
  allData = allData.filter(p => p.planned.startsWith(today));
  
  console.log(`📊 Existierende Datenpunkte heute: ${allData.length}`);

  // Sammle neue Daten von beiden Stationen
  const keys = new Set(allData.map(p => p.key));
  let newCount = 0;

  for (const station of STATIONS) {
    console.log(`   Frage ${station.name} ab...`);
    const fresh = await fetchLine33(station.id, station.name);
    
    const uniqueFresh = fresh.filter(p => !keys.has(p.key));
    uniqueFresh.forEach(p => keys.add(p.key));
    
    allData = [...allData, ...uniqueFresh];
    newCount += uniqueFresh.length;
    
    console.log(`   → ${uniqueFresh.length} neue Punkte von ${station.name}`);
  }

  console.log(`\n✨ Insgesamt: ${allData.length} Datenpunkte`);
  console.log(`📈 Neue heute: ${newCount}`);
  
  saveData(allData);
}

main().catch(e => {
  console.error('FEHLER:', e);
  process.exit(1);
});
