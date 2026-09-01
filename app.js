import { initializeApp as initializeFirebaseApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYlCfmzswHtDgv4f79IijxHXXD1VxxPMs",
  authDomain: "lessonflow-tutor.firebaseapp.com",
  projectId: "lessonflow-tutor",
  storageBucket: "lessonflow-tutor.firebasestorage.app",
  messagingSenderId: "1099018800716",
  appId: "1:1099018800716:web:8ce475f656f12f81a86ee9",
};

const firebaseApp = initializeFirebaseApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const STORAGE_KEY = "lessonflow-data-v1";
const LAST_USER_KEY = "lessonflow-last-user";

const defaultState = {
  version: 1,
  students: [],
  lessons: [],
  settings: { tutorName: "" },
};

let state = loadState();
let currentView = "today";
let selectedWeekStart = startOfWeek(new Date());
let pendingLessonAfterStudent = false;
let toastTimer;
let syncTimer;
let currentUser = null;
let cloudReady = false;
let unsubscribeCloud = null;
let lastSyncedState = "";
let authMode = "login";

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  pageTitle: document.querySelector("#pageTitle"),
  statsGrid: document.querySelector("#statsGrid"),
  todayLessons: document.querySelector("#todayLessons"),
  nextLesson: document.querySelector("#nextLesson"),
  weekPreview: document.querySelector("#weekPreview"),
  previewWeekRange: document.querySelector("#previewWeekRange"),
  calendarTitle: document.querySelector("#calendarTitle"),
  weekCalendar: document.querySelector("#weekCalendar"),
  studentsList: document.querySelector("#studentsList"),
  studentSearch: document.querySelector("#studentSearch"),
  tutorNameInput: document.querySelector("#tutorNameInput"),
  lessonDialog: document.querySelector("#lessonDialog"),
  lessonForm: document.querySelector("#lessonForm"),
  lessonStudentOptions: document.querySelector("#lessonStudentOptions"),
  lessonModalTitle: document.querySelector("#lessonModalTitle"),
  deleteLessonButton: document.querySelector("#deleteLessonButton"),
  noStudentsHint: document.querySelector("#noStudentsHint"),
  studentDialog: document.querySelector("#studentDialog"),
  studentForm: document.querySelector("#studentForm"),
  studentModalTitle: document.querySelector("#studentModalTitle"),
  deleteStudentButton: document.querySelector("#deleteStudentButton"),
  toast: document.querySelector("#toast"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authTitle: document.querySelector("#authTitle"),
  authKicker: document.querySelector("#authKicker"),
  authDescription: document.querySelector("#authDescription"),
  authMessage: document.querySelector("#authMessage"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  toggleAuthModeButton: document.querySelector("#toggleAuthModeButton"),
  forgotPasswordButton: document.querySelector("#forgotPasswordButton"),
  syncStatus: document.querySelector("#syncStatus"),
  accountEmail: document.querySelector("#accountEmail"),
};

const viewTitles = {
  today: () => greeting(),
  week: () => "Расписание занятий",
  students: () => "Мои ученики",
  settings: () => "Настройки",
};

const statusLabels = {
  planned: "Запланировано",
  completed: "Проведено",
  cancelled: "Отменено",
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.students) || !Array.isArray(saved.lessons)) {
      return structuredClone(defaultState);
    }
    return {
      ...structuredClone(defaultState),
      ...saved,
      settings: { ...defaultState.settings, ...(saved.settings || {}) },
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (cloudReady && currentUser) scheduleCloudSave();
}

function scheduleCloudSave() {
  clearTimeout(syncTimer);
  updateSyncStatus("Сохранение…", "saving");
  syncTimer = setTimeout(syncCloudState, 350);
}

async function syncCloudState() {
  if (!cloudReady || !currentUser) return;
  const serialized = JSON.stringify(state);
  try {
    await setDoc(
      doc(db, "users", currentUser.uid),
      { payload: state, updatedAt: serverTimestamp() },
      { merge: true },
    );
    lastSyncedState = serialized;
    updateSyncStatus("Синхронизировано", "synced");
  } catch (error) {
    console.error("Cloud sync failed", error);
    updateSyncStatus("Нет соединения", "error");
  }
}

