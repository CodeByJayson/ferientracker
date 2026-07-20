/* ---------- State ---------- */
let books = [];
let readingHistory = {};
let weightData = { start: null, goal: null, entries: [] };
let fahrData = { total: 1074, done: 0, history: {} };
let todosData = {}; // { "YYYY-MM-DD": [{ id, text, done }] }
let generalTodos = []; // [{ id, text, done }] - Gesamtübersicht, unabhängig vom Kalender
let habitsData = { good: [], bad: [] };
// good: [{ id, name, history: {date:true} }]
// bad:  [{ id, name, startDate, lastRelapse, best }]
let focusData = { history: {} };         // { "YYYY-MM-DD": totalMinutes }
let gameData = { budget: 60, history: {} }; // { "YYYY-MM-DD": minutesPlayed }

const FOCUS_DURATION_SEC = 25 * 60;
const BREAK_DURATION_SEC = 5 * 60;

let timerRunning = false;
let timerPhase = 'focus'; // 'focus' | 'break'
let remainingSeconds = FOCUS_DURATION_SEC;
let focusSecondsThisPhase = 0; // actual elapsed focus seconds in current focus phase
let timerIntervalId = null;

let focusChart = null;
let gameChart = null;

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
let focusOffset = 0;
let gameOffset = 0;

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
    const h = localStorage.getItem('habits-data');
    if(h){ habitsData = JSON.parse(h); }
  } catch(e){ console.error('Konnte Habit-Daten nicht laden', e); }

  try{
    const fo = localStorage.getItem('focus-data');
    if(fo){ focusData = JSON.parse(fo); }
  } catch(e){ console.error('Konnte Fokus-Daten nicht laden', e); }

  try{
    const g = localStorage.getItem('game-data');
    if(g){ gameData = JSON.parse(g); }
  } catch(e){ console.error('Konnte Zocken-Daten nicht laden', e); }

  document.getElementById('loading-note').style.display = 'none';
  autoApplyMissedJokers();
  checkBackupReminder();
  renderBooks();
  renderWeight();
  renderFahr();
  renderTodo();
  renderGeneralTodos();
  renderHabits();
  renderFocus();
  renderGame();
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
function saveHabitsData(){
  try{ localStorage.setItem('habits-data', JSON.stringify(habitsData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Habits)', e); }
}
function saveFocusData(){
  try{ localStorage.setItem('focus-data', JSON.stringify(focusData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Fokus)', e); }
}
function saveGameData(){
  try{ localStorage.setItem('game-data', JSON.stringify(gameData)); }
  catch(e){ console.error('Speichern fehlgeschlagen (Zocken)', e); }
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
  weightChart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{
      label:'Gewicht (kg)', data: values,
      borderColor:'#ec4899', backgroundColor:'rgba(236,72,153,.1)',
      borderWidth:3, fill:true, tension:.3,
      pointBackgroundColor:'#f9a8d4', pointRadius:3
    }]},
    options: chartOptions()
  });
}

function shiftWeightChart(delta){
  const allEntries = weightData.entries;
  const maxOffset = Math.max(0, Math.ceil(allEntries.length / CHART_WINDOW_SIZE) - 1);
  weightOffset = Math.max(0, Math.min(maxOffset, weightOffset + delta));
  updateWeightChart();
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
    const hasItems = items.length > 0;
    const allDone = hasItems && items.every(t => t.done);

    let classes = 'calendar-day';
    if(key === todayKey) classes += ' today';
    if(key === selectedDate) classes += ' selected';
    if(allDone) classes += ' done-dot';

    grid.insertAdjacentHTML('beforeend', `
      <div class="${classes}" onclick="selectDay('${key}')">
        ${d}
        ${hasItems ? '<span class="dot"></span>' : ''}
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
      <button class="delete-btn" onclick="deleteTodo('${item.id}')">Löschen</button>
    </div>
  `).join('');
}

function addTodo(){
  const input = document.getElementById('todo-text');
  const text = input.value.trim();
  if(!text) return;

  if(!todosData[selectedDate]) todosData[selectedDate] = [];
  todosData[selectedDate].push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), text, done: false });
  input.value = '';
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
  todosData[selectedDate] = items.filter(t => t.id !== id);
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
        <span class="habit-streak">🔥 ${streak} Tag${streak===1?'':'e'}</span>
        <span class="habit-stat">🏆 Rekord: <b>${h.best}</b></span>
        <button class="joker-btn" onclick="useJoker('${h.id}')" ${jokerAvailable ? '' : 'disabled'} title="1x pro Woche einen Tag aussetzen, ohne den Streak zu verlieren">Joker</button>
        <button class="edit-btn" onclick="startEditGoodHabit('${h.id}')">Bearbeiten</button>
        <button class="delete-btn" onclick="deleteGoodHabit('${h.id}')">Löschen</button>
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
        <span class="habit-stat"><b>${streak}</b> Tag${streak===1?'':'e'} sauber</span>
        <span class="habit-stat">🏆 Rekord: <b>${h.best}</b></span>
        <button class="relapse-btn" onclick="reportRelapse('${h.id}')">Rückfall melden</button>
        <button class="edit-btn" onclick="startEditBadHabit('${h.id}')">Bearbeiten</button>
        <button class="delete-btn" onclick="deleteBadHabit('${h.id}')">Löschen</button>
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

