(() => {
  'use strict';

  const editor = window.notebookEditor;
  const reminders = window.notebookReminders;
  const STORAGE_KEY = 'smart-notebook-single-file-v1';
  const DATA_VERSION = 4;
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;
  const REVIEW_PLAN = [
    { label: 'Через 25 минут', delayMs: 25 * 60_000 },
    { label: 'Через час', delayMs: HOUR },
    { label: 'Через 1 день', delayMs: DAY },
    { label: 'Через неделю', delayMs: 7 * DAY },
    { label: 'Через 2 недели', delayMs: 14 * DAY },
    { label: 'Через месяц', delayMs: 30 * DAY },
    { label: 'Через 75 дней', delayMs: 75 * DAY }
  ];

  const els = {
    folderTree: document.getElementById('folderTree'),
    notesList: document.getElementById('notesList'),
    notesPanelTitle: document.getElementById('notesPanelTitle'),
    notesPanelSubtitle: document.getElementById('notesPanelSubtitle'),
    noteTitle: document.getElementById('noteTitle'),
    noteContent: document.getElementById('noteContent'),
    notePreview: document.getElementById('notePreview'),
    editorInputWrap: document.getElementById('editorInputWrap'),
    editorReadingWrap: document.getElementById('editorReadingWrap'),
    editorEmpty: document.getElementById('editorEmpty'),
    editorWrap: document.getElementById('editorWrap'),
    breadcrumbs: document.getElementById('breadcrumbs'),
    editorMeta: document.getElementById('editorMeta'),
    noteTags: document.getElementById('noteTags'),
    noteFolderMove: document.getElementById('noteFolderMove'),
    repeatEnabled: document.getElementById('repeatEnabled'),
    nextReviewText: document.getElementById('nextReviewText'),
    repeatTimeline: document.getElementById('repeatTimeline'),
    editorRepeatBanner: document.getElementById('editorRepeatBanner'),
    editorRepeatBannerText: document.getElementById('editorRepeatBannerText'),
    statNotes: document.getElementById('statNotes'),
    statDue: document.getElementById('statDue'),
    saveStatus: document.getElementById('saveStatus'),
    globalSearch: document.getElementById('globalSearch'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    btnAddFolder: document.getElementById('btnAddFolder'),
    btnRenameFolder: document.getElementById('btnRenameFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    btnAddNote: document.getElementById('btnAddNote'),
    btnDeleteNote: document.getElementById('btnDeleteNote'),
    btnDuplicateNote: document.getElementById('btnDuplicateNote'),
    btnTogglePin: document.getElementById('btnTogglePin'),
    btnHistory: document.getElementById('btnHistory'),
    btnSaveNow: document.getElementById('btnSaveNow'),
    btnExport: document.getElementById('btnExport'),
    btnImport: document.getElementById('btnImport'),
    importFile: document.getElementById('importFile'),
    btnNotifications: document.getElementById('btnNotifications'),
    btnTheme: document.getElementById('btnTheme'),
    btnOpenDueOnly: document.getElementById('btnOpenDueOnly'),
    btnShowAllNotes: document.getElementById('btnShowAllNotes'),
    btnStartReview: document.getElementById('btnStartReview'),
    btnCompleteReview: document.getElementById('btnCompleteReview'),
    btnResetReview: document.getElementById('btnResetReview'),
    toastStack: document.getElementById('toastStack'),
    notificationsDialog: document.getElementById('notificationsDialog'),
    siteNotificationStatus: document.getElementById('siteNotificationStatus'),
    extensionStatus: document.getElementById('extensionStatus'),
    btnAllowSite: document.getElementById('btnAllowSite'),
    btnTestSite: document.getElementById('btnTestSite'),
    btnToggleBackground: document.getElementById('btnToggleBackground'),
    btnTestBackground: document.getElementById('btnTestBackground'),
    formatToolbar: document.getElementById('formatToolbar'),
    editorPanes: document.getElementById('editorPanes'),
    editorShortcuts: document.getElementById('editorShortcuts'),
    codeLanguage: document.getElementById('codeLanguage'),
    repeatDetails: document.getElementById('repeatDetails'),
    btnReviewNow: document.getElementById('btnReviewNow'),
    settingsMenu: document.getElementById('settingsMenu'),
    noteMenu: document.getElementById('noteMenu'),
    modalRoot: document.getElementById('modalRoot')
  };

  const modes = [...document.querySelectorAll('[data-editor-mode]')];
  let lastPersistedState = null;
  let migratedReviewPlan = false;
  let state = loadState();
  let transient = {
    search: '',
    notesViewMode: 'all',
    editorMode: 'read',
    preferredEditMode: 'write',
    bufferNoteId: null,
    previewSource: null,
    isComposing: false,
    editingBuffer: { title: '', content: '', tags: [] },
    dueToasts: new Map(),
    background: { available: false, enabled: false },
    checkingBackground: false
  };
  let autoSaveTimer = null;

  init();

  function init() {
    applyTheme(state.ui.theme);
    bindEvents();
    ensureSelectionIntegrity();
    if (lastPersistedState === null || migratedReviewPlan) persistState(false, { render: false });
    reminders.start(openReminder);
    const query = new URLSearchParams(location.search);
    if (query.has('note')) openReminder(query.get('note'));
    else if (query.get('review') === 'due') openReminder('');
    else renderAll();
    void refreshBackground().then(checkDue);
    window.setInterval(checkDue, 20_000);
  }

  function createDefaultState() {
    const rootId = uid();
    const welcomeNoteId = uid();
    return {
      version: DATA_VERSION,
      folders: [{
        id: rootId,
        parentId: null,
        name: 'Мои заметки',
        expanded: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }],
      notes: [{
        id: welcomeNoteId,
        folderId: rootId,
        title: 'Добро пожаловать',
        tags: ['старт', 'справка'],
        pinned: true,
        history: [],
        content: [
          "Сохраняйте здесь конспекты, идеи и фрагменты кода.",
          "",
          "Выберите **Текст**, чтобы редактировать, или **Рядом**, чтобы сразу видеть результат. У блока кода можно выбрать язык, а в режиме чтения — скопировать его одним нажатием.",
          "",
          "## Пример блока кода",
          "",
          "```javascript",
          "const topic = \"JavaScript\";",
          "const nextReview = 25;",
          "console.log(topic, nextReview);",
          "```",
          "",
          "Чтобы запомнить материал, включите **Повторение** под заметкой и нажмите **Начать цикл**."
        ].join('\n'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        repeat: defaultRepeat()
      }],
      ui: {
        selectedFolderId: rootId,
        selectedNoteId: welcomeNoteId,
        lastSavedAt: Date.now(),
        theme: 'light'
      }
    };
  }

  function defaultRepeat() {
    return {
      enabled: false,
      stageIndex: -1,
      nextReviewAt: null,
      lastReviewedAt: null,
      completed: false,
      lastNotificationAt: null
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      lastPersistedState = raw;
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      const normalized = sanitizeState(parsed);
      migratedReviewPlan = parsed && (Number(parsed.version) || 1) < DATA_VERSION;
      return normalized;
    } catch (error) {
      console.error(error);
      showToast('Не удалось прочитать данные из LocalStorage. Создано новое хранилище.', 'warning');
      return createDefaultState();
    }
  }

  function sanitizeState(input) {
    const fallback = createDefaultState();
    if (!input || typeof input !== 'object') return fallback;
    const version = Number(input.version) || 1;

    const folders = Array.isArray(input.folders) ? input.folders : fallback.folders;
    const notes = Array.isArray(input.notes) ? input.notes : fallback.notes;
    const ui = input.ui && typeof input.ui === 'object' ? input.ui : fallback.ui;

    const seen = new Set();
    const safeFolders = folders
      .filter(folder => {
        if (!folder?.id || !folder.name || seen.has(String(folder.id))) return false;
        seen.add(String(folder.id));
        return true;
      })
      .map(folder => ({
        id: String(folder.id),
        parentId: folder.parentId == null ? null : String(folder.parentId),
        name: String(folder.name),
        expanded: folder.expanded !== false,
        createdAt: validTimestamp(folder.createdAt) || Date.now(),
        updatedAt: validTimestamp(folder.updatedAt) || Date.now()
      }));

    if (!safeFolders.length) return fallback;

    const foldersById = new Map(safeFolders.map(folder => [folder.id, folder]));
    for (const folder of safeFolders) {
      const ancestors = new Set([folder.id]);
      let parent = foldersById.get(folder.parentId);
      while (parent && !ancestors.has(parent.id)) {
        ancestors.add(parent.id);
        parent = foldersById.get(parent.parentId);
      }
      if (parent || (folder.parentId && !foldersById.has(folder.parentId))) folder.parentId = null;
    }
    const folderIds = new Set(foldersById.keys());
    const safeNotes = notes
      .filter(note => note && note.id && folderIds.has(String(note.folderId)))
      .map(note => ({
        id: String(note.id),
        folderId: String(note.folderId),
        title: String(note.title || 'Без названия'),
        content: String(note.content || ''),
        tags: sanitizeTags(note.tags),
        pinned: Boolean(note.pinned),
        history: sanitizeHistory(note.history),
        createdAt: validTimestamp(note.createdAt) || Date.now(),
        updatedAt: validTimestamp(note.updatedAt) || Date.now(),
        repeat: sanitizeRepeat(note.repeat, version)
      }));

    return {
      version: Math.max(version, DATA_VERSION),
      folders: safeFolders,
      notes: safeNotes,
      ui: {
        selectedFolderId: folderIds.has(String(ui.selectedFolderId)) ? String(ui.selectedFolderId) : safeFolders[0].id,
        selectedNoteId: safeNotes.some(note => note.id === String(ui.selectedNoteId)) ? String(ui.selectedNoteId) : (safeNotes[0]?.id || null),
        lastSavedAt: Number(ui.lastSavedAt) || Date.now(),
        theme: ui.theme === 'dark' ? 'dark' : 'light'
      }
    };
  }

  function sanitizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags
      .map(tag => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 12))];
  }

  function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        title: String(item.title || 'Без названия'),
        content: String(item.content || ''),
        savedAt: validTimestamp(item.savedAt) || Date.now(),
        tags: sanitizeTags(item.tags)
      }))
      .slice(0, 20);
  }

  function sanitizeRepeat(repeat, version) {
    if (!repeat || typeof repeat !== 'object') return defaultRepeat();
    const normalized = {
      enabled: Boolean(repeat.enabled),
      stageIndex: Number.isInteger(repeat.stageIndex) ? repeat.stageIndex : -1,
      nextReviewAt: validTimestamp(repeat.nextReviewAt),
      lastReviewedAt: validTimestamp(repeat.lastReviewedAt),
      completed: Boolean(repeat.completed),
      lastNotificationAt: validTimestamp(repeat.lastNotificationAt)
    };
    if (version < DATA_VERSION && normalized.enabled) migrateReviewPlan(normalized, version);
    return normalized;
  }

  function migrateReviewPlan(repeat, version) {
    if (repeat.completed) {
      repeat.stageIndex = REVIEW_PLAN.length - 1;
      repeat.nextReviewAt = null;
      return;
    }
    if (repeat.stageIndex < 0 || !repeat.nextReviewAt) return;

    const oldStage = repeat.stageIndex;
    let previousDelay;
    if (version < 3) {
      // The five-step plan used immediate, 25-minute, day, 17-day and 75-day stages.
      repeat.stageIndex = [0, 0, 1, 3, 5][oldStage] ?? -1;
      previousDelay = [0, null, DAY, 17 * DAY, 75 * DAY][oldStage];
      if (oldStage === 0) repeat.lastReviewedAt = null;
    } else {
      if (oldStage > 1) repeat.stageIndex += 1;
      previousDelay = oldStage === 1 ? DAY : null;
    }

    if (previousDelay == null) return;
    const anchor = repeat.lastReviewedAt ?? repeat.nextReviewAt - previousDelay;
    const newDelay = REVIEW_PLAN[repeat.stageIndex].delayMs;
    repeat.nextReviewAt = validTimestamp(anchor + newDelay) ?? repeat.nextReviewAt;
    repeat.lastNotificationAt = null;
  }

  function validTimestamp(value) {
    const date = Number(value);
    return Number.isSafeInteger(date) && date > 0 && date <= 8.64e15 ? date : null;
  }

  function bindEvents() {
    els.btnAddFolder.addEventListener('click', onAddFolder);
    els.btnRenameFolder.addEventListener('click', onRenameFolder);
    els.btnDeleteFolder.addEventListener('click', onDeleteFolder);
    els.btnAddNote.addEventListener('click', onAddNote);
    els.btnDeleteNote.addEventListener('click', onDeleteNote);
    els.btnDuplicateNote.addEventListener('click', onDuplicateNote);
    els.btnSaveNow.addEventListener('click', saveActiveNote);
    modes.forEach(button => button.addEventListener('click', () => setEditorMode(button.dataset.editorMode)));
    document.querySelectorAll('[data-format]').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => applyFormatting(button.dataset.format));
    });
    els.noteContent.addEventListener('keydown', event => editor.handleCodeKeys(event, els.noteContent, () => {
      modes.find(button => button.dataset.editorMode === transient.editorMode)?.focus();
    }));
    els.notePreview.addEventListener('click', async event => {
      const button = event.target.closest('[data-copy-code]');
      if (!button) return;
      const code = button.closest('.code-block').querySelector('code').textContent;
      try {
        await editor.copyText(code);
        button.textContent = 'Скопировано';
        setTimeout(() => { button.textContent = 'Копировать'; }, 1500);
      } catch {
        showToast('Буфер обмена недоступен. Выделите код и скопируйте его вручную.', 'warning');
      }
    });
    els.globalSearch.addEventListener('input', () => {
      transient.search = els.globalSearch.value.trim();
      transient.notesViewMode = transient.search ? 'search' : 'all';
      els.btnClearSearch.classList.toggle('hidden', !transient.search);
      renderAll();
    });
    els.btnClearSearch.addEventListener('click', () => {
      clearSearch('all');
      els.globalSearch.focus();
      renderAll();
    });
    for (const menu of [els.settingsMenu, els.noteMenu]) {
      menu.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
      document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
    }
    for (const [field, name] of [[els.noteTitle, 'title'], [els.noteContent, 'content'], [els.noteTags, 'tags']]) {
      field.addEventListener('compositionstart', () => { transient.isComposing = true; });
      field.addEventListener('compositionend', () => { transient.isComposing = false; scheduleAutoSave(); });
      field.addEventListener('input', () => {
        transient.editingBuffer[name] = name === 'tags' ? parseTags(field.value) : field.value;
        scheduleAutoSave();
        renderEditorMetaPreview();
        renderNotesList();
        if (name === 'content') renderPreview();
      });
    }
    els.noteFolderMove.addEventListener('change', onMoveNoteToFolder);
    els.repeatEnabled.addEventListener('change', onToggleRepeatEnabled);
    els.btnStartReview.addEventListener('click', onStartReview);
    els.btnCompleteReview.addEventListener('click', onCompleteReview);
    els.btnReviewNow.addEventListener('click', onCompleteReview);
    els.btnResetReview.addEventListener('click', onResetReview);
    els.btnExport.addEventListener('click', exportJson);
    els.btnImport.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', importJson);
    els.btnNotifications.addEventListener('click', () => {
      els.notificationsDialog.showModal();
      updateNotificationButton();
      void refreshBackground();
    });
    els.btnAllowSite.addEventListener('click', requestNotificationPermission);
    els.btnTestSite.addEventListener('click', async () => {
      try { await reminders.testSite(); }
      catch { els.siteNotificationStatus.textContent = 'Не удалось показать тестовое уведомление.'; }
    });
    els.btnToggleBackground.addEventListener('click', toggleBackground);
    els.btnTestBackground.addEventListener('click', async () => {
      if (!(await reminders.testBackground())?.ok) els.extensionStatus.textContent = 'Не удалось показать тестовое уведомление расширения.';
    });
    els.btnTheme.addEventListener('click', toggleTheme);
    els.btnTogglePin.addEventListener('click', onTogglePin);
    els.btnHistory.addEventListener('click', openHistoryModal);
    els.btnOpenDueOnly.addEventListener('click', () => { clearSearch('due'); renderAll(); });
    els.btnShowAllNotes.addEventListener('click', () => { clearSearch('all'); renderAll(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        for (const menu of [els.settingsMenu, els.noteMenu]) {
          if (!menu.open) continue;
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      }
      if (event.isComposing || !(event.ctrlKey || event.metaKey) ||
          els.notificationsDialog.open || !els.modalRoot.classList.contains('hidden')) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        els.globalSearch.focus();
      }
      if (key === 's') {
        event.preventDefault();
        saveActiveNote();
      }
      if (event.target === els.noteContent && (key === 'b' || key === 'i')) {
        event.preventDefault();
        applyFormatting(key === 'b' ? 'bold' : 'italic');
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && autoSaveTimer !== null) persistState(false, { render: false });
      if (!document.hidden) handleFocus();
    });
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', () => {
      if (autoSaveTimer !== null) persistState(false, { render: false });
    });
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY || !event.newValue || autoSaveTimer !== null) return;
      const { selectedNoteId, selectedFolderId } = state.ui;
      lastPersistedState = event.newValue;
      state = sanitizeState(JSON.parse(event.newValue));
      Object.assign(state.ui, { selectedNoteId, selectedFolderId });
      transient.bufferNoteId = undefined;
      applyTheme(state.ui.theme);
      renderAll();
      void reminders.syncBackground(reminderEntries);
    });
  }

  function clearSearch(mode) {
    transient.notesViewMode = mode;
    transient.search = '';
    els.globalSearch.value = '';
    els.btnClearSearch.classList.add('hidden');
  }

  function saveActiveNote() {
    if (getSelectedNote()) persistState(true);
  }

  function scheduleAutoSave() {
    if (transient.isComposing) return;
    setSaveStatus('Автосохранение...');
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (persistState(false, { render: false })) renderEditorMetaPreview();
    }, 450);
  }

  function flushEditorToState(options = {}) {
    const note = getSelectedNote();
    if (!note || transient.bufferNoteId !== note.id) return;
    const nextTitle = (transient.editingBuffer.title || '').trim() || 'Без названия';
    const nextContent = transient.editingBuffer.content || '';
    const nextTags = sanitizeTags(transient.editingBuffer.tags || []);
    if (note.title === nextTitle && note.content === nextContent && arraysEqual(note.tags || [], nextTags)) return;

    const prevTitle = note.title;
    const prevContent = note.content;
    const prevTags = sanitizeTags(note.tags || []);
    maybeCaptureHistory(note, {
      title: prevTitle,
      content: prevContent,
      tags: prevTags
    }, options.captureHistory === true ? 'manual' : 'auto');

    note.title = nextTitle;
    note.content = nextContent;
    note.tags = nextTags;
    note.updatedAt = Date.now();
  }

  function persistState(force = false, options = {}) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    flushEditorToState({ captureHistory: force });
    try {
      const latest = localStorage.getItem(STORAGE_KEY);
      if (latest && latest !== lastPersistedState && options.merge !== false) {
        const previous = lastPersistedState && sanitizeState(JSON.parse(lastPersistedState));
        const stored = sanitizeState(JSON.parse(latest));
        if (previous) {
          state.notes = mergeRecords(previous.notes, state.notes, stored.notes);
          state.folders = mergeRecords(previous.folders, state.folders, stored.folders);
          const folderIds = new Set(state.folders.map(folder => folder.id));
          state.notes = state.notes.filter(note => folderIds.has(note.folderId));
        }
      }
      state.ui.lastSavedAt = Date.now();
      const snapshot = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, snapshot);
      lastPersistedState = snapshot;
      setSaveStatus(force ? 'Сохранено' : 'Сохранено в ' + formatTime(state.ui.lastSavedAt));
    } catch (error) {
      console.error(error);
      setSaveStatus('Ошибка сохранения');
      showToast('Не удалось сохранить данные.', 'danger');
      return false;
    }
    if (options.render !== false) renderAll();
    void reminders.syncBackground(reminderEntries);
    return true;
  }

  function mergeRecords(previous, current, stored) {
    const previousById = new Map(previous.map(item => [item.id, JSON.stringify(item)]));
    const currentIds = new Set(current.map(item => item.id));
    const storedById = new Map(stored.map(item => [item.id, item]));
    const merged = [];
    for (const item of current) {
      const fromStorage = storedById.get(item.id);
      if (JSON.stringify(item) !== previousById.get(item.id)) merged.push(item);
      else if (fromStorage) merged.push(fromStorage);
    }
    for (const item of stored) {
      if (!currentIds.has(item.id) && !previousById.has(item.id)) merged.push(item);
    }
    return merged;
  }

  function setSaveStatus(text) {
    els.saveStatus.textContent = text;
  }

  function ensureSelectionIntegrity() {
    const selectedFolder = getSelectedFolder();
    if (!selectedFolder) {
      state.ui.selectedFolderId = state.folders[0]?.id || null;
    }
    if (state.ui.selectedNoteId && !state.notes.some(note => note.id === state.ui.selectedNoteId)) {
      state.ui.selectedNoteId = null;
    }
    if (!state.ui.selectedNoteId) {
      const notesForSelected = getVisibleNotes({ ignoreSearch: true });
      state.ui.selectedNoteId = notesForSelected[0]?.id || null;
    }
    if (transient.bufferNoteId !== state.ui.selectedNoteId) syncBufferFromSelectedNote();
  }

  function syncBufferFromSelectedNote() {
    const note = getSelectedNote();
    transient.bufferNoteId = note?.id ?? null;
    transient.editingBuffer = {
      title: note?.title || '',
      content: note?.content || '',
      tags: sanitizeTags(note?.tags || [])
    };
  }

  function setEditorMode(mode) {
    if (mode === 'read' && autoSaveTimer !== null) persistState(false, { render: false });
    transient.editorMode = mode;
    if (mode !== 'read') transient.preferredEditMode = mode;
    renderEditor();
  }

  function getSelectedFolder() {
    return state.folders.find(folder => folder.id === state.ui.selectedFolderId) || null;
  }

  function getSelectedNote() {
    return state.notes.find(note => note.id === state.ui.selectedNoteId) || null;
  }

  function getFolderById(id) {
    return state.folders.find(folder => folder.id === id) || null;
  }

  function getFolderChildren(parentId) {
    return state.folders
      .filter(folder => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  function getFolderPath(folderId) {
    const path = [];
    let current = getFolderById(folderId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? getFolderById(current.parentId) : null;
    }
    return path;
  }

  function getDescendantFolderIds(folderId) {
    const ids = [folderId];
    const stack = [folderId];
    while (stack.length) {
      const currentId = stack.pop();
      const children = getFolderChildren(currentId);
      children.forEach(child => {
        ids.push(child.id);
        stack.push(child.id);
      });
    }
    return ids;
  }

  function getVisibleNotes(options = {}) {
    const search = options.ignoreSearch ? '' : transient.search.trim().toLowerCase();
    let notes = [...state.notes];

    if (transient.notesViewMode === 'due' && !options.ignoreMode) {
      notes = notes.filter(isNoteDue);
    } else if (!options.ignoreMode && transient.notesViewMode === 'folder') {
      const descendantIds = new Set(getDescendantFolderIds(state.ui.selectedFolderId));
      notes = notes.filter(note => descendantIds.has(note.folderId));
    }

    if (search) {
      notes = notes.filter(note => {
        const folderPath = getFolderPath(note.folderId).map(folder => folder.name).join(' / ').toLowerCase();
        const tags = (note.tags || []).join(' ').toLowerCase();
        return (
          note.title.toLowerCase().includes(search) ||
          note.content.toLowerCase().includes(search) ||
          folderPath.includes(search) ||
          tags.includes(search)
        );
      });
    }

    return notes.sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aDue = isNoteDue(a) ? 1 : 0;
      const bDue = isNoteDue(b) ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getDueNotes() {
    return state.notes.filter(isNoteDue).sort((a, b) => (a.repeat.nextReviewAt || 0) - (b.repeat.nextReviewAt || 0));
  }

  function isNoteDue(note) {
    if (!note?.repeat?.enabled || note.repeat.completed || !note.repeat.nextReviewAt) return false;
    return Date.now() >= note.repeat.nextReviewAt;
  }

  function renderAll() {
    ensureSelectionIntegrity();
    renderStats();
    renderFolderTree();
    renderNotesList();
    renderEditor();
    updateNotificationButton();
  }

  function renderStats() {
    const dueCount = getDueNotes().length;
    els.statNotes.textContent = String(state.notes.length);
    els.statDue.textContent = String(dueCount);
    els.statDue.classList.toggle('has-due', dueCount > 0);
    els.btnShowAllNotes.setAttribute('aria-pressed', String(transient.notesViewMode === 'all'));
    els.btnOpenDueOnly.setAttribute('aria-pressed', String(transient.notesViewMode === 'due'));
    const regularFolder = Boolean(getSelectedFolder()?.parentId);
    els.btnRenameFolder.disabled = !regularFolder;
    els.btnDeleteFolder.disabled = !regularFolder;
  }

  function renderFolderTree() {
    els.folderTree.innerHTML = '';
    const roots = state.folders.filter(folder => folder.parentId === null);
    roots.forEach(root => {
      els.folderTree.appendChild(createFolderNode(root));
    });
  }

  function createFolderNode(folder) {
    const wrapper = document.createElement('div');
    const children = getFolderChildren(folder.id);
    const descendants = new Set(getDescendantFolderIds(folder.id));
    const dueCount = state.notes.filter(note => descendants.has(note.folderId) && isNoteDue(note)).length;
    const row = document.createElement('div');
    const active = state.ui.selectedFolderId === folder.id && transient.notesViewMode === 'folder';
    row.className = 'folder-row' + (active ? ' active' : '');

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'caret';
    caret.textContent = children.length ? (folder.expanded ? '▾' : '▸') : '·';
    caret.disabled = children.length === 0;
    caret.setAttribute('aria-label', (folder.expanded ? 'Свернуть ' : 'Развернуть ') + folder.name);
    if (children.length) caret.setAttribute('aria-expanded', String(folder.expanded));
    caret.addEventListener('click', () => {
      folder.expanded = !folder.expanded;
      folder.updatedAt = Date.now();
      persistState();
    });

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'label';
    if (active) label.setAttribute('aria-current', 'true');
    label.innerHTML = '<span aria-hidden="true">▱</span><strong>' + escapeHtml(folder.name) + '</strong>' +
      (dueCount ? '<span class="count has-due" aria-label="К повторению: ' + dueCount + '">' + dueCount + '</span>' : '');
    label.addEventListener('click', () => {
      flushEditorToState();
      state.ui.selectedFolderId = folder.id;
      clearSearch('folder');
      if (!descendants.has(getSelectedNote()?.folderId)) {
        state.ui.selectedNoteId = getVisibleNotes()[0]?.id ?? null;
        transient.editorMode = 'read';
      }
      persistState();
    });

    row.append(caret, label);
    wrapper.append(row);
    if (children.length && folder.expanded) {
      const branch = document.createElement('div');
      branch.className = 'child-tree';
      branch.append(...children.map(createFolderNode));
      wrapper.append(branch);
    }
    return wrapper;
  }

  function renderNotesList() {
    const noteList = getVisibleNotes();
    const mode = transient.notesViewMode;
    const focusedId = els.notesList.contains(document.activeElement) ? document.activeElement.dataset.noteId : null;
    els.notesPanelTitle.textContent = mode === 'due' ? 'К повторению' :
      mode === 'search' ? 'Поиск' : mode === 'folder' ? getSelectedFolder()?.name || 'Папка' : 'Все заметки';
    els.notesPanelSubtitle.textContent = mode === 'search' ? 'Найдено: ' + noteList.length : 'Заметок: ' + noteList.length;
    const cards = noteList.map(note => {
      const card = document.createElement('button');
      const active = state.ui.selectedNoteId === note.id;
      const due = isNoteDue(note);
      card.type = 'button';
      card.className = 'note-card' + (active ? ' active' : '') + (due ? ' due' : '');
      card.dataset.noteId = note.id;
      if (active) card.setAttribute('aria-current', 'true');
      const { title, content } = active ? transient.editingBuffer : note;
      const folder = getFolderById(note.folderId)?.name || '';
      card.innerHTML = '<span class="note-card-top"><strong class="note-card-title">' + escapeHtml(title.trim() || 'Без названия') + '</strong>' +
        (note.pinned ? '<span class="pin-mark" aria-label="Закреплено">◆</span>' : '') + '</span>' +
        '<span class="snippet">' + escapeHtml(snippetFromNote(content)) + '</span>' +
        (due ? '<span class="badge warning">Пора повторить</span>' : '') +
        '<span class="note-card-meta">' + escapeHtml(folder) + ' · ' + escapeHtml(formatDateTime(note.updatedAt)) + '</span>';
      card.addEventListener('click', () => selectNote(note.id, true));
      return card;
    });
    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = mode === 'due' ? 'Сейчас повторять нечего.' :
        mode === 'search' ? 'По этому запросу ничего не найдено.' : 'В этом разделе пока нет заметок.';
      cards.push(empty);
    }
    els.notesList.replaceChildren(...cards);
    if (focusedId) cards.find(card => card.dataset.noteId === focusedId)?.focus({ preventScroll: true });
  }

  function selectNote(id, scroll = false) {
    const note = state.notes.find(item => item.id === id);
    if (!note) return false;
    flushEditorToState();
    state.ui.selectedNoteId = note.id;
    if (transient.notesViewMode !== 'folder') state.ui.selectedFolderId = note.folderId;
    transient.editorMode = 'read';
    syncBufferFromSelectedNote();
    persistState(false);
    if (scroll) scrollToEditor();
    return true;
  }

  function scrollToEditor() {
    if (matchMedia('(max-width: 840px)').matches) els.editorWrap.scrollIntoView({ block: 'start' });
  }

  function renderEditor() {
    const note = getSelectedNote();
    els.editorEmpty.classList.toggle('hidden', Boolean(note));
    els.editorWrap.classList.toggle('hidden', !note);
    if (!note) return;
    const mode = transient.editorMode;
    const writing = mode !== 'read';
    syncTextControl(els.noteTitle, transient.editingBuffer.title);
    syncTextControl(els.noteContent, transient.editingBuffer.content);
    if (document.activeElement !== els.noteTags) syncTextControl(els.noteTags, transient.editingBuffer.tags.join(', '));
    els.noteTitle.readOnly = !writing;
    els.repeatEnabled.checked = note.repeat.enabled;
    renderFolderMoveOptions(note.folderId);
    els.breadcrumbs.innerHTML = getFolderPath(note.folderId)
      .map(folder => '<span>' + escapeHtml(folder.name) + '</span>')
      .join('<span aria-hidden="true">/</span>');
    els.btnTogglePin.textContent = note.pinned ? 'Открепить' : 'Закрепить';
    els.btnTogglePin.setAttribute('aria-pressed', String(note.pinned));
    els.editorInputWrap.classList.toggle('hidden', !writing);
    els.editorReadingWrap.classList.toggle('hidden', mode === 'write');
    els.formatToolbar.classList.toggle('hidden', !writing);
    els.btnSaveNow.classList.toggle('hidden', !writing);
    els.editorShortcuts.classList.toggle('hidden', !writing);
    els.editorPanes.classList.toggle('split', mode === 'split');
    modes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.editorMode === mode)));
    renderPreview();
    renderRepeatSection(note);
    renderEditorMetaPreview();
  }

  function renderPreview() {
    const content = transient.editingBuffer.content;
    if (transient.editorMode === 'write' || content === transient.previewSource) return;
    editor.updatePreview(els.notePreview, content);
    transient.previewSource = content;
  }

  function applyFormatting(type) {
    if (transient.editorMode !== 'read' && getSelectedNote()) editor.format(els.noteContent, type, els.codeLanguage.value);
  }

  function renderEditorMetaPreview() {
    const note = getSelectedNote();
    if (!note) return;
    const content = transient.editingBuffer.content;
    els.editorMeta.textContent = 'Слов: ' + countWords(content) + ' · Символов: ' + content.length +
      ' · Изменено ' + formatDateTime(note.updatedAt);
  }

  function renderRepeatSection(note) {
    const { repeat } = note;
    const due = isNoteDue(note);
    els.editorRepeatBanner.classList.toggle('hidden', !due);
    els.editorRepeatBannerText.textContent = due ? formatRelative(repeat.nextReviewAt) : '';
    els.repeatDetails.classList.toggle('hidden', !repeat.enabled);
    const active = repeat.stageIndex >= 0 && !repeat.completed && repeat.nextReviewAt;
    els.nextReviewText.textContent = !repeat.enabled ? 'Отключено' : repeat.completed ? 'Все этапы выполнены' :
      active ? 'Этап ' + (repeat.stageIndex + 1) + ' из ' + REVIEW_PLAN.length + ' · ' +
        formatDateTime(repeat.nextReviewAt) + ' (' + formatRelative(repeat.nextReviewAt) + ')' :
        'Первое повторение через 25 минут после запуска.';
    els.repeatTimeline.replaceChildren(...REVIEW_PLAN.map((step, index) => {
      const pill = document.createElement('span');
      const done = repeat.completed || repeat.stageIndex > index;
      pill.className = 'timeline-pill' + (done ? ' done' : active && repeat.stageIndex === index ? ' active' : '');
      pill.textContent = (done ? '✓ ' : '') + step.label;
      return pill;
    }));
    els.btnStartReview.hidden = Boolean(active);
    els.btnStartReview.textContent = repeat.completed ? 'Начать заново' : 'Начать цикл';
    els.btnCompleteReview.hidden = !active || due;
    els.btnResetReview.hidden = repeat.stageIndex < 0;
  }

  function onAddFolder() {
    const selected = getSelectedFolder();
    promptModal({
      title: 'Новая папка',
      message: `Папка будет создана внутри: ${selected?.name || 'корня'}`,
      label: 'Название папки',
      placeholder: 'Например: Учёба / Языки / Проекты',
      confirmText: 'Создать',
      onConfirm: (value) => {
        const name = value.trim();
        if (!name) {
          showToast('Введите название папки.', 'warning');
          return false;
        }
        const folder = {
          id: uid(),
          parentId: selected?.id || null,
          name,
          expanded: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        state.folders.push(folder);
        if (selected) selected.expanded = true;
        flushEditorToState();
        state.ui.selectedFolderId = folder.id;
        state.ui.selectedNoteId = null;
        transient.editorMode = 'read';
        clearSearch('folder');
        persistState(true);
        showToast(`Папка «${name}» создана.`);
      }
    });
  }

  function onRenameFolder() {
    const folder = getSelectedFolder();
    if (!folder || folder.parentId === null) {
      return showToast('Корневую папку переименовывать нельзя.', 'warning');
    }
    promptModal({
      title: 'Переименовать папку',
      message: 'Введите новое название.',
      label: 'Название',
      value: folder.name,
      confirmText: 'Сохранить',
      onConfirm: (value) => {
        const name = value.trim();
        if (!name) {
          showToast('Название не может быть пустым.', 'warning');
          return false;
        }
        folder.name = name;
        folder.updatedAt = Date.now();
        persistState(true);
        showToast('Название папки обновлено.');
      }
    });
  }

  function onDeleteFolder() {
    const folder = getSelectedFolder();
    if (!folder || folder.parentId === null) {
      return showToast('Корневую папку удалить нельзя.', 'warning');
    }
    const affectedFolderIds = getDescendantFolderIds(folder.id);
    const affectedNotes = state.notes.filter(note => affectedFolderIds.includes(note.folderId)).length;
    confirmModal({
      title: 'Удалить папку?',
      message: `Будут удалены папка «${folder.name}», все подпапки и ${affectedNotes} заметок. Это действие нельзя отменить.`,
      confirmText: 'Удалить',
      confirmClass: 'btn-danger',
      onConfirm: () => {
        flushEditorToState();
        clearSearch('folder');
        state.folders = state.folders.filter(item => !affectedFolderIds.includes(item.id));
        state.notes = state.notes.filter(note => !affectedFolderIds.includes(note.folderId));
        state.ui.selectedFolderId = folder.parentId;
        const nextNote = getVisibleNotes({ ignoreSearch: true })[0];
        state.ui.selectedNoteId = nextNote?.id || null;
        transient.editorMode = 'read';
        syncBufferFromSelectedNote();
        persistState(true);
        showToast('Папка удалена.', 'warning');
      }
    });
  }

  function onAddNote() {
    const folder = getSelectedFolder();
    if (!folder) {
      showToast('Сначала выберите папку.', 'warning');
      return;
    }
    const note = {
      id: uid(),
      folderId: folder.id,
      title: 'Новая заметка',
      content: '',
      tags: [],
      pinned: false,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repeat: defaultRepeat()
    };
    flushEditorToState();
    state.notes.unshift(note);
    state.ui.selectedNoteId = note.id;
    if (transient.notesViewMode !== 'folder') clearSearch('all');
    transient.editorMode = transient.preferredEditMode;
    syncBufferFromSelectedNote();
    persistState(true);
    scrollToEditor();
    els.noteTitle.focus({ preventScroll: true });
    els.noteTitle.select();
    showToast('Новая заметка создана.');
  }

  function onDeleteNote() {
    const note = getSelectedNote();
    if (!note) return showToast('Нет выбранной заметки.', 'warning');
    confirmModal({
      title: 'Удалить заметку?',
      message: `Заметка «${note.title}» будет удалена без возможности восстановления.`,
      confirmText: 'Удалить',
      confirmClass: 'btn-danger',
      onConfirm: () => {
        state.notes = state.notes.filter(item => item.id !== note.id);
        const nextNote = getVisibleNotes({ ignoreSearch: true, ignoreMode: transient.notesViewMode === 'due' })[0] || state.notes[0] || null;
        state.ui.selectedNoteId = nextNote?.id || null;
        if (nextNote) state.ui.selectedFolderId = nextNote.folderId;
        syncBufferFromSelectedNote();
        persistState(true);
        showToast('Заметка удалена.', 'warning');
      }
    });
  }

  function onDuplicateNote() {
    const note = getSelectedNote();
    if (!note) return showToast('Нет выбранной заметки.', 'warning');
    flushEditorToState();
    const clone = {
      ...structuredCloneSafe(note),
      id: uid(),
      title: `${note.title} (копия)`,
      pinned: false,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repeat: defaultRepeat()
    };
    state.notes.unshift(clone);
    state.ui.selectedNoteId = clone.id;
    state.ui.selectedFolderId = clone.folderId;
    syncBufferFromSelectedNote();
    persistState(true);
    showToast('Копия заметки создана.');
  }

  function onToggleRepeatEnabled() {
    const note = getSelectedNote();
    if (!note) return;
    note.repeat.enabled = els.repeatEnabled.checked;
    if (!note.repeat.enabled) {
      note.repeat.stageIndex = -1;
      note.repeat.nextReviewAt = null;
      note.repeat.completed = false;
      note.repeat.lastNotificationAt = null;
    }
    note.updatedAt = Date.now();
    persistState(true);
  }

  function onStartReview() {
    const note = getSelectedNote();
    if (!note) return showToast('Сначала выберите заметку.', 'warning');
    if (!note.repeat.enabled) return showToast('Сначала включите повторение.', 'warning');
    const now = Date.now();
    note.repeat.stageIndex = 0;
    note.repeat.completed = false;
    note.repeat.nextReviewAt = now + REVIEW_PLAN[0].delayMs;
    note.repeat.lastReviewedAt = null;
    note.repeat.lastNotificationAt = null;
    note.updatedAt = now;
    persistState(true);
    showToast('Цикл начат. Первое повторение через 25 минут.', 'success');
  }

  function onCompleteReview() {
    const note = getSelectedNote();
    if (!note) return showToast('Сначала выберите заметку.', 'warning');
    if (!note.repeat.enabled || note.repeat.stageIndex < 0 || note.repeat.completed) return;
    const now = Date.now();
    note.repeat.lastReviewedAt = now;
    note.repeat.lastNotificationAt = null;

    if (note.repeat.stageIndex >= REVIEW_PLAN.length - 1) {
      note.repeat.completed = true;
      note.repeat.nextReviewAt = null;
      note.updatedAt = now;
      persistState(true);
      showToast('Последний этап повторения выполнен. Цикл завершён.', 'success');
      return;
    }

    const nextStage = note.repeat.stageIndex + 1;
    note.repeat.stageIndex = nextStage;
    note.repeat.nextReviewAt = now + REVIEW_PLAN[nextStage].delayMs;
    note.repeat.completed = false;
    note.updatedAt = now;
    persistState(true);
    showToast(`Готово. Следующее повторение: ${REVIEW_PLAN[nextStage].label.toLowerCase()}.`, 'success');
  }

  function onResetReview() {
    const note = getSelectedNote();
    if (!note) return showToast('Сначала выберите заметку.', 'warning');
    note.repeat = {
      ...defaultRepeat(),
      enabled: note.repeat.enabled
    };
    note.updatedAt = Date.now();
    persistState(true);
    showToast('Цикл повторения сброшен.');
  }

  function exportJson() {
    flushEditorToState();
    persistState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smart-notebook-backup-${formatDateForFile(Date.now())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('JSON-файл экспортирован.');
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (!Array.isArray(parsed?.folders) || !Array.isArray(parsed?.notes) || !parsed.folders.some(folder => folder?.id && folder.name)) {
          throw new Error('Invalid notebook backup');
        }
        const imported = sanitizeState(parsed);
        confirmModal({
          title: 'Импортировать данные?',
          message: 'Текущие заметки будут заменены содержимым JSON-файла.',
          confirmText: 'Импортировать',
          onConfirm: () => {
            state = imported;
            clearSearch('all');
            transient.editorMode = 'read';
            transient.dueToasts.clear();
            syncBufferFromSelectedNote();
            applyTheme(state.ui.theme);
            persistState(true, { merge: false });
            checkDue();
            showToast('Импорт завершён.');
          }
        });
      } catch (error) {
        console.error(error);
        showToast('Файл не похож на корректный JSON.', 'danger');
      }
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  }

  async function requestNotificationPermission() {
    try {
      await Notification.requestPermission();
      updateNotificationButton();
      checkDue();
    } catch {
      els.siteNotificationStatus.textContent = 'Не удалось запросить разрешение.';
    }
  }

  function updateNotificationButton() {
    const permission = window.Notification?.permission;
    const extension = transient.background;
    els.btnNotifications.classList.toggle('enabled', permission === 'granted' || (extension.enabled && extension.allowed));
    els.btnAllowSite.hidden = permission !== 'default';
    els.btnTestSite.hidden = permission !== 'granted';
    els.siteNotificationStatus.textContent = permission === 'granted' ? 'Разрешено для этого сайта.' :
      permission === 'denied' ? 'Заблокировано. Откройте разрешения сайта рядом с адресной строкой и разрешите уведомления.' :
      permission === 'default' ? 'Разрешите браузеру показывать уведомления, пока открыт блокнот.' :
      'Уведомления сайта здесь недоступны. Откройте блокнот через HTTPS в браузере.';
    els.btnToggleBackground.hidden = !extension.available;
    els.btnToggleBackground.disabled = transient.checkingBackground;
    els.btnToggleBackground.textContent = extension.enabled ? 'Отключить фоновые' : 'Включить фоновые';
    els.btnTestBackground.hidden = !extension.enabled || !extension.allowed;
    els.extensionStatus.textContent = extension.available && !extension.recurring ?
      'Обновите расширение до версии 1.1.0 или новее, чтобы получать повторные напоминания.' :
      extension.enabled && extension.allowed ? 'Включено. Оставьте Chrome или Edge запущенным.' :
      extension.enabled ? 'Уведомления расширения заблокированы. Проверьте настройки браузера и системы.' :
      extension.available ? 'Расширение подключено. Включите доставку в этом браузере.' :
      transient.checkingBackground ? 'Проверяем подключение расширения…' :
      'Установите расширение в Chrome или Edge и обновите страницу.';
  }

  async function refreshBackground() {
    if (transient.checkingBackground) return;
    transient.checkingBackground = true;
    updateNotificationButton();
    try {
      transient.background = await reminders.getBackgroundStatus();
      await reminders.syncBackground(reminderEntries);
    } finally {
      transient.checkingBackground = false;
      updateNotificationButton();
    }
  }

  async function toggleBackground() {
    transient.checkingBackground = true;
    updateNotificationButton();
    try {
      transient.background = await reminders.setBackground(!transient.background.enabled, reminderEntries);
    } finally {
      transient.checkingBackground = false;
      updateNotificationButton();
      checkDue();
    }
  }

  function handleFocus() {
    void refreshBackground().then(checkDue);
  }

  function reminderEntries() {
    const entries = state.notes.filter(note => note.repeat.enabled && !note.repeat.completed && note.repeat.nextReviewAt)
      .map(note => ({
        id: note.id,
        title: note.title,
        dueAt: note.repeat.nextReviewAt
      }));
    return reminders.withDelivery(entries);
  }

  function checkDue() {
    const due = getDueNotes();
    const current = new Map(due.map(note => [note.id, note.repeat.nextReviewAt]));
    const added = due.filter(note => transient.dueToasts.get(note.id) !== note.repeat.nextReviewAt);
    transient.dueToasts = current;
    if (added.length) {
      const note = added.length === 1 ? added[0] : null;
      showToast(note ? 'Пора повторить «' + note.title + '».' : 'Заметок к повторению: ' + added.length, 'warning', {
        actionText: 'Открыть',
        onAction: () => openReminder(note?.id || '')
      });
    }
    renderStats();
    renderNotesList();
    if (getSelectedNote()) renderRepeatSection(getSelectedNote());
    if (!transient.checkingBackground) {
      void reminders.syncBackground(reminderEntries);
      void reminders.deliverDue(reminderEntries, openReminder);
    }
  }

  function openReminder(id) {
    if (!id) {
      clearSearch('due');
      renderAll();
      els.btnOpenDueOnly.focus({ preventScroll: true });
    } else {
      clearSearch('all');
      if (!selectNote(id, true)) {
        renderAll();
        showToast('Эта заметка уже недоступна.', 'warning');
      }
    }
    const url = new URL(location.href);
    if (url.searchParams.has('note') || url.searchParams.has('review')) {
      url.searchParams.delete('note');
      url.searchParams.delete('review');
      history.replaceState(null, '', url);
    }
  }

  function renderFolderMoveOptions(currentFolderId) {
    if (!els.noteFolderMove) return;
    const currentValue = currentFolderId || '';
    const options = state.folders
      .slice()
      .sort((a, b) => getFolderPath(a.id).map(folder => folder.name).join(' / ').localeCompare(getFolderPath(b.id).map(folder => folder.name).join(' / '), 'ru'))
      .map(folder => {
        const path = getFolderPath(folder.id).map(item => item.name).join(' / ');
        return `<option value="${escapeHtml(folder.id)}" ${folder.id === currentValue ? 'selected' : ''}>${escapeHtml(path)}</option>`;
      }).join('');
    els.noteFolderMove.innerHTML = options;
  }

  function parseTags(value) {
    return sanitizeTags(String(value || '').split(',').map(item => item.trim()));
  }

  function arraysEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
  }

  function maybeCaptureHistory(note, snapshot, reason = 'auto') {
    const safeSnapshot = {
      title: String(snapshot?.title || 'Без названия'),
      content: String(snapshot?.content || ''),
      tags: sanitizeTags(snapshot?.tags || []),
      savedAt: Date.now()
    };
    if (!safeSnapshot.content.trim() && !safeSnapshot.title.trim()) return;
    const last = note.history?.[0];
    const tooSoon = last && (Date.now() - last.savedAt) < 90 * 1000;
    const sameContent = last && last.title === safeSnapshot.title && last.content === safeSnapshot.content && arraysEqual(last.tags || [], safeSnapshot.tags || []);
    if (sameContent) return;
    if (reason === 'auto' && tooSoon && Math.abs((safeSnapshot.content || '').length - (last?.content || '').length) < 120) return;
    note.history = [safeSnapshot, ...(note.history || [])].slice(0, 20);
  }

  function openHistoryModal() {
    const note = getSelectedNote();
    if (!note) return showToast('Сначала выберите заметку.', 'warning');
    flushEditorToState();
    const history = note.history || [];
    if (!history.length) return showToast('История пока пустая. Сначала внесите и сохраните несколько изменений.', 'warning');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:min(760px, 100%);">
        <h3>История версий</h3>
        <p>Можно вернуть предыдущий вариант заметки. Сначала будет сохранён текущий.</p>
        <div class="history-list">
          ${history.map((item, index) => `
            <div class="history-item">
              <div class="history-item-head">
                <div>
                  <strong>${escapeHtml(item.title || 'Без названия')}</strong>
                  <div class="help-text">${formatDateTime(item.savedAt)} • ${countWords(item.content)} слов • ${(item.content || '').length} символов</div>
                </div>
                <button class="btn-primary mini-btn" data-restore-index="${index}">Восстановить</button>
              </div>
              ${(item.tags || []).length ? `<div class="tag-cloud">${item.tags.map(tag => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
              <div class="history-snippet">${escapeHtml(snippetFromNote(item.content))}</div>
            </div>
          `).join('')}
        </div>
        <div class="actions">
          <button class="btn-secondary" data-close>Закрыть</button>
        </div>
      </div>
    `;

    els.modalRoot.innerHTML = '';
    els.modalRoot.classList.remove('hidden');
    els.modalRoot.appendChild(overlay);

    const close = () => {
      els.modalRoot.innerHTML = '';
      els.modalRoot.classList.add('hidden');
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('[data-close]')?.addEventListener('click', close);
    overlay.querySelectorAll('[data-restore-index]').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.restoreIndex);
        const snapshot = note.history?.[index];
        if (!snapshot) return;
        maybeCaptureHistory(note, {
          title: note.title,
          content: note.content,
          tags: note.tags || []
        }, 'manual');
        note.title = snapshot.title || 'Без названия';
        note.content = snapshot.content || '';
        note.tags = sanitizeTags(snapshot.tags || []);
        note.updatedAt = Date.now();
        state.ui.selectedNoteId = note.id;
        syncBufferFromSelectedNote();
        transient.editorMode = transient.preferredEditMode;
        persistState(true);
        close();
        showToast('Предыдущая версия восстановлена.');
      });
    });
  }

  function onTogglePin() {
    const note = getSelectedNote();
    if (!note) return;
    flushEditorToState();
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    persistState(true);
    showToast(note.pinned ? 'Заметка закреплена и теперь выше в списке.' : 'Заметка откреплена.');
  }

  function onMoveNoteToFolder() {
    const note = getSelectedNote();
    const nextFolderId = els.noteFolderMove.value;
    if (!note || !nextFolderId || nextFolderId === note.folderId) return;
    note.folderId = nextFolderId;
    note.updatedAt = Date.now();
    state.ui.selectedFolderId = nextFolderId;
    persistState(true);
    showToast('Заметка перемещена в другую папку.');
  }

  function toggleTheme() {
    state.ui.theme = state.ui.theme === 'light' ? 'dark' : 'light';
    applyTheme(state.ui.theme);
    persistState(false, { render: false });
    showToast(`Тема переключена: ${state.ui.theme === 'light' ? 'светлая' : 'тёмная'}.`);
  }

  function applyTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', normalized);
    if (els.btnTheme) {
      els.btnTheme.textContent = normalized === 'light' ? 'Тёмная тема' : 'Светлая тема';
    }
  }

  function countWords(content) {
    return String(content || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function syncTextControl(el, nextValue) {
    if (!el) return;
    const safeValue = String(nextValue ?? '');
    if (el.value === safeValue) return;
    const isActive = document.activeElement === el;
    if (!isActive) {
      el.value = safeValue;
      return;
    }
    const oldValue = el.value;
    const scrollTop = el.scrollTop;
    const selectionStart = el.selectionStart ?? safeValue.length;
    const selectionEnd = el.selectionEnd ?? safeValue.length;
    const direction = el.selectionDirection || 'none';
    el.value = safeValue;
    const delta = safeValue.length - oldValue.length;
    const nextStart = Math.max(0, Math.min(safeValue.length, selectionStart + delta));
    const nextEnd = Math.max(0, Math.min(safeValue.length, selectionEnd + delta));
    try {
      el.setSelectionRange(nextStart, nextEnd, direction);
    } catch (error) {
      console.warn('Не удалось восстановить позицию каретки.', error);
    }
    el.scrollTop = scrollTop;
  }

  function promptModal({ title, message, label, placeholder = '', value = '', confirmText = 'ОК', onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <label>
          <div style="margin-bottom: 8px;"><strong>${escapeHtml(label)}</strong></div>
          <input id="modalInput" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
        </label>
        <div class="actions">
          <button class="btn-secondary" data-close>Отмена</button>
          <button class="btn-primary" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    mountModal(overlay, () => {
      const input = overlay.querySelector('#modalInput');
      return onConfirm?.(input.value);
    });
    setTimeout(() => {
      const input = overlay.querySelector('#modalInput');
      input.focus();
      input.select();
    }, 30);
  }

  function confirmModal({ title, message, confirmText = 'Подтвердить', confirmClass = 'btn-primary', onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="actions">
          <button class="btn-secondary" data-close>Отмена</button>
          <button class="${confirmClass}" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    mountModal(overlay, onConfirm);
  }

  function mountModal(overlay, onConfirm) {
    els.modalRoot.innerHTML = '';
    els.modalRoot.classList.remove('hidden');
    els.modalRoot.appendChild(overlay);

    const cleanup = () => document.removeEventListener('keydown', onKeyDown);
    const close = () => {
      els.modalRoot.innerHTML = '';
      els.modalRoot.classList.add('hidden');
      cleanup();
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    overlay.querySelector('[data-close]')?.addEventListener('click', close);
    overlay.querySelector('[data-confirm]')?.addEventListener('click', () => {
      const result = onConfirm?.();
      if (result !== false) close();
    });

    function onKeyDown(event) {
      if (els.modalRoot.classList.contains('hidden')) {
        cleanup();
        return;
      }
      if (event.key === 'Escape') {
        close();
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        const active = document.activeElement;
        if (active && active.tagName === 'INPUT') {
          const result = onConfirm?.();
          if (result !== false) close();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
  }

  function showToast(message, type = 'info', options = {}) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const label = document.createElement('span');
    label.textContent = message;
    toast.append(label);
    if (options.actionText) {
      const action = document.createElement('button');
      action.className = 'text-button small';
      action.textContent = options.actionText;
      action.addEventListener('click', () => {
        options.onAction();
        toast.remove();
      });
      toast.append(action);
    }
    els.toastStack.append(toast);
    setTimeout(() => toast.remove(), options.duration || 5000);
  }

  function uid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function snippetFromNote(content) {
    return (content || '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Без текста';
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';
    return new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(new Date(timestamp));
  }

  function formatDateForFile(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  function formatRelative(timestamp) {
    if (!timestamp) return '—';
    const diff = timestamp - Date.now();
    const abs = Math.abs(diff);
    const minutes = Math.round(abs / 60000);
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);
    const suffix = diff >= 0 ? 'через' : '';
    const prefix = diff < 0 ? 'назад' : '';

    let text = '';
    if (minutes < 60) text = `${minutes} мин.`;
    else if (hours < 48) text = `${hours} ч.`;
    else text = `${days} дн.`;

    return diff >= 0 ? `${suffix} ${text}` : `${text} ${prefix}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }
})();