function updateSyncStatus(text, mode = "saving") {
  if (!els.syncStatus) return;
  els.syncStatus.classList.remove("synced", "error");
  if (mode === "synced") els.syncStatus.classList.add("synced");
  if (mode === "error") els.syncStatus.classList.add("error");
  els.syncStatus.querySelector("span").textContent = text;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function isSameDate(a, b) {
  return toISODate(a) === toISODate(b);
}

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0) + " ₽";
}

function formatWeekRange(start) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString("ru-RU", { month: "long" })}`;
  }
  return `${start.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
}

function greeting() {
  const hour = new Date().getHours();
  const base = hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  return state.settings.tutorName ? `${base}, ${state.settings.tutorName}!` : `${base}!`;
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getStudent(studentId) {
  return state.students.find((student) => student.id === studentId);
}

function lessonStudentIds(lesson) {
  if (Array.isArray(lesson?.studentIds) && lesson.studentIds.length) return [...new Set(lesson.studentIds.filter(Boolean))];
  return lesson?.studentId ? [lesson.studentId] : [];
}

function getLessonStudents(lesson) {
  return lessonStudentIds(lesson).map(getStudent).filter(Boolean);
}

function lessonStudentNames(lesson, fallback = "Ученик") {
  const names = getLessonStudents(lesson).map((student) => student.name);
  return names.length ? names.join(", ") : fallback;
}

function sortedLessons(lessons) {
  return [...lessons].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

function lessonsForDate(date) {
  const iso = typeof date === "string" ? date : toISODate(date);
  return sortedLessons(state.lessons.filter((lesson) => lesson.date === iso));
}

function lessonsForWeek(start = selectedWeekStart) {
  const first = toISODate(start);
  const last = toISODate(addDays(start, 6));
  return sortedLessons(state.lessons.filter((lesson) => lesson.date >= first && lesson.date <= last));
}

function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2700);
}

function showView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.pageTitle.textContent = viewTitles[view]();
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function render() {
  const now = new Date();
  els.todayLabel.textContent = now.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  els.pageTitle.textContent = viewTitles[currentView]();
  renderStats();
  renderTodayLessons();
  renderNextLesson();
  renderWeekPreview();
  renderWeekCalendar();
  renderStudents();
  renderSettings();
}

function renderStats() {
  const today = lessonsForDate(new Date()).filter((lesson) => lesson.status !== "cancelled");
  const actualWeek = lessonsForWeek(startOfWeek(new Date()));
  const activeWeek = actualWeek.filter((lesson) => lesson.status !== "cancelled");
  const income = activeWeek.reduce((sum, lesson) => sum + (Number(lesson.rate) || 0), 0);
  const unpaid = state.lessons.filter((lesson) => lesson.status === "completed" && !lesson.paid).length;
  const completed = actualWeek.filter((lesson) => lesson.status === "completed").length;

  const cards = [
    { label: "Занятий сегодня", value: today.length, note: today.length ? "по плану на сегодня" : "свободный день", soft: "var(--green-soft)" },
    { label: "На этой неделе", value: activeWeek.length, note: `${completed} уже проведено`, soft: "var(--blue-soft)" },
    { label: "Доход за неделю", value: formatMoney(income), note: "без отменённых занятий", soft: "var(--gold-soft)" },
    { label: "Ждут оплаты", value: unpaid, note: unpaid ? "проведённых занятий" : "всё оплачено", soft: "var(--peach-soft)" },
  ];

  els.statsGrid.innerHTML = cards
    .map(
      (card) => `<article class="stat-card" style="--stat-soft:${card.soft}">
        <span class="stat-label">${card.label}</span>
        <strong class="stat-value">${card.value}</strong>
        <small class="stat-note">${card.note}</small>
      </article>`,
    )
    .join("");
}