/* ================= POMODORO FOKUS-TIMER (25 / 5) ================= */
function formatTimer(totalSeconds){
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function updateTimerUI(){
  const display = document.getElementById('focus-timer-display');
  const label = document.getElementById('focus-phase-label');
  display.innerText = formatTimer(remainingSeconds);
  label.innerText = timerPhase === 'focus' ? 'Fokus' : 'Pause';
  display.classList.toggle('break', timerPhase === 'break');
  label.classList.toggle('break', timerPhase === 'break');
}

function showPhaseBanner(msg){
  const el = document.getElementById('focus-phase-banner');
  el.innerHTML = `<div class="celebration">${msg}</div>`;
}

function tickTimer(){
  remainingSeconds--;
  if(timerPhase === 'focus') focusSecondsThisPhase++;

  if(remainingSeconds <= 0){
    completeFocusPhase();
  } else {
    updateTimerUI();
  }
}

function completeFocusPhase(){
  if(timerPhase === 'focus'){
    logFocusMinutes(25);
    showPhaseBanner('🎉 25 Minuten Fokus geschafft! Zeit für 5 Minuten Pause.');
    timerPhase = 'break';
    remainingSeconds = BREAK_DURATION_SEC;
  } else {
    showPhaseBanner('✅ Pause vorbei! Nächster Fokus-Block startet.');
    timerPhase = 'focus';
    remainingSeconds = FOCUS_DURATION_SEC;
    focusSecondsThisPhase = 0;
  }
  updateTimerUI();
}

function toggleFocusTimer(){
  const btn = document.getElementById('focus-timer-btn');
  if(!timerRunning){
    timerRunning = true;
    btn.innerText = 'Pause';
    timerIntervalId = setInterval(tickTimer, 1000);
  } else {
    timerRunning = false;
    btn.innerText = 'Weiter';
    clearInterval(timerIntervalId);
  }
}

function skipFocusPhase(){
  clearInterval(timerIntervalId);
  timerRunning = false;
  document.getElementById('focus-timer-btn').innerText = 'Start';

  if(timerPhase === 'focus'){
    const minutes = Math.round(focusSecondsThisPhase / 60);
    if(minutes > 0) logFocusMinutes(minutes);
    showPhaseBanner('⏭️ Fokus übersprungen. Zeit für 5 Minuten Pause.');
    timerPhase = 'break';
    remainingSeconds = BREAK_DURATION_SEC;
  } else {
    showPhaseBanner('⏭️ Pause übersprungen. Nächster Fokus-Block startet.');
    timerPhase = 'focus';
    remainingSeconds = FOCUS_DURATION_SEC;
    focusSecondsThisPhase = 0;
  }
  updateTimerUI();
}

function resetFocusTimer(){
  clearInterval(timerIntervalId);
  timerRunning = false;
  document.getElementById('focus-timer-btn').innerText = 'Start';

  if(timerPhase === 'focus' && focusSecondsThisPhase >= 30){
    const minutes = Math.round(focusSecondsThisPhase / 60);
    logFocusMinutes(minutes);
  }

  timerPhase = 'focus';
  remainingSeconds = FOCUS_DURATION_SEC;
  focusSecondsThisPhase = 0;
  document.getElementById('focus-phase-banner').innerHTML = '';
  updateTimerUI();
}

function logFocusMinutes(n){
  const today = getTodayKey();
  focusData.history[today] = (focusData.history[today] || 0) + n;
  renderFocus();
}

function addFocusManual(){
  const input = document.getElementById('focus-manual-minutes');
  const n = parseInt(input.value);
  if(isNaN(n) || n <= 0){
    alert('Bitte gib eine gültige Minutenzahl ein.');
    return;
  }
  logFocusMinutes(n);
  input.value = '';
}

function renderFocus(){
  const todayKey = getTodayKey();
  const todayMinutes = focusData.history[todayKey] || 0;
  const weekTotal = sumLastNDays(focusData.history, 7);
  const streak = computeStreak(focusData.history);

  document.getElementById('focus-stats').innerHTML = `
    <div class="stat-box"><div class="num">${todayMinutes} Min</div><div class="label">Heute</div></div>
    <div class="stat-box"><div class="num">${weekTotal} Min</div><div class="label">Letzte 7 Tage</div></div>
  `;

  document.getElementById('focus-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge" style="background:rgba(14,165,233,.12); color:#7dd3fc;">🔥 ${streak} Tag${streak===1?'':'e'} in Folge fokussiert</div>`
    : '';

  updateFocusChart();
  saveFocusData();
}

function updateFocusChart(){
  const ctx = document.getElementById('focusChart').getContext('2d');
  const { labels, values, rangeLabel } = getChartWindow(focusData.history, focusOffset);
  document.getElementById('focus-range-label').innerText = rangeLabel;
  updateNavButtons('focus-next-btn', focusOffset);
  attachSwipe('focus-chart-container', () => shiftFocusChart(1), () => shiftFocusChart(-1));
  if(focusChart) focusChart.destroy();
  focusChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{
      label:'Fokus-Minuten', data: values,
      backgroundColor:'rgba(14,165,233,.6)',
      borderColor:'#0ea5e9', borderWidth:1, borderRadius:6
    }]},
    options: chartOptions()
  });
}

