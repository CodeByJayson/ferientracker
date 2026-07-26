/* ---------- State ---------- */
let books = [];
let readingHistory = {};
let weightData = { start: null, goal: null, entries: [] };
let fahrData = { total: 1074, done: 0, history: {} };
let todosData = {}; // { "YYYY-MM-DD": [{ id, text, done }] }
let generalTodos = []; // [{ id, text, done }] - Gesamtübersicht, unabhängig vom Kalender
let recurringTodos = []; // [{ id, text, weekday(0=So..6=Sa), createdDate, skippedDates: [] }]
let habitsData = { good: [], bad: [] };
// good: [{ id, name, history: {date:true} }]
// bad:  [{ id, name, startDate, lastRelapse, best }]
let sleepData = { goalHours: null, entries: [] }; // entries: [{ date, bedTime, wakeTime, hours }]
let gtgData = {
  targets: { pushups: 8, dips: 5, pullups: 3 },
  maxes: { pushups: 18, dips: 11, pullups: 8 },
  lastTestDate: null,
  history: { pushups: {}, dips: {}, pullups: {} } // je "YYYY-MM-DD": Wiederholungen
};
let studyData = {
  planStartDate: null, // wird beim ersten Laden auf heute gesetzt
  wrCards: [], // [{ id, title, box(1-5), nextReview, createdDate }]
  wrNewCardsHistory: {}, // "YYYY-MM-DD": Anzahl neu geschriebener Karten
  mathHistory: {} // "YYYY-MM-DD": true
};
let goalsData = []; // [{ id, text, done }]
const reviewedTodayIds = new Set(); // nur für diese Sitzung - schon beantwortete Karten ausblenden

let sleepChart = null;
let gtgChart = null;

const todayObj = new Date();
let calendarYear = todayObj.getFullYear();
let calendarMonth = todayObj.getMonth(); // 0-indexed
let selectedDate = getTodayKey();

let historyChart = null;
let weightChart = null;
let fahrChart = null;

/* ---------- Utilities ---------- */
function getTodayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

document.getElementById('current-date').innerText = new Date().toLocaleDateString('de-DE', {
  weekday:'long', year:'numeric', month:'long', day:'numeric'
});

/* Streak: count consecutive days (including today or yesterday) present as keys in a history object */
function computeStreak(historyObj){
  const keys = Object.keys(historyObj).filter(k => historyObj[k] > 0);
  if(keys.length === 0) return 0;
  const daySet = new Set(keys);
  let streak = 0;
  let cursor = new Date();
  // if today has no entry yet, start counting from yesterday so a still-active streak doesn't show 0
  const todayKey = getTodayKey();
  if(!daySet.has(todayKey)) cursor.setDate(cursor.getDate()-1);
  while(true){
    const k = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    if(daySet.has(k)){
      streak++;
      cursor.setDate(cursor.getDate()-1);
    } else {
      break;
    }
  }
  return streak;
}

const CHART_WINDOW_SIZE = 21;
const MAX_CHART_OFFSET = 500; // safety cap: 500 windows of 21 days = ~28 years back

let historyOffset = 0;
let weightOffset = 0;
let fahrOffset = 0;
let sleepOffset = 0;
let gtgOffset = 0;

function fmtShortDate(d){
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
}
function fmtFullDate(d){
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

/* Calendar-based sliding window: shows CHART_WINDOW_SIZE consecutive days,
   offsetPages=0 is the most recent window, higher offsetPages go further back. */
function getChartWindow(historyObj, offsetPages){
  const size = CHART_WINDOW_SIZE;
  const daysBack = offsetPages * size;
  const labels = [];
  const values = [];
  for(let i = size - 1; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - daysBack - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    labels.push(fmtShortDate(d));
    values.push(historyObj[key] || 0);
  }
  const startDate = new Date(); startDate.setDate(startDate.getDate() - daysBack - (size - 1));
  const endDate = new Date(); endDate.setDate(endDate.getDate() - daysBack);
  const rangeLabel = `${fmtFullDate(startDate)} – ${fmtFullDate(endDate)}`;
  return { labels, values, rangeLabel };
}

function sumLastNDays(historyObj, n){
  let total = 0;
  for(let i = 0; i < n; i++){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    total += historyObj[key] || 0;
  }
  return total;
}

function updateNavButtons(nextBtnId, offset){
  const btn = document.getElementById(nextBtnId);
  if(btn) btn.disabled = (offset === 0);
}

/* Enables swiping left/right on a chart container.
   Swipe right (finger moves right) -> older data (like turning a page back).
   Swipe left -> newer data. */
function attachSwipe(containerId, onOlder, onNewer){
  const el = document.getElementById(containerId);
  if(!el || el.dataset.swipeAttached) return;
  el.dataset.swipeAttached = 'true';
  let startX = null;
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if(startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if(Math.abs(dx) > 40){
      if(dx > 0) onOlder(); else onNewer();
    }
    startX = null;
  });
}

/* ---------- Persistence (localStorage) ---------- */
/* Diese Seite läuft als eigenständige lokale Datei, deshalb speichern wir
   direkt im localStorage des Browsers statt im Claude-Artefakt-Speicher. */
function loadAll(){
  try{
    const b = localStorage.getItem('books-data');
    if(b){
      const parsed = JSON.parse(b);
      books = parsed.books || [];
      readingHistory = parsed.readingHistory || {};
    }
  } catch(e){ console.error('Konnte Bücher-Daten nicht laden', e); }

  try{
    const w = localStorage.getItem('weight-data');
    if(w){ weightData = JSON.parse(w); }
  } catch(e){ console.error('Konnte Gewicht-Daten nicht laden', e); }

  try{
    const f = localStorage.getItem('fahr-data');
    if(f){ fahrData = JSON.parse(f); }
  } catch(e){ console.error('Konnte Fahrschule-Daten nicht laden', e); }

  try{
    const t = localStorage.getItem('todo-data');
    if(t){ todosData = JSON.parse(t); }
  } catch(e){ console.error('Konnte To-Do-Daten nicht laden', e); }

  try{
    const gt = localStorage.getItem('general-todo-data');
    if(gt){ generalTodos = JSON.parse(gt); }
  } catch(e){ console.error('Konnte Aufgabenliste nicht laden', e); }

  try{
    const rt = localStorage.getItem('recurring-todo-data');
    if(rt){ recurringTodos = JSON.parse(rt); }
  } catch(e){ console.error('Konnte wiederkehrende Aufgaben nicht laden', e); }

  try{
    const h = localStorage.getItem('habits-data');
    if(h){ habitsData = JSON.parse(h); }
  } catch(e){ console.error('Konnte Habit-Daten nicht laden', e); }

  try{
    const sl = localStorage.getItem('sleep-data');
    if(sl){ sleepData = JSON.parse(sl); }
  } catch(e){ console.error('Konnte Schlaf-Daten nicht laden', e); }

  try{
    const gtg = localStorage.getItem('gtg-data');
    if(gtg){ gtgData = JSON.parse(gtg); }
  } catch(e){ console.error('Konnte Trainings-Daten nicht laden', e); }

  try{
    const st = localStorage.getItem('study-data');
    if(st){ studyData = JSON.parse(st); }
  } catch(e){ console.error('Konnte Lern-Daten nicht laden', e); }
  if(!studyData.planStartDate){
    studyData.planStartDate = getTodayKey();
  }

  try{
    const gl = localStorage.getItem('goals-data');
    if(gl){ goalsData = JSON.parse(gl); }
  } catch(e){ console.error('Konnte Ziele nicht laden', e); }

  document.getElementById('loading-note').style.display = 'none';
  autoApplyMissedJokers();
  materializeRecurringTodos();
  checkBackupReminder();
  renderBooks();
  renderWeight();
  renderFahr();
  renderTodo();
  renderGeneralTodos();
  renderRecurringList();
  renderGoals();
  renderHabits();
  renderSleep();
  renderGTG();
  renderStudy();
}