function lessonCard(lesson) {
  const studentName = lessonStudentNames(lesson, "Удалённый ученик");
  const topic = lesson.topic || "Английский язык";
  return `<article class="lesson-card" data-lesson-id="${lesson.id}" tabindex="0" role="button" aria-label="Открыть занятие с ${escapeHTML(studentName)}">
    <div class="lesson-time">${escapeHTML(lesson.time)}<small>${lesson.duration} мин</small></div>
    <span class="lesson-accent" style="background:${lesson.status === "cancelled" ? "var(--red)" : lesson.status === "completed" ? "var(--blue)" : "var(--green)"}"></span>
    <div class="lesson-main">
      <strong>${escapeHTML(studentName)}</strong>
      <span>${escapeHTML(topic)} · ${escapeHTML(lesson.format)}</span>
    </div>
    <div class="lesson-side">
      <span class="status-pill status-${lesson.status}">${statusLabels[lesson.status]}</span>
      <span class="payment-pill ${lesson.paid ? "payment-paid" : "payment-unpaid"}">${lesson.paid ? "✓ оплачено" : "не оплачено"}</span>
    </div>
  </article>`;
}

function emptyState({ icon = "▦", title, text, action = "", actionLabel = "" }) {
  return `<div class="empty-state">
    <div>
      <span class="empty-icon">${icon}</span>
      <h3>${title}</h3>
      <p>${text}</p>
      ${action ? `<button class="primary-button" data-empty-action="${action}">${actionLabel}</button>` : ""}
    </div>
  </div>`;
}

function renderTodayLessons() {
  const lessons = lessonsForDate(new Date());
  els.todayLessons.innerHTML = lessons.length
    ? lessons.map(lessonCard).join("")
    : emptyState({
        title: "На сегодня занятий нет",
        text: "Можно отдохнуть или добавить новое занятие в расписание.",
        action: "lesson",
        actionLabel: "Добавить занятие",
      });
}

function renderNextLesson() {
  const now = new Date();
  const next = sortedLessons(state.lessons).find((lesson) => {
    const lessonDate = new Date(`${lesson.date}T${lesson.time}:00`);
    return lesson.status !== "cancelled" && lessonDate >= now;
  });

  if (!next) {
    els.nextLesson.innerHTML = `<div class="empty-state compact"><div><span class="empty-icon">→</span><h3>Пока пусто</h3><p>Добавьте занятие — оно появится здесь.</p></div></div>`;
    return;
  }

  const studentNames = lessonStudentNames(next);
  const date = parseLocalDate(next.date);
  const dateLabel = isSameDate(date, now)
    ? "Сегодня"
    : date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  els.nextLesson.innerHTML = `<article class="next-lesson-card" data-lesson-id="${next.id}" role="button" tabindex="0">
    <span class="countdown">${dateLabel}, ${escapeHTML(next.time)}</span>
    <h3>${escapeHTML(studentNames)}</h3>
    <p>${escapeHTML(next.topic || "Английский язык")}</p>
    <div class="next-lesson-meta">
      <span>Формат<strong>${escapeHTML(next.format)}</strong></span>
      <span>Длительность<strong>${next.duration} минут</strong></span>
    </div>
  </article>`;
}

function renderWeekPreview() {
  const today = new Date();
  els.previewWeekRange.textContent = formatWeekRange(selectedWeekStart);
  els.weekPreview.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    const lessons = lessonsForDate(date).filter((lesson) => lesson.status !== "cancelled");
    const dots = Array.from({ length: Math.min(lessons.length, 5) }, () => "<i></i>").join("");
    return `<button class="day-tile ${isSameDate(date, today) ? "today" : ""}" data-date="${toISODate(date)}">
      <span class="day-name">${date.toLocaleDateString("ru-RU", { weekday: "short" })}</span>
      <strong class="day-number">${date.getDate()}</strong>
      <span class="day-load">${dots}</span>
      <small>${lessons.length ? `${lessons.length} ${plural(lessons.length, ["урок", "урока", "уроков"])}` : "Свободно"}</small>
    </button>`;
  }).join("");
}