function shiftFocusChart(delta){
  focusOffset = Math.max(0, Math.min(MAX_CHART_OFFSET, focusOffset + delta));
  updateFocusChart();
}

/* ================= ZOCKEN-ZEITBUDGET ================= */
function computeBudgetStreak(history, budget){
  let streak = 0;
  let cursor = new Date();

  // Wir holen uns alle vorhandenen Tage aus der Historie
  const historyKeys = Object.keys(history);
  if (historyKeys.length === 0) return 0; // Falls die Historie leer ist, direkt 0 zurückgeben

  while(true){
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;

    // WICHTIG: Prüfen, ob für diesen Tag überhaupt Daten existieren
    if (!(key in history)) {
      // Wenn es den Tag in der Historie nicht gibt, brechen wir ab,
      // anstatt unendlich weit in die Vergangenheit zu rechnen.
      break;
    }

    const val = history[key];

    if(val <= budget){
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break; // Budget überschritten -> Streak vorbei
    }
  }
  return streak;
}

function saveGameBudget(){
  const budget = parseInt(document.getElementById('game-budget').value);
  if(isNaN(budget) || budget <= 0){
    alert('Bitte gib ein gültiges Tageslimit ein.');
    return;
  }
  gameData.budget = budget;
  renderGame();
}

function addGameMinutes(n){
  const today = getTodayKey();
  gameData.history[today] = (gameData.history[today] || 0) + n;
  renderGame();
}

function addGameCustom(){
  const input = document.getElementById('game-custom');
  const n = parseInt(input.value);
  if(isNaN(n) || n <= 0){
    alert('Bitte gib eine gültige Minutenzahl ein.');
    return;
  }
  addGameMinutes(n);
  input.value = '';
}

function renderGame(){
  document.getElementById('game-budget').value = gameData.budget;

  const todayKey = getTodayKey();
  const playedToday = gameData.history[todayKey] || 0;
  const percent = gameData.budget > 0 ? Math.round((playedToday / gameData.budget) * 100) : 0;
  const remaining = gameData.budget - playedToday;

  document.getElementById('game-stats').innerHTML = `
    <div class="stat-box"><div class="num">${playedToday} Min</div><div class="label">Heute gespielt</div></div>
    <div class="stat-box"><div class="num">${gameData.budget} Min</div><div class="label">Tageslimit</div></div>
    <div class="stat-box"><div class="num">${remaining >= 0 ? remaining : Math.abs(remaining)} Min</div><div class="label">${remaining >= 0 ? 'Übrig' : 'Über Limit'}</div></div>
  `;

  const bar = document.getElementById('game-progress-bar');
  bar.style.width = Math.min(percent, 100) + '%';
  bar.classList.toggle('over-budget', percent > 100);
  document.getElementById('game-progress-text').innerText = percent > 100
    ? `${percent}% des Limits – heute drüber`
    : `${percent}% des Tageslimits genutzt`;

  const streak = computeBudgetStreak(gameData.history, gameData.budget);
  document.getElementById('game-streak-badge').innerHTML = streak > 0
    ? `<div class="streak-badge" style="background:rgba(14,165,233,.12); color:#7dd3fc;">🔥 ${streak} Tag${streak===1?'':'e'} im Limit geblieben</div>`
    : '';

  updateGameChart();
  saveGameData();
}

function updateGameChart(){
  const ctx = document.getElementById('gameChart').getContext('2d');
  const { labels, values, rangeLabel } = getChartWindow(gameData.history, gameOffset);
  document.getElementById('game-range-label').innerText = rangeLabel;
  updateNavButtons('game-next-btn', gameOffset);
  attachSwipe('game-chart-container', () => shiftGameChart(1), () => shiftGameChart(-1));
  const colors = values.map(v => v > gameData.budget ? 'rgba(239,68,68,.7)' : 'rgba(14,165,233,.6)');
  if(gameChart) gameChart.destroy();
  gameChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{
      label:'Gezockte Minuten', data: values,
      backgroundColor: colors,
      borderColor:'#0ea5e9', borderWidth:1, borderRadius:6
    }]},
    options: chartOptions()
  });
}

function shiftGameChart(delta){
  gameOffset = Math.max(0, Math.min(MAX_CHART_OFFSET, gameOffset + delta));
  updateGameChart();
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

function chartOptions(){
  return {
    responsive:true,
    maintainAspectRatio:false,
    plugins:{ legend:{ display:false } },
    scales:{
      y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8' }, beginAtZero:true },
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
const BACKUP_KEYS = ['books-data', 'weight-data', 'fahr-data', 'todo-data', 'general-todo-data', 'habits-data', 'focus-data', 'game-data'];

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
updateTimerUI();
loadAll();