function saveBooksData(){
  try{ localStorage.setItem('books-data', JSON.stringify({ books, readingHistory })); }
  catch(e){ console.error('Speichern fehlgeschlagen (Bücher)', e); }
}
function saveWeightData(){
  try{ localStorage.setItem('weight-data', JSON.stringify(weightData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Gewicht)', e); }
}
function saveFahrData(){
  try{ localStorage.setItem('fahr-data', JSON.stringify(fahrData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Fahrschule)', e); }
}
function saveTodoData(){
  try{ localStorage.setItem('todo-data', JSON.stringify(todosData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (To-Dos)', e); }
}
function saveGeneralTodosData(){
  try{ localStorage.setItem('general-todo-data', JSON.stringify(generalTodos)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Aufgabenliste)', e); }
}
function saveRecurringTodosData(){
  try{ localStorage.setItem('recurring-todo-data', JSON.stringify(recurringTodos)); }
  catch(e){ console.error('Speichern fehlgeschlagen (wiederkehrende Aufgaben)', e); }
}
function saveHabitsData(){
  try{ localStorage.setItem('habits-data', JSON.stringify(habitsData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Habits)', e); }
}
function saveGoalsData(){
  try{ localStorage.setItem('goals-data', JSON.stringify(goalsData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Ziele)', e); }
}
function saveSleepData(){
  try{ localStorage.setItem('sleep-data', JSON.stringify(sleepData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Schlaf)', e); }
}
function saveGTGData(){
  try{ localStorage.setItem('gtg-data', JSON.stringify(gtgData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Training)', e); }
}
function saveStudyData(){
  try{ localStorage.setItem('study-data', JSON.stringify(studyData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Lernen)', e); }
}

/* ---------- Tabs ---------- */
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

/* ================= BÜCHER ================= */
function renderBooks(){
  const list = document.getElementById('books-list');
  list.innerHTML = '';

  if(books.length === 0){
    list.innerHTML = '<p class="empty-state">Deine Bibliothek ist leer. Füge dein erstes Buch hinzu!</p>';
  }

  books.forEach((book, index) => {
    const progressPercent = Math.min(Math.round((book.readPages / book.totalPages) * 100), 100);
    const html = `
      <div class="book-item">
        <div class="book-info">
          <span class="book-title">${book.title}</span>
          <button class="delete-btn" onclick="deleteBook(${index})">Löschen</button>
        </div>
        <div class="progress-container">
          <div class="progress-bar books-bar" style="width:${progressPercent}%"></div>
          <div class="progress-text">${progressPercent}% (${book.readPages} / ${book.totalPages} S.)</div>
        </div>
        <div class="track-section">
          <label>Ich bin jetzt auf Seite:</label>
          <input type="number" id="input-page-${index}" value="${book.readPages}" min="0" max="${book.totalPages}">
          <button onclick="updateProgress(${index})">Speichern</button>
        </div>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  });

  saveBooksData();
  updateHistoryChart();
}

function addBook(){
  const titleInput = document.getElementById('book-title');
  const pagesInput = document.getElementById('book-pages');
  const title = titleInput.value.trim();
  const totalPages = parseInt(pagesInput.value);

  if(!title || isNaN(totalPages) || totalPages <= 0){
    alert('Bitte gib einen gültigen Titel und die Seitenzahl ein.');
    return;
  }
  books.push({ title, totalPages, readPages: 0 });
  titleInput.value = '';
  pagesInput.value = '';
  renderBooks();
}

function updateProgress(index){
  const pageInput = document.getElementById(`input-page-${index}`);
  const newPageValue = parseInt(pageInput.value);
  const book = books[index];

  if(isNaN(newPageValue) || newPageValue < 0 || newPageValue > book.totalPages){
    alert(`Ungültige Seitenzahl (0 - ${book.totalPages}).`);
    return;
  }
  const diff = newPageValue - book.readPages;
  if(diff > 0){
    const today = getTodayKey();
    readingHistory[today] = (readingHistory[today] || 0) + diff;
  }
  book.readPages = newPageValue;
  renderBooks();
}

function deleteBook(index){
  if(confirm(`"${books[index].title}" wirklich löschen?`)){
    books.splice(index, 1);
    renderBooks();
  }
}

function updateHistoryChart(){
  const ctx = document.getElementById('historyChart').getContext('2d');
  const { labels, values, rangeLabel } = getChartWindow(readingHistory, historyOffset);
  document.getElementById('history-range-label').innerText = rangeLabel;
  updateNavButtons('history-next-btn', historyOffset);
  attachSwipe('history-chart-container', () => shiftHistoryChart(1), () => shiftHistoryChart(-1));
  if(historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{
      label:'Gelesene Seiten', data: values,
      borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.1)',
      borderWidth:3, fill:true, tension:.3,
      pointBackgroundColor:'#10b981', pointRadius:3
    }]},
    options: chartOptions()
  });
}

function shiftHistoryChart(delta){
  historyOffset = Math.max(0, Math.min(MAX_CHART_OFFSET, historyOffset + delta));
  updateHistoryChart();
}

/* ================= GEWICHT ================= */
function renderWeight(){
  const goalCard = document.getElementById('weight-goal-card');
  const progressCard = document.getElementById('weight-progress-card');

  if(weightData.start === null){
    goalCard.style.display = 'block';
    progressCard.style.display = 'none';
  } else {
    goalCard.style.display = 'none';
    progressCard.style.display = 'block';

    const entries = weightData.entries.slice().sort((a,b)=>a.date.localeCompare(b.date));
    const current = entries.length ? entries[entries.length-1].weight : weightData.start;
    const changeFromStart = current - weightData.start;

    let statsHtml = `
      <div class="stat-box"><div class="num">${current.toFixed(1)} kg</div><div class="label">Aktuell</div></div>
      <div class="stat-box"><div class="num">${changeFromStart >= 0 ? '+' : ''}${changeFromStart.toFixed(1)} kg</div><div class="label">Seit Start</div></div>
    `;

    let percent = 0;
    if(weightData.goal !== null && weightData.goal !== weightData.start){
      const total = weightData.goal - weightData.start;
      const done = current - weightData.start;
      percent = Math.max(0, Math.min(100, Math.round((done/total)*100)));
      const remaining = weightData.goal - current;
      statsHtml += `<div class="stat-box"><div class="num">${remaining >= 0 ? remaining.toFixed(1) : (remaining*-1).toFixed(1)} kg</div><div class="label">${remaining >= 0 ? 'Bis zum Ziel' : 'Über dem Ziel'}</div></div>`;
    } else {
      statsHtml += `<div class="stat-box"><div class="num">${entries.length}</div><div class="label">Einträge</div></div>`;
    }

    document.getElementById('weight-stats').innerHTML = statsHtml;

    document.getElementById('weight-progress-bar').style.width = percent + '%';
    document.getElementById('weight-progress-text').innerText = weightData.goal !== null
      ? `${percent}% deines Ziels erreicht`
      : `Kein Zielgewicht gesetzt`;

    // streak
    const entryHistory = {};
    entries.forEach(e => entryHistory[e.date] = 1);
    const streak = computeStreak(entryHistory);
    document.getElementById('weight-streak-badge').innerHTML = streak > 0
      ? `<div class="streak-badge weight-streak">🔥 ${streak} Tag${streak===1?'':'e'} in Folge getrackt</div>`
      : '';

    checkCelebration('weight', percent);
  }

  saveWeightData();
  updateWeightChart();
}

function saveWeightGoal(){
  const start = parseFloat(document.getElementById('weight-start').value);
  const goalRaw = document.getElementById('weight-goal').value;
  const goal = goalRaw ? parseFloat(goalRaw) : null;

  if(isNaN(start)){
    alert('Bitte gib ein gültiges Startgewicht ein.');
    return;
  }
  weightData.start = start;
  weightData.goal = goal;
  if(weightData.entries.length === 0){
    weightData.entries.push({ date: getTodayKey(), weight: start });
  }
  renderWeight();
}

function resetWeightGoal(){
  if(confirm('Ziel wirklich zurücksetzen? Dein bisheriger Verlauf bleibt erhalten.')){
    weightData.start = null;
    weightData.goal = null;
    renderWeight();
  }
}

function addWeightEntry(){
  const dateInput = document.getElementById('weight-date');
  const valueInput = document.getElementById('weight-value');
  const date = dateInput.value || getTodayKey();
  const weight = parseFloat(valueInput.value);

  if(isNaN(weight) || weight <= 0){
    alert('Bitte gib ein gültiges Gewicht ein.');
    return;
  }
  const existingIndex = weightData.entries.findIndex(e => e.date === date);
  if(existingIndex >= 0){
    weightData.entries[existingIndex].weight = weight;
  } else {
    weightData.entries.push({ date, weight });
  }
  valueInput.value = '';
  renderWeight();
}

function updateWeightChart(){
  const ctx = document.getElementById('weightChart').getContext('2d');
  const allEntries = weightData.entries.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const size = CHART_WINDOW_SIZE;
  const total = allEntries.length;
  const maxOffset = Math.max(0, Math.ceil(total / size) - 1);
  weightOffset = Math.min(weightOffset, maxOffset);

  const endIndex = total - weightOffset * size;
  const startIndex = Math.max(0, endIndex - size);
  const windowEntries = allEntries.slice(Math.max(0, startIndex), Math.max(0, endIndex));

  const labels = windowEntries.length ? windowEntries.map(e => {
    const [y,m,d] = e.date.split('-');
    return `${d}.${m}.`;
  }) : ['Heute'];
  const values = windowEntries.length ? windowEntries.map(e => e.weight) : [0];

  const rangeLabel = windowEntries.length
    ? `${windowEntries[0].date.split('-').reverse().join('.')} – ${windowEntries[windowEntries.length-1].date.split('-').reverse().join('.')}`
    : 'Keine Einträge';
  document.getElementById('weight-range-label').innerText = rangeLabel;
  document.getElementById('weight-next-btn').disabled = (weightOffset === 0);
  attachSwipe('weight-chart-container', () => shiftWeightChart(1), () => shiftWeightChart(-1));

  if(weightChart) weightChart.destroy();
  const minValue = values.length ? Math.min(...values) : 50;
  const yMin = Math.min(60, Math.floor(minValue - 2)); // startet bei 50kg, weicht nur aus falls Werte darunter liegen
  weightChart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{
      label:'Gewicht (kg)', data: values,
      borderColor:'#ec4899', backgroundColor:'rgba(236,72,153,.1)',
      borderWidth:3, fill:true, tension:.3,
      pointBackgroundColor:'#f9a8d4', pointRadius:3
    }]},
    options: chartOptions(yMin)
  });
}

function shiftWeightChart(delta){
  const allEntries = weightData.entries;
  const maxOffset = Math.max(0, Math.ceil(allEntries.length / CHART_WINDOW_SIZE) - 1);
  weightOffset = Math.max(0, Math.min(maxOffset, weightOffset + delta));
  updateWeightChart();
}

/* ================= SCHLAF ================= */
function renderSleep(){
  const entries = sleepData.entries.slice().sort((a,b) => a.date.localeCompare(b.date));
  const last = entries.length ? entries[entries.length - 1] : null;
  const last7Total = sumLastNDaysFromEntries(entries, 7);
  const last7Count = entries.filter(e => daysSince(e.date) < 7).length;
  const avg7 = last7Count > 0 ? (last7Total / last7Count) : 0;

  let statsHtml = `
    <div class="stat-box"><div class="num">${last ? last.hours + ' h' : '–'}</div><div class="label">Letzte Nacht</div></div>
    <div class="stat-box"><div class="num">${avg7 ? avg7.toFixed(1) + ' h' : '–'}</div><div class="label">Ø letzte 7 Nächte</div></div>
  `;
  if(sleepData.goalHours){
    const diff = (last ? last.hours : 0) - sleepData.goalHours;
    statsHtml += `<div class="stat-box"><div class="num">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} h</div><div class="label">Zu Zielstunden</div></div>`;
  } else {
    statsHtml += `<div class="stat-box"><div class="num">${entries.length}</div><div class="label">Einträge</div></div>`;
  }
  document.getElementById('sleep-stats').innerHTML = statsHtml;
  document.getElementById('sleep-goal').value = sleepData.goalHours || '';

  const entryHistory = {};
  entries.forEach(e => entryHistory[e.date] = 1);
  const streak = computeStreak(entryHistory);
  document.getElementById('sleep-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge" style="background:rgba(59,130,246,.12); color:#93c5fd;">🔥 ${streak} Nacht${streak===1?'':'e'} in Folge getrackt</div>`
    : '';

  saveSleepData();
  updateSleepChart();
}

function sumLastNDaysFromEntries(entries, n){
  return entries
    .filter(e => daysSince(e.date) < n)
    .reduce((sum, e) => sum + e.hours, 0);
}

function saveSleepGoal(){
  const goal = parseFloat(document.getElementById('sleep-goal').value);
  sleepData.goalHours = isNaN(goal) || goal <= 0 ? null : goal;
  renderSleep();
}

function computeSleepHours(bedTime, wakeTime){
  const [bh, bm] = bedTime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  const bedMinutes = bh * 60 + bm;
  const wakeMinutes = wh * 60 + wm;
  let diff = wakeMinutes - bedMinutes;
  if(diff <= 0) diff += 24 * 60; // über Mitternacht geschlafen
  return Math.round((diff / 60) * 100) / 100;
}

function addSleepEntry(){
  const dateInput = document.getElementById('sleep-date');
  const bedtimeInput = document.getElementById('sleep-bedtime');
  const waketimeInput = document.getElementById('sleep-waketime');
  const date = dateInput.value || getTodayKey();
  const bedTime = bedtimeInput.value;
  const wakeTime = waketimeInput.value;

  if(!bedTime || !wakeTime){
    alert('Bitte gib beide Uhrzeiten ein (ins Bett gegangen & aufgewacht).');
    return;
  }

  const hours = computeSleepHours(bedTime, wakeTime);

  const existingIndex = sleepData.entries.findIndex(e => e.date === date);
  if(existingIndex >= 0){
    sleepData.entries[existingIndex] = { date, bedTime, wakeTime, hours };
  } else {
    sleepData.entries.push({ date, bedTime, wakeTime, hours });
  }
  bedtimeInput.value = '';
  waketimeInput.value = '';
  renderSleep();
}

function timeToDecimalHours(timeStr){
  const [h, m] = timeStr.split(':').map(Number);
  return h + m / 60;
}

/* Bettzeiten liegen meist abends/nachts - Zeiten nach Mitternacht (z.B. 00:30)
   werden auf 24.5 usw. verschoben, damit die Linie nicht von 24 auf 0 zurückspringt. */
function bedTimeToPlotValue(timeStr){
  let val = timeToDecimalHours(timeStr);
  if(val < 12) val += 24;
  return val;
}

function formatHourValueAsTime(value){
  const v = ((value % 24) + 24) % 24;
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function updateSleepChart(){
  const ctx = document.getElementById('sleepChart').getContext('2d');
  const allEntries = sleepData.entries.slice().sort((a,b) => a.date.localeCompare(b.date));
  const size = CHART_WINDOW_SIZE;
  const total = allEntries.length;
  const maxOffset = Math.max(0, Math.ceil(total / size) - 1);
  sleepOffset = Math.min(sleepOffset, maxOffset);

  const endIndex = total - sleepOffset * size;
  const startIndex = Math.max(0, endIndex - size);
  const windowEntries = allEntries.slice(Math.max(0, startIndex), Math.max(0, endIndex));

  const labels = windowEntries.length ? windowEntries.map(e => {
    const [y,m,d] = e.date.split('-');
    return `${d}.${m}.`;
  }) : ['Heute'];
  const bedValues = windowEntries.length ? windowEntries.map(e => e.bedTime ? bedTimeToPlotValue(e.bedTime) : null) : [null];
  const wakeValues = windowEntries.length ? windowEntries.map(e => e.wakeTime ? timeToDecimalHours(e.wakeTime) : null) : [null];

  const rangeLabel = windowEntries.length
    ? `${windowEntries[0].date.split('-').reverse().join('.')} – ${windowEntries[windowEntries.length-1].date.split('-').reverse().join('.')}`
    : 'Keine Einträge';
  document.getElementById('sleep-range-label').innerText = rangeLabel;
  document.getElementById('sleep-next-btn').disabled = (sleepOffset === 0);
  attachSwipe('sleep-chart-container', () => shiftSleepChart(1), () => shiftSleepChart(-1));

  if(sleepChart) sleepChart.destroy();
  sleepChart = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        {
          label:'Ins Bett', data: bedValues,
          borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,.1)',
          borderWidth:3, fill:false, tension:.3,
          pointBackgroundColor:'#c4b5fd', pointRadius:4, spanGaps:true
        },
        {
          label:'Aufgewacht', data: wakeValues,
          borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.1)',
          borderWidth:3, fill:false, tension:.3,
          pointBackgroundColor:'#fde68a', pointRadius:4, spanGaps:true
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{ display:true, position:'bottom', labels:{ color:'#94a3b8', boxWidth:12, font:{ size:11 } } },
        tooltip:{ callbacks:{ label: ctx => `${ctx.dataset.label}: ${formatHourValueAsTime(ctx.parsed.y)}` } }
      },
      scales:{
        y:{
          grid:{ color:'#334155' },
          ticks:{ color:'#94a3b8', stepSize:2, callback: value => formatHourValueAsTime(value) }
        },
        x:{
          grid:{ display:false },
          ticks:{ color:'#94a3b8', autoSkip:true, maxRotation:45, minRotation:0, maxTicksLimit:10 }
        }
      }
    }
  });
}

function shiftSleepChart(delta){
  const maxOffset = Math.max(0, Math.ceil(sleepData.entries.length / CHART_WINDOW_SIZE) - 1);
  sleepOffset = Math.max(0, Math.min(maxOffset, sleepOffset + delta));
  updateSleepChart();
}

/* ================= FAHRSCHULE ================= */
function renderFahr(){
  const percent = fahrData.total > 0 ? Math.min(100, Math.round((fahrData.done / fahrData.total) * 100)) : 0;
  const remaining = Math.max(0, fahrData.total - fahrData.done);

  document.getElementById('fahr-stats').innerHTML = `
    <div class="stat-box"><div class="num">${fahrData.done}</div><div class="label">Geübt</div></div>
    <div class="stat-box"><div class="num">${remaining}</div><div class="label">Verbleibend</div></div>
    <div class="stat-box"><div class="num">${fahrData.total}</div><div class="label">Gesamt</div></div>
  `;

  document.getElementById('fahr-progress-bar').style.width = percent + '%';
  document.getElementById('fahr-progress-text').innerText = `${percent}% des Fragenkatalogs geschafft`;

  document.getElementById('fahr-total').value = fahrData.total;

  // Tagesziel: 160 Fragen pro Tag
  const DAILY_GOAL = 170;
  const todayKey = getTodayKey();
  const doneToday = fahrData.history[todayKey] || 0;
  const dailyPercent = Math.min(100, Math.round((doneToday / DAILY_GOAL) * 100));
  document.getElementById('fahr-daily-progress-bar').style.width = dailyPercent + '%';
  document.getElementById('fahr-daily-progress-text').innerText = doneToday >= DAILY_GOAL
    ? `🎉 Tagesziel erreicht! (${doneToday} / ${DAILY_GOAL})`
    : `${doneToday} / ${DAILY_GOAL} heute`;

  const streak = computeStreak(fahrData.history);
  document.getElementById('fahr-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge">🔥 ${streak} Tag${streak===1?'':'e'} in Folge geübt</div>`
    : '';

  checkCelebration('fahr', percent);

  saveFahrData();
  updateFahrChart();
}

function saveFahrTotal(){
  const total = parseInt(document.getElementById('fahr-total').value);
  if(isNaN(total) || total <= 0){
    alert('Bitte gib eine gültige Gesamtzahl ein.');
    return;
  }
  fahrData.total = total;
  renderFahr();
}

function addFahrDone(n){
  fahrData.done = Math.min(fahrData.total, fahrData.done + n);
  const today = getTodayKey();
  fahrData.history[today] = (fahrData.history[today] || 0) + n;
  renderFahr();
}

function addFahrCustom(){
  const input = document.getElementById('fahr-custom');
  const n = parseInt(input.value);
  if(isNaN(n) || n <= 0){
    alert('Bitte gib eine gültige Anzahl ein.');
    return;
  }
  addFahrDone(n);
  input.value = '';
}

function updateFahrChart(){
  const ctx = document.getElementById('fahrChart').getContext('2d');
  const { labels, values, rangeLabel } = getChartWindow(fahrData.history, fahrOffset);
  document.getElementById('fahr-range-label').innerText = rangeLabel;
  updateNavButtons('fahr-next-btn', fahrOffset);
  attachSwipe('fahr-chart-container', () => shiftFahrChart(1), () => shiftFahrChart(-1));
  if(fahrChart) fahrChart.destroy();
  fahrChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{
      label:'Geübte Fragen', data: values,
      backgroundColor:'rgba(245,158,11,.6)',
      borderColor:'#f59e0b', borderWidth:1, borderRadius:6
    }]},
    options: chartOptions()
  });
}

function shiftFahrChart(delta){
  fahrOffset = Math.max(0, Math.min(MAX_CHART_OFFSET, fahrOffset + delta));
  updateFahrChart();
}

/* ================= TO-DOS / KALENDER ================= */
const weekdayLabels = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const monthLabels = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function dateKey(y, m, d){
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/* Ein Punkt pro erledigtem To-Do an diesem Tag (max. 5, danach "+n"),
   plus ein blasser Punkt, falls an dem Tag noch offene Aufgaben liegen. */
function buildDayDots(items){
  if(items.length === 0) return '';
  const MAX_DOTS = 5;
  const doneCount = items.filter(t => t.done).length;
  const pendingCount = items.length - doneCount;

  let html = '';
  const shown = Math.min(doneCount, MAX_DOTS);
  for(let i = 0; i < shown; i++){
    html += '<span class="dot dot-done"></span>';
  }
  if(doneCount > MAX_DOTS){
    html += `<span class="dot-extra">+${doneCount - MAX_DOTS}</span>`;
  }
  if(pendingCount > 0){
    html += '<span class="dot dot-pending"></span>';
  }
  return html;
}

function changeMonth(delta){
  calendarMonth += delta;
  if(calendarMonth < 0){ calendarMonth = 11; calendarYear--; }
  if(calendarMonth > 11){ calendarMonth = 0; calendarYear++; }
  renderTodo();
}

function selectDay(key){
  selectedDate = key;
  renderTodo();
}

function renderTodo(){
  document.getElementById('calendar-month-label').innerText = `${monthLabels[calendarMonth]} ${calendarYear}`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  weekdayLabels.forEach(w => {
    grid.insertAdjacentHTML('beforeend', `<div class="calendar-weekday">${w}</div>`);
  });

  const firstOfMonth = new Date(calendarYear, calendarMonth, 1);
  // JS getDay(): 0=Sun..6=Sat -> convert to Mon-first index
  let startOffset = firstOfMonth.getDay() - 1;
  if(startOffset < 0) startOffset = 6;

  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const todayKey = getTodayKey();

  for(let i = 0; i < startOffset; i++){
    grid.insertAdjacentHTML('beforeend', `<div class="calendar-day empty"></div>`);
  }

  for(let d = 1; d <= daysInMonth; d++){
    const key = dateKey(calendarYear, calendarMonth, d);
    const items = todosData[key] || [];

    let classes = 'calendar-day';
    if(key === todayKey) classes += ' today';
    if(key === selectedDate) classes += ' selected';

    grid.insertAdjacentHTML('beforeend', `
      <div class="${classes}" onclick="selectDay('${key}')">
        ${d}
        <div class="day-dots">${buildDayDots(items)}</div>
      </div>
    `);
  }

  renderTodoList();

  const streak = computeStreak(
    Object.fromEntries(Object.entries(todosData).map(([k, v]) => [k, v.length]))
  );
  document.getElementById('todo-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge">🔥 ${streak} Tag${streak===1?'':'e'} in Folge geplant</div>`
    : '';

  saveTodoData();
  renderTodayWidget();
}

/* Kompaktes Widget, das die heutigen Aufgaben unabhängig vom aktiven Tab zeigt.
   Nutzt bewusst den heutigen Tag fest (nicht "selectedDate" aus dem Kalender),
   damit es sich nicht verändert, während man im Kalender woanders hin blättert. */
function renderTodayWidget(){
  const list = document.getElementById('today-widget-list');
  const summary = document.getElementById('today-widget-summary');
  const todayKey = getTodayKey();
  const items = todosData[todayKey] || [];

  if(items.length === 0){
    summary.innerText = '';
    list.innerHTML = '<p class="empty-state" style="margin:4px 0;">Keine Aufgaben für heute eingetragen.</p>';
    return;
  }

  const doneCount = items.filter(t => t.done).length;
  summary.innerText = `${doneCount} von ${items.length} erledigt`;

  list.innerHTML = items.map(item => `
    <div class="todo-item ${item.done ? 'done' : ''}">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleTodayWidgetTodo('${item.id}')">
      <span class="todo-text">${item.text}</span>
    </div>
  `).join('');
}

function toggleTodayWidgetTodo(id){
  const todayKey = getTodayKey();
  const items = todosData[todayKey] || [];
  const item = items.find(t => t.id === id);
  if(item) item.done = !item.done;
  renderTodo(); // hält Kalender, Aufgabenliste und dieses Widget synchron
}

function renderTodoList(){
  const [y, m, d] = selectedDate.split('-');
  const isToday = selectedDate === getTodayKey();
  document.getElementById('selected-date-label').innerText =
    `${d}.${m}.${y}` + (isToday ? ' · Heute' : '');

  const list = document.getElementById('todo-list');
  const items = todosData[selectedDate] || [];

  if(items.length === 0){
    list.innerHTML = '<p class="empty-state">Für diesen Tag steht noch nichts auf der Liste.</p>';
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="todo-item ${item.done ? 'done' : ''}">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleTodo('${item.id}')">
      <span class="todo-text">${item.text}</span>
      ${item.recurringId ? '<span class="recurring-badge">🔁</span>' : ''}
      <button class="delete-btn" onclick="deleteTodo('${item.id}')">Löschen</button>
    </div>
  `).join('');
}

function addTodo(){
  const input = document.getElementById('todo-text');
  const repeatCheckbox = document.getElementById('todo-repeat-weekly');
  const text = input.value.trim();
  if(!text) return;

  const repeatWeekly = repeatCheckbox.checked;

  if(repeatWeekly){
    const [y, m, d] = selectedDate.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const templateId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    recurringTodos.push({ id: templateId, text, weekday, createdDate: selectedDate, skippedDates: [] });
    materializeRecurringTodos();
    renderRecurringList();
  } else {
    if(!todosData[selectedDate]) todosData[selectedDate] = [];
    todosData[selectedDate].push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), text, done: false });
  }

  input.value = '';
  repeatCheckbox.checked = false;
  renderTodo();
}

function toggleTodo(id){
  const items = todosData[selectedDate] || [];
  const item = items.find(t => t.id === id);
  if(item) item.done = !item.done;
  renderTodo();
}

function deleteTodo(id){
  const items = todosData[selectedDate] || [];
  const item = items.find(t => t.id === id);

  // Bei wiederkehrenden Aufgaben: nur diesen einen Tag überspringen,
  // statt dass die Aufgabe beim nächsten Laden wieder auftaucht.
  if(item && item.recurringId){
    const template = recurringTodos.find(rt => rt.id === item.recurringId);
    if(template){
      if(!template.skippedDates) template.skippedDates = [];
      if(!template.skippedDates.includes(selectedDate)) template.skippedDates.push(selectedDate);
      saveRecurringTodosData();
    }
  }

  todosData[selectedDate] = items.filter(t => t.id !== id);
  renderTodo();
}

/* ================= WIEDERKEHRENDE (WÖCHENTLICHE) TO-DOS ================= */
const WEEKDAY_NAMES = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

/* Erzeugt für jede Vorlage die konkreten Tages-Einträge im Kalender,
   von der Erstellung an bis ca. 12 Wochen in die Zukunft. Bereits
   übersprungene oder schon vorhandene Tage werden nicht doppelt angelegt. */
function materializeRecurringTodos(){
  if(recurringTodos.length === 0) return;

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 7);
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 84);

  const MAX_DAYS = 200; // Sicherheitsgrenze, verhindert jede Endlosschleife

  recurringTodos.forEach(template => {
    if(!template.skippedDates) template.skippedDates = [];
    let cursor = new Date(windowStart);

    for(let i = 0; i < MAX_DAYS; i++){
      if(cursor > windowEnd) break;

      if(cursor.getDay() === template.weekday){
        const key = dateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const afterCreation = key >= template.createdDate;
        const notSkipped = !template.skippedDates.includes(key);

        if(afterCreation && notSkipped){
          if(!todosData[key]) todosData[key] = [];
          const alreadyExists = todosData[key].some(t => t.recurringId === template.id);
          if(!alreadyExists){
            todosData[key].push({
              id: Date.now().toString(36) + Math.random().toString(36).slice(2,6) + i,
              text: template.text,
              done: false,
              recurringId: template.id
            });
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  saveTodoData();
}

function renderRecurringList(){
  const list = document.getElementById('recurring-todo-list');
  if(recurringTodos.length === 0){
    list.innerHTML = '<p class="empty-state">Noch keine wiederkehrende Aufgabe angelegt.</p>';
    return;
  }

  list.innerHTML = recurringTodos.map(rt => `
    <div class="todo-item">
      <span class="todo-text">${rt.text}</span>
      <span class="recurring-badge">jeden ${WEEKDAY_NAMES[rt.weekday]}</span>
      <button class="delete-btn" onclick="deleteRecurringSeries('${rt.id}')">Serie löschen</button>
    </div>
  `).join('');

  saveRecurringTodosData();
}

function deleteRecurringSeries(id){
  if(!confirm('Die ganze wiederkehrende Serie löschen? Das entfernt auch alle bereits geplanten (noch nicht erledigten) Termine dafür.')){
    return;
  }
  recurringTodos = recurringTodos.filter(rt => rt.id !== id);

  Object.keys(todosData).forEach(dateKeyStr => {
    todosData[dateKeyStr] = todosData[dateKeyStr].filter(t => t.recurringId !== id || t.done);
  });

  renderRecurringList();
  renderTodo();
}

/* ================= GESAMT-AUFGABENLISTE (unabhängig vom Kalender) ================= */
function renderGeneralTodos(){
  const list = document.getElementById('general-todo-list');
  const summary = document.getElementById('general-todo-summary');

  const doneCount = generalTodos.filter(t => t.done).length;
  summary.innerText = generalTodos.length
    ? `${doneCount} von ${generalTodos.length} erledigt`
    : '';

  if(generalTodos.length === 0){
    list.innerHTML = '<p class="empty-state">Noch nichts auf der Liste – trag ein, was insgesamt ansteht.</p>';
    saveGeneralTodosData();
    return;
  }

  list.innerHTML = generalTodos.map(item => `
    <div class="todo-item ${item.done ? 'done' : ''}">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleGeneralTodo('${item.id}')">
      <span class="todo-text">${item.text}</span>
      <button class="delete-btn" onclick="deleteGeneralTodo('${item.id}')">Löschen</button>
    </div>
  `).join('');

  saveGeneralTodosData();
}

function addGeneralTodo(){
  const input = document.getElementById('general-todo-text');
  const text = input.value.trim();
  if(!text) return;
  generalTodos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), text, done: false });
  input.value = '';
  renderGeneralTodos();
}

function toggleGeneralTodo(id){
  const item = generalTodos.find(t => t.id === id);
  if(item) item.done = !item.done;
  renderGeneralTodos();
}

function deleteGeneralTodo(id){
  generalTodos = generalTodos.filter(t => t.id !== id);
  renderGeneralTodos();
}

/* ================= ZIELE ================= */
function renderGoals(){
  const list = document.getElementById('goals-list');
  if(goalsData.length === 0){
    list.innerHTML = '<p class="empty-state">Noch keine Ziele eingetragen.</p>';
    saveGoalsData();
    return;
  }

  list.innerHTML = goalsData.map(goal => `
    <div class="todo-item ${goal.done ? 'done' : ''}">
      <input type="checkbox" ${goal.done ? 'checked' : ''} onchange="toggleGoal('${goal.id}')">
      <span class="todo-text">${goal.text}</span>
      <button class="delete-btn" onclick="deleteGoal('${goal.id}')">Löschen</button>
    </div>
  `).join('');

  saveGoalsData();
}

function addGoal(){
  const input = document.getElementById('goal-text');
  const text = input.value.trim();
  if(!text) return;
  goalsData.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), text, done: false });
  input.value = '';
  renderGoals();
}

function toggleGoal(id){
  const goal = goalsData.find(g => g.id === id);
  if(goal) goal.done = !goal.done;
  renderGoals();
}

function deleteGoal(id){
  goalsData = goalsData.filter(g => g.id !== id);
  renderGoals();
}

/* ================= HABITS ================= */
function daysSince(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const then = new Date(y, m-1, d);
  const today = new Date();
  today.setHours(0,0,0,0);
  then.setHours(0,0,0,0);
  return Math.round((today - then) / 86400000);
}

/* Monday of the week a given "YYYY-MM-DD" date falls into - used to limit the joker to once per week */
function getWeekKey(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const date = new Date(y, m-1, d);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diffToMonday);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/* Streak for good habits: a day counts if it was checked off OR it was used as a
   weekly "Joker" (skip) day. If a day is neither, the streak stops there - so the
   day right after a Joker day still has to be a real check-off. */
function computeGoodHabitStreak(habit){
  const history = habit.history || {};
  const freeDays = new Set(habit.freeDays || []);
  const satisfied = key => !!history[key] || freeDays.has(key);

  const todayKey = getTodayKey();
  let streak = 0;
  let cursor = new Date();
  if(!satisfied(todayKey)) cursor.setDate(cursor.getDate() - 1);

  const MAX_DAYS = 3650; // safety cap, never loop forever
  for(let i = 0; i < MAX_DAYS; i++){
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    if(satisfied(key)){
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/* Wird beim Laden aufgerufen: Wenn der GESTRIGE Tag nicht abgehakt wurde und
   der Wochen-Joker für diese Woche noch frei ist, wird er automatisch verbraucht -
   so geht der Streak nicht kaputt, nur weil man vergessen hat, ihn manuell zu klicken. */
function autoApplyMissedJokers(){
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

  habitsData.good.forEach(h => {
    if(!h.freeDays) h.freeDays = [];
    if(h.history[yKey]) return; // gestern wurde erledigt, nichts zu tun
    if(h.freeDays.includes(yKey)) return; // schon abgedeckt
    if(h.createdDate && yKey < h.createdDate) return; // Gewohnheit gab es damals noch nicht

    const weekKey = getWeekKey(yKey);
    const usedThisWeek = h.freeDays.some(d => getWeekKey(d) === weekKey);
    if(usedThisWeek) return; // Joker diese Woche schon verbraucht

    h.freeDays.push(yKey);
  });
}

function canUseJoker(habit){
  const todayKey = getTodayKey();
  if(habit.history[todayKey]) return false; // already done today, no need
  const freeDays = habit.freeDays || [];
  if(freeDays.includes(todayKey)) return false; // already used today
  const thisWeek = getWeekKey(todayKey);
  const usedThisWeek = freeDays.some(d => getWeekKey(d) === thisWeek);
  return !usedThisWeek;
}

function useJoker(id){
  const habit = habitsData.good.find(h => h.id === id);
  if(!habit) return;
  if(!habit.freeDays) habit.freeDays = [];
  if(!canUseJoker(habit)) return;
  habit.freeDays.push(getTodayKey());
  renderHabits();
}

let editingGoodId = null;
let editingBadId = null;

function renderHabits(){
  renderGoodHabits();
  renderBadHabits();
  saveHabitsData();
}

function renderGoodHabits(){
  const list = document.getElementById('good-habits-list');
  if(habitsData.good.length === 0){
    list.innerHTML = '<p class="empty-state">Noch keine Gewohnheit hinzugefügt.</p>';
    return;
  }
  const todayKey = getTodayKey();
  list.innerHTML = habitsData.good.map((h, index) => {
    if(h.id === editingGoodId){
      return `
        <div class="habit-item">
          <div class="habit-edit-form">
            <input type="text" id="edit-good-name-${h.id}" value="${h.name}">
            <input type="time" id="edit-good-time-${h.id}" value="${h.time || ''}">
          </div>
          <button onclick="saveEditGoodHabit('${h.id}')">Speichern</button>
          <button class="ghost" onclick="cancelEditGoodHabit()">Abbrechen</button>
        </div>
      `;
    }

    const doneToday = !!h.history[todayKey];
    const streak = computeGoodHabitStreak(h);
    h.best = Math.max(h.best || 0, streak);
    const jokerAvailable = canUseJoker(h);

    return `
      <div class="habit-item">
        <div class="habit-order-btns">
          <button onclick="moveGoodHabit('${h.id}', -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button onclick="moveGoodHabit('${h.id}', 1)" ${index === habitsData.good.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="habit-check">
          <input type="checkbox" ${doneToday ? 'checked' : ''} onchange="toggleGoodHabit('${h.id}')">
          <span>Heute</span>
        </div>
        <span class="habit-name">${h.name}</span>
        ${h.time ? `<span class="habit-time">⏰ ${h.time}</span>` : ''}
        <div class="habit-actions">
          <span class="habit-streak ${doneToday ? 'active' : ''}">🔥 <span class="streak-number">${streak}</span> Tag${streak===1?'':'e'}</span>
          <span class="habit-stat">🏆 Rekord: <b>${h.best}</b></span>
          <button class="joker-btn" onclick="useJoker('${h.id}')" ${jokerAvailable ? '' : 'disabled'} title="1x pro Woche einen Tag aussetzen, ohne den Streak zu verlieren">Joker</button>
          <button class="edit-btn" onclick="startEditGoodHabit('${h.id}')">Bearbeiten</button>
          <button class="delete-btn" onclick="deleteGoodHabit('${h.id}')">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderBadHabits(){
  const list = document.getElementById('bad-habits-list');
  if(habitsData.bad.length === 0){
    list.innerHTML = '<p class="empty-state">Noch keine schlechte Gewohnheit hinzugefügt.</p>';
    return;
  }
  list.innerHTML = habitsData.bad.map((h, index) => {
    if(h.id === editingBadId){
      return `
        <div class="habit-item">
          <div class="habit-edit-form">
            <input type="text" id="edit-bad-name-${h.id}" value="${h.name}">
            <input type="time" id="edit-bad-time-${h.id}" value="${h.time || ''}">
          </div>
          <button onclick="saveEditBadHabit('${h.id}')">Speichern</button>
          <button class="ghost" onclick="cancelEditBadHabit()">Abbrechen</button>
        </div>
      `;
    }

    const cleanSince = h.lastRelapse || h.startDate;
    const streak = daysSince(cleanSince);
    h.best = Math.max(h.best || 0, streak);

    return `
      <div class="habit-item">
        <div class="habit-order-btns">
          <button onclick="moveBadHabit('${h.id}', -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button onclick="moveBadHabit('${h.id}', 1)" ${index === habitsData.bad.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <span class="habit-name">${h.name}</span>
        ${h.time ? `<span class="habit-time">⏰ ${h.time}</span>` : ''}
        <div class="habit-actions">
          <span class="habit-streak active"><span class="streak-number">${streak}</span> Tag${streak===1?'':'e'} sauber</span>
          <span class="habit-stat">🏆 Rekord: <b>${h.best}</b></span>
          <button class="relapse-btn" onclick="reportRelapse('${h.id}')">Rückfall melden</button>
          <button class="edit-btn" onclick="startEditBadHabit('${h.id}')">Bearbeiten</button>
          <button class="delete-btn" onclick="deleteBadHabit('${h.id}')">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
}

function addGoodHabit(){
  const input = document.getElementById('good-habit-name');
  const timeInput = document.getElementById('good-habit-time');
  const name = input.value.trim();
  if(!name) return;
  habitsData.good.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name, time: timeInput.value || null, history: {}, best: 0, freeDays: [],
    createdDate: getTodayKey()
  });
  input.value = '';
  timeInput.value = '';
  renderHabits();
}

function toggleGoodHabit(id){
  const habit = habitsData.good.find(h => h.id === id);
  if(!habit) return;
  const todayKey = getTodayKey();
  if(habit.history[todayKey]) delete habit.history[todayKey];
  else habit.history[todayKey] = true;
  renderHabits();
}

function deleteGoodHabit(id){
  habitsData.good = habitsData.good.filter(h => h.id !== id);
  renderHabits();
}

function moveGoodHabit(id, direction){
  const arr = habitsData.good;
  const idx = arr.findIndex(h => h.id === id);
  const newIdx = idx + direction;
  if(idx === -1 || newIdx < 0 || newIdx >= arr.length) return;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  renderHabits();
}

function startEditGoodHabit(id){
  editingGoodId = id;
  renderHabits();
}

function cancelEditGoodHabit(){
  editingGoodId = null;
  renderHabits();
}

function saveEditGoodHabit(id){
  const habit = habitsData.good.find(h => h.id === id);
  if(!habit) return;
  const name = document.getElementById(`edit-good-name-${id}`).value.trim();
  const time = document.getElementById(`edit-good-time-${id}`).value;
  if(!name){
    alert('Der Name darf nicht leer sein.');
    return;
  }
  habit.name = name;
  habit.time = time || null;
  editingGoodId = null;
  renderHabits();
}

function addBadHabit(){
  const input = document.getElementById('bad-habit-name');
  const timeInput = document.getElementById('bad-habit-time');
  const name = input.value.trim();
  if(!name) return;
  habitsData.bad.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name, time: timeInput.value || null, startDate: getTodayKey(), lastRelapse: null, best: 0
  });
  input.value = '';
  timeInput.value = '';
  renderHabits();
}

function reportRelapse(id){
  const habit = habitsData.bad.find(h => h.id === id);
  if(!habit) return;
  const cleanSince = habit.lastRelapse || habit.startDate;
  const streakBeforeReset = daysSince(cleanSince);
  habit.best = Math.max(habit.best || 0, streakBeforeReset);
  habit.lastRelapse = getTodayKey();
  renderHabits();
}

function deleteBadHabit(id){
  habitsData.bad = habitsData.bad.filter(h => h.id !== id);
  renderHabits();
}

function moveBadHabit(id, direction){
  const arr = habitsData.bad;
  const idx = arr.findIndex(h => h.id === id);
  const newIdx = idx + direction;
  if(idx === -1 || newIdx < 0 || newIdx >= arr.length) return;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  renderHabits();
}

function startEditBadHabit(id){
  editingBadId = id;
  renderHabits();
}

function cancelEditBadHabit(){
  editingBadId = null;
  renderHabits();
}

function saveEditBadHabit(id){
  const habit = habitsData.bad.find(h => h.id === id);
  if(!habit) return;
  const name = document.getElementById(`edit-bad-name-${id}`).value.trim();
  const time = document.getElementById(`edit-bad-time-${id}`).value;
  if(!name){
    alert('Der Name darf nicht leer sein.');
    return;
  }
  habit.name = name;
  habit.time = time || null;
  editingBadId = null;
  renderHabits();
}

/* ================= TRAINING (GTG - Grease the Groove) ================= */
const GTG_EXERCISES = [
  { key: 'pushups', name: '💪 Liegestütze' },
  { key: 'dips', name: '🤸 Dips' },
  { key: 'pullups', name: '🧗 Klimmzüge' }
];

/* Index = JS Date.getDay(): 0=Sonntag ... 6=Samstag */
const GTG_WEEKLY_PLAN = [
  { name: 'Sonntag', text: 'Pause oder 2–3 sehr leichte GTG-Runden.' },
  { name: 'Montag (Gym – Push)', text: 'Kein GTG für Dips oder Liegestütze. Optional 2–3 leichte Sätze Klimmzüge (3 Wdh.) mit großem Abstand zum Training.' },
  { name: 'Dienstag', text: '5–6 GTG-Runden: 3–4 Klimmzüge, 5–6 Dips, 8–10 Liegestütze.' },
  { name: 'Mittwoch', text: '5–6 GTG-Runden wie Dienstag.' },
  { name: 'Donnerstag (Gym – Pull)', text: 'Kein GTG für Klimmzüge. Optional 2–3 leichte Sätze Liegestütze (8–10 Wdh.) und Dips (5 Wdh.), wenn du dich frisch fühlst.' },
  { name: 'Freitag', text: '5–6 GTG-Runden wie Dienstag.' },
  { name: 'Samstag', text: '3–5 lockere GTG-Runden oder komplett frei, wenn du müde bist.' }
];

function gtgCombinedHistory(){
  const merged = {};
  GTG_EXERCISES.forEach(ex => {
    Object.entries(gtgData.history[ex.key] || {}).forEach(([date, reps]) => {
      merged[date] = (merged[date] || 0) + reps;
    });
  });
  return merged;
}

function renderGTG(){
  renderGTGPlan();
  renderGTGGoals();
  renderGTGLog();
  updateGTGChart();
  saveGTGData();
}

function renderGTGPlan(){
  const todayIndex = new Date().getDay();
  const today = GTG_WEEKLY_PLAN[todayIndex];

  document.getElementById('gtg-today-plan').innerHTML = `
    <div class="gtg-today-highlight">
      <div class="gtg-day-title">Heute: ${today.name}</div>
      <div class="gtg-day-text">${today.text}</div>
    </div>
  `;

  document.getElementById('gtg-week-plan').innerHTML = GTG_WEEKLY_PLAN.map((day, index) => `
    <div class="gtg-day-row ${index === todayIndex ? 'today' : ''}">
      <span class="gtg-day-name">${day.name}</span>
      <span>${day.text}</span>
    </div>
  `).join('');
}

function renderGTGGoals(){
  document.getElementById('gtg-goal-grid').innerHTML = GTG_EXERCISES.map(ex => `
    <div class="gtg-goal-col">
      <div class="gtg-goal-name">${ex.name}</div>
      <label>Ziel-Wdh. pro Runde</label>
      <input type="number" id="gtg-target-${ex.key}" value="${gtgData.targets[ex.key]}" min="1">
      <label>Geschätztes Maximum</label>
      <input type="number" id="gtg-max-${ex.key}" value="${gtgData.maxes[ex.key]}" min="1">
    </div>
  `).join('');

  const reminderEl = document.getElementById('gtg-retest-reminder');
  const labelEl = document.getElementById('gtg-last-test-label');

  if(!gtgData.lastTestDate){
    reminderEl.innerHTML = '';
    labelEl.innerText = 'Noch kein Maximaltest eingetragen.';
  } else {
    const days = daysSince(gtgData.lastTestDate);
    labelEl.innerText = `Letzter Maximaltest: vor ${days} Tag${days===1?'':'en'}`;
    reminderEl.innerHTML = days >= 28
      ? '<div class="celebration" style="background:rgba(244,63,94,.12); border-color:rgba(244,63,94,.4); color:#fda4af;">📅 Zeit für einen neuen Maximaltest – seit 4+ Wochen nicht mehr getestet!</div>'
      : '';
  }
}

function saveGTGGoals(){
  GTG_EXERCISES.forEach(ex => {
    const target = parseInt(document.getElementById(`gtg-target-${ex.key}`).value);
    const max = parseInt(document.getElementById(`gtg-max-${ex.key}`).value);
    if(!isNaN(target) && target > 0) gtgData.targets[ex.key] = target;
    if(!isNaN(max) && max > 0) gtgData.maxes[ex.key] = max;
  });
  renderGTG();
}

function markGTGRetested(){
  gtgData.lastTestDate = getTodayKey();
  renderGTGGoals();
  saveGTGData();
}

function logGTGRound(exerciseKey){
  const today = getTodayKey();
  const reps = gtgData.targets[exerciseKey];
  gtgData.history[exerciseKey][today] = (gtgData.history[exerciseKey][today] || 0) + reps;
  renderGTG();
}

function logGTGCustom(exerciseKey){
  const input = document.getElementById(`gtg-custom-${exerciseKey}`);
  const reps = parseInt(input.value);
  if(isNaN(reps) || reps <= 0){
    alert('Bitte gib eine gültige Wiederholungszahl ein.');
    return;
  }
  const today = getTodayKey();
  gtgData.history[exerciseKey][today] = (gtgData.history[exerciseKey][today] || 0) + reps;
  input.value = '';
  renderGTG();
}

function renderGTGLog(){
  const today = getTodayKey();

  const statsHtml = GTG_EXERCISES.map(ex => {
    const todayReps = gtgData.history[ex.key][today] || 0;
    return `<div class="stat-box"><div class="num">${todayReps}</div><div class="label">${ex.name} heute</div></div>`;
  }).join('');
  document.getElementById('gtg-stats').innerHTML = statsHtml;

  const streak = computeStreak(gtgCombinedHistory());
  document.getElementById('gtg-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge" style="background:rgba(244,63,94,.12); color:#fda4af;">🔥 ${streak} Tag${streak===1?'':'e'} in Folge trainiert</div>`
    : '';

  document.getElementById('gtg-log-rows').innerHTML = GTG_EXERCISES.map(ex => {
    const todayReps = gtgData.history[ex.key][today] || 0;
    return `
      <div class="gtg-exercise-row">
        <span class="gtg-exercise-name">${ex.name}</span>
        <span class="gtg-today-total">Heute: ${todayReps} Wdh.</span>
        <button class="quick" onclick="logGTGRound('${ex.key}')">+ Runde (${gtgData.targets[ex.key]} Wdh.)</button>
        <input type="number" id="gtg-custom-${ex.key}" placeholder="eigene Anzahl">
        <button onclick="logGTGCustom('${ex.key}')">Hinzufügen</button>
      </div>
    `;
  }).join('');
}

function updateGTGChart(){
  const ctx = document.getElementById('gtgChart').getContext('2d');
  const windows = GTG_EXERCISES.map(ex => getChartWindow(gtgData.history[ex.key], gtgOffset));
  const labels = windows[0].labels;
  const rangeLabel = windows[0].rangeLabel;

  document.getElementById('gtg-range-label').innerText = rangeLabel;
  updateNavButtons('gtg-next-btn', gtgOffset);
  attachSwipe('gtg-chart-container', () => shiftGTGChart(1), () => shiftGTGChart(-1));

  const colors = ['#f43f5e', '#fb923c', '#facc15'];

  if(gtgChart) gtgChart.destroy();
  gtgChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets: GTG_EXERCISES.map((ex, i) => ({
        label: ex.name,
        data: windows[i].values,
        backgroundColor: colors[i],
        borderRadius:4
      }))
    },
    options: {
      ...chartOptions(),
      plugins:{ legend:{ display:true, position:'bottom', labels:{ color:'#94a3b8', boxWidth:12, font:{ size:11 } } } }
    }
  });
}

function shiftGTGChart(delta){
  gtgOffset = Math.max(0, Math.min(MAX_CHART_OFFSET, gtgOffset + delta));
  updateGTGChart();
}

/* ================= LERNEN (WR-Karteikasten + Mathe) ================= */
/* Leitner-System: richtig beantwortet -> höhere Box, längere Pause bis zur
   nächsten Wiederholung. Falsch -> zurück auf Box 1. */
const WR_BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };

function addDaysToKey(dateKeyStr, days){
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/* Wöchentliches WR-Ziel: diese Kalenderwoche (Mo-So) = 1 neue Karte/Tag,
   die Woche danach 2, danach 3, usw. - basierend auf dem Plan-Startdatum. */
function computeStudyWeekNumber(){
  const startMonday = getWeekKey(studyData.planStartDate);
  const todayMonday = getWeekKey(getTodayKey());
  const [sy, sm, sd] = startMonday.split('-').map(Number);
  const [ty, tm, td] = todayMonday.split('-').map(Number);
  const diffDays = Math.round((new Date(ty, tm-1, td) - new Date(sy, sm-1, sd)) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

function renderStudy(){
  renderStudyGoal();
  renderMath();
  renderWRDeck();
  saveStudyData();
}

function renderStudyGoal(){
  const weekNum = computeStudyWeekNumber();
  const goal = weekNum; // Woche 1 -> 1 Karte/Tag, Woche 2 -> 2, ...
  const todayKey = getTodayKey();
  const todayNew = studyData.wrNewCardsHistory[todayKey] || 0;
  const percent = Math.min(100, Math.round((todayNew / goal) * 100));

  document.getElementById('study-week-label').innerText = `Woche ${weekNum} deines Plans · Mathe bleibt konstant bei 1 Aufgabe/Tag`;
  document.getElementById('study-goal-stats').innerHTML = `
    <div class="stat-box"><div class="num">${todayNew} / ${goal}</div><div class="label">Neue WR-Karten heute</div></div>
    <div class="stat-box"><div class="num">${goal}</div><div class="label">Tagesziel diese Woche</div></div>
  `;
  document.getElementById('study-wr-progress-bar').style.width = percent + '%';
  document.getElementById('study-wr-progress-text').innerText = todayNew >= goal
    ? '🎉 Tagesziel erreicht!'
    : `${todayNew} / ${goal} neue Karten heute`;
}

function toggleMathToday(){
  const todayKey = getTodayKey();
  const checkbox = document.getElementById('math-today-check');
  if(checkbox.checked){
    studyData.mathHistory[todayKey] = true;
  } else {
    delete studyData.mathHistory[todayKey];
  }
  renderMath();
  saveStudyData();
}

function renderMath(){
  const todayKey = getTodayKey();
  document.getElementById('math-today-check').checked = !!studyData.mathHistory[todayKey];
  const streak = computeStreak(studyData.mathHistory);
  document.getElementById('math-streak-badge').innerHTML = streak > 0
    ? `<span class="streak-badge">🔥 ${streak} Tag${streak===1?'':'e'} in Folge</span>`
    : '';
}

function addFlashcard(){
  const input = document.getElementById('wr-card-title');
  const title = input.value.trim();
  if(!title) return;

  const todayKey = getTodayKey();
  studyData.wrCards.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    title,
    box: 1,
    nextReview: addDaysToKey(todayKey, 1), // erste Wiederholung morgen
    createdDate: todayKey
  });
  studyData.wrNewCardsHistory[todayKey] = (studyData.wrNewCardsHistory[todayKey] || 0) + 1;

  input.value = '';
  renderStudyGoal();
  renderWRDeck();
  saveStudyData();
}

function reviewCard(id, correct){
  const card = studyData.wrCards.find(c => c.id === id);
  if(!card) return;

  card.box = correct ? Math.min(5, card.box + 1) : 1;
  card.nextReview = addDaysToKey(getTodayKey(), WR_BOX_INTERVALS[card.box]);
  reviewedTodayIds.add(id);

  renderWRDeck();
  saveStudyData();
}

function renderWRDeck(){
  const todayKey = getTodayKey();
  const dueCards = studyData.wrCards
    .filter(c => c.nextReview <= todayKey && !reviewedTodayIds.has(c.id))
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview));

  const masteredCount = studyData.wrCards.filter(c => c.box === 5).length;

  document.getElementById('wr-deck-stats').innerHTML = `
    <div class="stat-box"><div class="num">${studyData.wrCards.length}</div><div class="label">Karten insgesamt</div></div>
    <div class="stat-box"><div class="num">${dueCards.length}</div><div class="label">Heute fällig</div></div>
    <div class="stat-box"><div class="num">${masteredCount}</div><div class="label">Gemeistert (Box 5)</div></div>
  `;

  const streak = computeStreak(studyData.wrNewCardsHistory);
  document.getElementById('wr-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge" style="background:rgba(34,197,94,.12); color:#86efac;">🔥 ${streak} Tag${streak===1?'':'e'} in Folge neue Karten geschrieben</div>`
    : '';

  const list = document.getElementById('wr-due-list');
  if(dueCards.length === 0){
    list.innerHTML = '<p class="empty-state">Keine Karten heute fällig 🎉</p>';
    return;
  }

  list.innerHTML = dueCards.map(card => `
    <div class="flashcard-item">
      <span class="flashcard-title">${card.title}</span>
      <span class="flashcard-box-badge">Box ${card.box}</span>
      <div class="flashcard-actions">
        <button class="flashcard-correct-btn" onclick="reviewCard('${card.id}', true)">Gewusst ✅</button>
        <button class="flashcard-wrong-btn" onclick="reviewCard('${card.id}', false)">Nochmal üben ❌</button>
      </div>
    </div>
  `).join('');
}

/* ================= Celebration & shared chart options ================= */
const lastPercent = { weight: -1, fahr: -1 };
function checkCelebration(key, percent){
  const milestones = [25, 50, 75, 100];
  const prev = lastPercent[key];
  const hit = milestones.find(m => percent >= m && prev < m);
  const el = document.getElementById(key + '-celebration');
  if(hit){
    const msg = hit === 100 ? '🎉 Geschafft! Du hast dein Ziel erreicht!' : `🎉 ${hit}% erreicht – weiter so!`;
    el.innerHTML = `<div class="celebration">${msg}</div>`;
  } else if(prev === -1) {
    el.innerHTML = '';
  }
  lastPercent[key] = percent;
}

function chartOptions(yMin){
  return {
    responsive:true,
    maintainAspectRatio:false,
    plugins:{ legend:{ display:false } },
    scales:{
      y:{
        grid:{ color:'#334155' },
        ticks:{ color:'#94a3b8' },
        beginAtZero: yMin === undefined,
        min: yMin
      },
      x:{
        grid:{ display:false },
        ticks:{ color:'#94a3b8', autoSkip:true, maxRotation:45, minRotation:0, maxTicksLimit:10 }
      }
    }
  };
}

/* ================= BACKUP-ERINNERUNG ================= */
function checkBackupReminder(){
  let referenceDate = localStorage.getItem('last-backup-date');
  if(!referenceDate){
    referenceDate = localStorage.getItem('first-use-date');
    if(!referenceDate){
      referenceDate = getTodayKey();
      localStorage.setItem('first-use-date', referenceDate);
    }
  }

  const days = daysSince(referenceDate);
  const banner = document.getElementById('backup-reminder-banner');
  if(days >= 7){
    banner.innerHTML = `
      <span>⚠️ Du hast seit ${days} Tagen kein Backup gemacht – deine Daten liegen nur in diesem Browser.</span>
      <span style="display:flex; gap:8px;">
        <button onclick="exportBackup()">Jetzt sichern</button>
        <button class="dismiss-btn" onclick="dismissBackupReminder()">Später</button>
      </span>
    `;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function dismissBackupReminder(){
  document.getElementById('backup-reminder-banner').style.display = 'none';
}

/* ================= BACKUP (Export / Import) ================= */
const BACKUP_KEYS = ['books-data', 'weight-data', 'fahr-data', 'todo-data', 'general-todo-data', 'recurring-todo-data', 'habits-data', 'sleep-data', 'gtg-data', 'study-data', 'goals-data'];

function showBackupStatus(msg, isError){
  const el = document.getElementById('backup-status');
  el.textContent = msg;
  el.classList.toggle('success', !isError);
  el.classList.toggle('error', !!isError);
  setTimeout(() => { el.textContent = ''; el.classList.remove('success','error'); }, 5000);
}

function exportBackup(){
  try{
    const backup = { exportedAt: new Date().toISOString(), data: {} };
    BACKUP_KEYS.forEach(key => {
      const raw = localStorage.getItem(key);
      if(raw !== null) backup.data[key] = JSON.parse(raw);
    });

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = getTodayKey();
    a.href = url;
    a.download = `ferien-tracker-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showBackupStatus('✅ Backup wurde heruntergeladen.', false);
    localStorage.setItem('last-backup-date', getTodayKey());
    checkBackupReminder();
  } catch(e){
    console.error('Backup-Export fehlgeschlagen', e);
    showBackupStatus('❌ Backup konnte nicht erstellt werden.', true);
  }
}

function importBackup(event){
  const file = event.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      const data = parsed.data || parsed; // auch ältere/rohe Exporte akzeptieren

      if(!confirm('Vorhandene Daten in diesem Browser werden mit dem Backup überschrieben. Fortfahren?')){
        event.target.value = '';
        return;
      }

      BACKUP_KEYS.forEach(key => {
        if(data[key] !== undefined){
          localStorage.setItem(key, JSON.stringify(data[key]));
        }
      });

      localStorage.setItem('last-backup-date', getTodayKey());
      loadAll();
      showBackupStatus('✅ Backup wurde wiederhergestellt.', false);
    } catch(e){
      console.error('Backup-Import fehlgeschlagen', e);
      showBackupStatus('❌ Diese Datei konnte nicht gelesen werden.', true);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ---------- Init ---------- */
document.getElementById('weight-date').value = getTodayKey();
document.getElementById('sleep-date').value = getTodayKey();
loadAll();