function renderWeekCalendar() {
  const today = new Date();
  els.calendarTitle.textContent = formatWeekRange(selectedWeekStart);
  els.weekCalendar.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    const lessons = lessonsForDate(date);
    const lessonsHTML = lessons.length
      ? lessons.map((lesson) => {
          const studentNames = lessonStudentNames(lesson);
          return `<article class="calendar-lesson ${lesson.status}" data-lesson-id="${lesson.id}" tabindex="0" role="button">
            <time>${escapeHTML(lesson.time)} · ${lesson.duration} мин</time>
            <strong>${escapeHTML(studentNames)}</strong>
            <small>${escapeHTML(lesson.topic || lesson.format)}</small>
          </article>`;
        }).join("")
      : `<button class="calendar-empty-add" data-add-date="${toISODate(date)}">＋ Добавить</button>`;

    return `<section class="calendar-day ${isSameDate(date, today) ? "today" : ""}">
      <header class="calendar-day-header">
        <span>${date.toLocaleDateString("ru-RU", { weekday: "short" })}</span>
        <strong>${date.getDate()}</strong>
      </header>
      <div class="calendar-lessons">${lessonsHTML}</div>
    </section>`;
  }).join("");
}

function renderStudents() {
  const query = (els.studentSearch?.value || "").trim().toLowerCase();
  const students = [...state.students]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .filter((student) => `${student.name} ${student.contact || ""} ${student.goal || ""} ${student.age || ""} ${student.level || ""}`.toLowerCase().includes(query));

  if (!students.length) {
    els.studentsList.innerHTML = emptyState({
      icon: "♙",
      title: query ? "Ничего не найдено" : "Добавьте первого ученика",
      text: query ? "Попробуйте изменить запрос." : "Сохраните имя, контакт и стоимость урока — всё будет в одном месте.",
      action: query ? "" : "student",
      actionLabel: "Добавить ученика",
    });
    return;
  }

  els.studentsList.innerHTML = students.map((student) => {
    const lessons = state.lessons.filter((lesson) => lessonStudentIds(lesson).includes(student.id));
    const completed = lessons.filter((lesson) => lesson.status === "completed").length;
    const next = sortedLessons(lessons).find((lesson) => lesson.status !== "cancelled" && new Date(`${lesson.date}T${lesson.time}:00`) >= new Date());
    const profile = [
      student.age ? `${student.age} ${plural(student.age, ["год", "года", "лет"])}` : "",
      student.level && student.level !== "Не указан" ? student.level : "",
    ].filter(Boolean).join(" · ") || "Профиль не заполнен";
    return `<article class="student-card" data-student-id="${student.id}" tabindex="0" role="button">
      <div class="student-top">
        <span class="student-avatar">${escapeHTML(initials(student.name))}</span>
        <div><h3>${escapeHTML(student.name)}</h3><p>${escapeHTML(profile)}</p></div>
      </div>
      <span class="student-goal">${escapeHTML(student.goal || "Цель не указана")}</span>
      <div class="student-meta">
        <div><span>Проведено</span><strong>${completed} ${plural(completed, ["урок", "урока", "уроков"])}</strong></div>
        <div><span>Следующий</span><strong>${next ? `${formatShortDate(next.date)}, ${next.time}` : "Не назначен"}</strong></div>
      </div>
      <p class="student-contact">${escapeHTML(student.contact || "Контакт не указан")} ${student.rate ? ` · ${formatMoney(student.rate)}` : ""}</p>
    </article>`;
  }).join("");
}

function renderSettings() {
  els.tutorNameInput.value = state.settings.tutorName || "";
  els.accountEmail.textContent = currentUser?.email || "—";
}

function plural(number, forms) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function formatShortDate(iso) {
  return parseLocalDate(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function updateStudentOptions(selectedIds = []) {
  const sorted = [...state.students].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : selectedIds ? [selectedIds] : []);
  els.lessonStudentOptions.innerHTML = sorted.length
    ? sorted.map((student) => `<label class="student-choice">
        <input name="studentIds" type="checkbox" value="${escapeHTML(student.id)}" ${selected.has(student.id) ? "checked" : ""} />
        <span>${escapeHTML(student.name)}</span>
      </label>`).join("")
    : `<span class="student-options-empty">Нет учеников</span>`;
  els.noStudentsHint.classList.toggle("visible", !sorted.length);
  els.lessonForm.querySelector('[type="submit"]').disabled = !sorted.length;
}

function openLessonDialog(lessonId = "", presetDate = "") {
  if (!state.students.length) {
    pendingLessonAfterStudent = true;
    showView("students");
    openStudentDialog();
    showToast("Сначала добавьте ученика");
    return;
  }

  const lesson = state.lessons.find((item) => item.id === lessonId);
  els.lessonForm.reset();
  els.lessonModalTitle.textContent = lesson ? "Редактировать занятие" : "Новое занятие";
  els.deleteLessonButton.classList.toggle("hidden", !lesson);
  els.lessonForm.elements.lessonId.value = lesson?.id || "";
  updateStudentOptions(lessonStudentIds(lesson));
  els.lessonForm.elements.date.value = lesson?.date || presetDate || toISODate(new Date());
  els.lessonForm.elements.time.value = lesson?.time || "15:00";
  els.lessonForm.elements.duration.value = String(lesson?.duration || 60);
  els.lessonForm.elements.format.value = lesson?.format || "Онлайн";
  els.lessonForm.elements.topic.value = lesson?.topic || "";
  els.lessonForm.elements.rate.value = lesson?.rate || "";
  els.lessonForm.elements.status.value = lesson?.status || "planned";
  els.lessonForm.elements.paid.checked = Boolean(lesson?.paid);
  els.lessonForm.elements.repeat.checked = false;
  els.lessonForm.elements.notes.value = lesson?.notes || "";
  els.lessonDialog.showModal();
}

function openStudentDialog(studentId = "") {
  const student = state.students.find((item) => item.id === studentId);
  els.studentForm.reset();
  els.studentModalTitle.textContent = student ? "Редактировать ученика" : "Новый ученик";
  els.deleteStudentButton.classList.toggle("hidden", !student);
  els.studentForm.elements.studentId.value = student?.id || "";
  els.studentForm.elements.name.value = student?.name || "";
  els.studentForm.elements.goal.value = student?.goal || "Не указана";
  els.studentForm.elements.age.value = student?.age || "";
  els.studentForm.elements.level.value = student?.level || "Не указан";
  els.studentForm.elements.rate.value = student?.rate || "";
  els.studentForm.elements.contact.value = student?.contact || "";
  els.studentForm.elements.notes.value = student?.notes || "";
  els.studentDialog.showModal();
}

function handleLessonSubmit(event) {
  event.preventDefault();
  const form = new FormData(els.lessonForm);
  const existingId = form.get("lessonId");
  const studentIds = form.getAll("studentIds").filter(Boolean);
  if (!studentIds.length) {
    showToast("Выберите хотя бы одного ученика");
    return;
  }
  const students = studentIds.map(getStudent).filter(Boolean);
  const lesson = {
    id: existingId || uid("lesson"),
    studentId: studentIds[0],
    studentIds,
    date: form.get("date"),
    time: form.get("time"),
    duration: Number(form.get("duration")) || 60,
    format: form.get("format"),
    topic: form.get("topic").trim(),
    rate: Number(form.get("rate")) || students.reduce((sum, student) => sum + (Number(student.rate) || 0), 0),
    status: form.get("status"),
    paid: form.get("paid") === "on",
    notes: form.get("notes").trim(),
  };

  if (existingId) {
    state.lessons = state.lessons.map((item) => (item.id === existingId ? lesson : item));
  } else {
    state.lessons.push(lesson);
    if (form.get("repeat") === "on") {
      for (let week = 1; week <= 4; week += 1) {
        state.lessons.push({ ...lesson, id: uid("lesson"), date: toISODate(addDays(parseLocalDate(lesson.date), week * 7)) });
      }
    }
  }

  saveState();
  els.lessonDialog.close();
  render();
  showToast(existingId ? "Занятие обновлено" : form.get("repeat") === "on" ? "Добавлено 5 занятий" : "Занятие добавлено");
}

function handleStudentSubmit(event) {
  event.preventDefault();
  const form = new FormData(els.studentForm);
  const existingId = form.get("studentId");
  const student = {
    id: existingId || uid("student"),
    name: form.get("name").trim(),
    goal: form.get("goal"),
    age: Number(form.get("age")) || null,
    level: form.get("level"),
    rate: Number(form.get("rate")) || 0,
    contact: form.get("contact").trim(),
    notes: form.get("notes").trim(),
  };

  state.students = existingId
    ? state.students.map((item) => (item.id === existingId ? student : item))
    : [...state.students, student];
  saveState();
  els.studentDialog.close();
  render();
  showToast(existingId ? "Данные ученика обновлены" : "Ученик добавлен");

  if (pendingLessonAfterStudent && !existingId) {
    pendingLessonAfterStudent = false;
    setTimeout(() => {
      openLessonDialog();
      updateStudentOptions([student.id]);
      els.lessonForm.elements.rate.value = student.rate || "";
    }, 120);
  }
}

function deleteLesson() {
  const id = els.lessonForm.elements.lessonId.value;
  if (!id || !confirm("Удалить это занятие?")) return;
  state.lessons = state.lessons.filter((lesson) => lesson.id !== id);
  saveState();
  els.lessonDialog.close();
  render();
  showToast("Занятие удалено");
}

function deleteStudent() {
  const id = els.studentForm.elements.studentId.value;
  if (!id) return;
  const lessonCount = state.lessons.filter((lesson) => lessonStudentIds(lesson).includes(id)).length;
  const message = lessonCount
    ? `Удалить ученика? Индивидуальные занятия будут удалены, а из групповых ученик будет исключён (${lessonCount} связанных занятий).`
    : "Удалить этого ученика?";
  if (!confirm(message)) return;
  state.students = state.students.filter((student) => student.id !== id);
  state.lessons = state.lessons.flatMap((lesson) => {
    const remainingIds = lessonStudentIds(lesson).filter((studentId) => studentId !== id);
    if (!remainingIds.length) return [];
    if (remainingIds.length === lessonStudentIds(lesson).length) return [lesson];
    return [{ ...lesson, studentId: remainingIds[0], studentIds: remainingIds }];
  });
  saveState();
  els.studentDialog.close();
  render();
  showToast("Ученик удалён");
}

function shiftWeek(direction) {
  selectedWeekStart = addDays(selectedWeekStart, direction * 7);
  renderWeekPreview();
  renderWeekCalendar();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lessonflow-${toISODate(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Резервная копия скачана");
}

async function importData(file) {
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.students) || !Array.isArray(imported.lessons)) throw new Error("invalid");
    state = {
      ...structuredClone(defaultState),
      ...imported,
      settings: { ...defaultState.settings, ...(imported.settings || {}) },
    };
    saveState();
    render();
    showToast("Данные восстановлены");
  } catch {
    showToast("Не удалось прочитать файл");
  } finally {
    document.querySelector("#importInput").value = "";
  }
}

function isValidCloudState(value) {
  return value && Array.isArray(value.students) && Array.isArray(value.lessons);
}

async function loadCloudState(user) {
  updateSyncStatus("Загрузка…", "saving");
  const userRef = doc(db, "users", user.uid);

  try {
    const snapshot = await getDoc(userRef);
    if (snapshot.exists() && isValidCloudState(snapshot.data().payload)) {
      state = {
        ...structuredClone(defaultState),
        ...snapshot.data().payload,
        settings: { ...defaultState.settings, ...(snapshot.data().payload.settings || {}) },
      };
    } else {
      const lastUserId = localStorage.getItem(LAST_USER_KEY);
      if (lastUserId && lastUserId !== user.uid) {
        state = structuredClone(defaultState);
      }
      await setDoc(userRef, { payload: state, updatedAt: serverTimestamp() });
      showToast("Данные сохранены в облаке");
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LAST_USER_KEY, user.uid);
    lastSyncedState = JSON.stringify(state);
    cloudReady = true;
    render();
    updateSyncStatus("Синхронизировано", "synced");

    if (unsubscribeCloud) unsubscribeCloud();
    unsubscribeCloud = onSnapshot(
      userRef,
      (remoteSnapshot) => {
        if (!remoteSnapshot.exists()) return;
        const remoteState = remoteSnapshot.data().payload;
        if (!isValidCloudState(remoteState)) return;
        const serialized = JSON.stringify(remoteState);
        if (serialized === lastSyncedState) return;
        lastSyncedState = serialized;
        state = {
          ...structuredClone(defaultState),
          ...remoteState,
          settings: { ...defaultState.settings, ...(remoteState.settings || {}) },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
        updateSyncStatus("Синхронизировано", "synced");
      },
      (error) => {
        console.error("Cloud listener failed", error);
        updateSyncStatus("Нет соединения", "error");
      },
    );
  } catch (error) {
    console.error("Cloud load failed", error);
    cloudReady = false;
    updateSyncStatus("Ошибка синхронизации", "error");
    showToast("Не удалось загрузить облачные данные");
  }
}

async function initializeCloud() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("Auth persistence unavailable", error);
  }

  onAuthStateChanged(auth, async (user) => {
    clearTimeout(syncTimer);
    cloudReady = false;
    if (unsubscribeCloud) {
      unsubscribeCloud();
      unsubscribeCloud = null;
    }

    currentUser = user;
    if (!user) {
      els.authGate.classList.remove("hidden");
      els.accountEmail.textContent = "—";
      updateSyncStatus("Требуется вход", "error");
      return;
    }

    els.authGate.classList.add("hidden");
    els.accountEmail.textContent = user.email || "Аккаунт Firebase";
    await loadCloudState(user);
  });
}

function setAuthMessage(message = "", success = false) {
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("visible", Boolean(message));
  els.authMessage.classList.toggle("success", success);
}

function setAuthLoading(loading) {
  els.authSubmitButton.disabled = loading;
  els.authSubmitButton.textContent = loading
    ? "Подождите…"
    : authMode === "login" ? "Войти" : "Создать аккаунт";
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  els.authKicker.textContent = isLogin ? "С возвращением" : "Первый вход";
  els.authTitle.textContent = isLogin ? "Войдите в кабинет" : "Создайте аккаунт";
  els.authDescription.textContent = isLogin
    ? "Используйте email и пароль, чтобы открыть расписание."
    : "Придумайте пароль — расписание будет доступно на всех ваших устройствах.";
  els.authSubmitButton.textContent = isLogin ? "Войти" : "Создать аккаунт";
  els.toggleAuthModeButton.textContent = isLogin ? "Создать новый аккаунт" : "У меня уже есть аккаунт";
  els.forgotPasswordButton.classList.toggle("hidden", !isLogin);
  els.authForm.elements.password.autocomplete = isLogin ? "current-password" : "new-password";
  setAuthMessage();
}

function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/invalid-email": "Проверьте адрес электронной почты.",
    "auth/email-already-in-use": "Аккаунт с таким email уже существует.",
    "auth/weak-password": "Пароль должен содержать не менее 6 символов.",
    "auth/too-many-requests": "Слишком много попыток. Попробуйте немного позже.",
    "auth/network-request-failed": "Нет соединения с интернетом.",
  };
  return messages[error?.code] || "Не удалось выполнить вход. Попробуйте ещё раз.";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthMessage();
  setAuthLoading(true);
  const form = new FormData(els.authForm);
  const email = form.get("email").trim();
  const password = form.get("password");

  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    els.authForm.reset();
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

async function handlePasswordReset() {
  const email = els.authForm.elements.email.value.trim();
  if (!email) {
    setAuthMessage("Сначала введите email, на который отправить письмо.");
    els.authForm.elements.email.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage("Письмо для восстановления пароля отправлено.", true);
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  }
}

function bindEvents() {
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.toggleAuthModeButton.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
  els.forgotPasswordButton.addEventListener("click", handlePasswordReset);

  document.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-view]");
    if (navButton) showView(navButton.dataset.view);

    const switchButton = event.target.closest("[data-switch-view]");
    if (switchButton) showView(switchButton.dataset.switchView);

    const weekButton = event.target.closest("[data-week-action]");
    if (weekButton) shiftWeek(weekButton.dataset.weekAction === "next" ? 1 : -1);

    const lessonCardElement = event.target.closest("[data-lesson-id]");
    if (lessonCardElement) openLessonDialog(lessonCardElement.dataset.lessonId);

    const studentCardElement = event.target.closest("[data-student-id]");
    if (studentCardElement) openStudentDialog(studentCardElement.dataset.studentId);

    const addDateButton = event.target.closest("[data-add-date]");
    if (addDateButton) openLessonDialog("", addDateButton.dataset.addDate);

    const dayTile = event.target.closest("[data-date]");
    if (dayTile) {
      showView("week");
      selectedWeekStart = startOfWeek(parseLocalDate(dayTile.dataset.date));
      renderWeekCalendar();
    }

    const emptyAction = event.target.closest("[data-empty-action]");
    if (emptyAction?.dataset.emptyAction === "lesson") openLessonDialog();
    if (emptyAction?.dataset.emptyAction === "student") openStudentDialog();

    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) document.querySelector(`#${closeButton.dataset.closeDialog}`).close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const lessonTarget = event.target.closest("[data-lesson-id]");
    const studentTarget = event.target.closest("[data-student-id]");
    if (lessonTarget) openLessonDialog(lessonTarget.dataset.lessonId);
    if (studentTarget) openStudentDialog(studentTarget.dataset.studentId);
  });

  document.querySelector("#addLessonButton").addEventListener("click", () => openLessonDialog());
  document.querySelector("#mobileAddLessonButton").addEventListener("click", () => openLessonDialog());
  document.querySelector("#addStudentButton").addEventListener("click", () => openStudentDialog());
  document.querySelector("#goTodayButton").addEventListener("click", () => {
    selectedWeekStart = startOfWeek(new Date());
    showView("today");
  });
  document.querySelector("#calendarTodayButton").addEventListener("click", () => {
    selectedWeekStart = startOfWeek(new Date());
    renderWeekCalendar();
  });
  els.studentSearch.addEventListener("input", renderStudents);
  els.lessonForm.addEventListener("submit", handleLessonSubmit);
  els.studentForm.addEventListener("submit", handleStudentSubmit);
  els.deleteLessonButton.addEventListener("click", deleteLesson);
  els.deleteStudentButton.addEventListener("click", deleteStudent);

  document.querySelector("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.tutorName = els.tutorNameInput.value.trim();
    saveState();
    render();
    showToast("Настройки сохранены");
  });

  document.querySelector("#exportButton").addEventListener("click", exportData);
  document.querySelector("#importInput").addEventListener("change", (event) => importData(event.target.files[0]));
  document.querySelector("#logoutButton").addEventListener("click", async () => {
    try {
      await signOut(auth);
      setAuthMode("login");
      showToast("Вы вышли из аккаунта");
    } catch {
      showToast("Не удалось выйти из аккаунта");
    }
  });
  document.querySelector("#clearDataButton").addEventListener("click", () => {
    if (!confirm("Точно удалить всех учеников и все занятия в облаке?")) return;
    state = structuredClone(defaultState);
    saveState();
    render();
    showToast("Все данные удалены");
  });

  [els.lessonDialog, els.studentDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

bindEvents();
render();
initializeCloud();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
