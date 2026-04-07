// =============================================
// СКУД — Пропуска | Google Apps Script Backend
// =============================================
// Настройки: Script Properties (File → Project properties → Script properties)
//   ADMIN_PASSWORD  — пароль администратора
//   SPREADSHEET_ID  — ID Google Таблицы
//   FOLDER_ID       — ID папки в Google Drive для файлов

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    password:      props.getProperty('ADMIN_PASSWORD'),
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    folderId:      props.getProperty('FOLDER_ID'),
  };
}

// ── Точка входа ──────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'login':         return respond(handleLogin(data));
      case 'submit':        return respond(handleSubmit(data));
      case 'getAll':        return respond(handleGetAll(data));
      case 'updateStatus':  return respond(handleUpdateStatus(data));
      default:              return respond({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// Нужен doGet чтобы Apps Script принял деплой
function doGet() {
  return ContentService.createTextOutput('OK');
}

// ── Авторизация ──────────────────────────────
function handleLogin(data) {
  const { password } = getConfig();
  if (data.password === password) {
    return { success: true, token: password };
  }
  return { success: false, error: 'Неверный пароль' };
}

function checkAuth(token) {
  return token === getConfig().password;
}

// ── Подача заявки ────────────────────────────
function handleSubmit(data) {
  const { spreadsheetId, folderId } = getConfig();
  const ss     = SpreadsheetApp.openById(spreadsheetId);
  const sheet  = ss.getSheetByName('Заявки') || ss.insertSheet('Заявки');
  const folder = DriveApp.getFolderById(folderId);

  // Заголовки при первом запуске
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'Дата', 'Тип', 'ФИО', 'ИИН',
      'Номер паспорта', 'Место работы', 'Должность',
      'Фото (ссылка)', 'Скан паспорта (ссылка)', 'Статус'
    ]);
    sheet.setFrozenRows(1);
  }

  const id = Utilities.getUuid();

  // Сохраняем фото лица
  const photoUrl = saveFile(folder, data.photo, `photo_${id}`);

  // Сохраняем скан паспорта (только нерезидент)
  const scanUrl = data.passportScan
    ? saveFile(folder, data.passportScan, `scan_${id}`)
    : '';

  sheet.appendRow([
    id,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'),
    data.type === 'resident' ? 'Резидент РК' : 'Нерезидент РК',
    data.fio,
    data.iin        || '',
    data.passport   || '',
    data.workplace  || '',
    data.position   || '',
    photoUrl,
    scanUrl,
    'Новая'
  ]);

  return { success: true, id };
}

function saveFile(folder, base64DataUrl, name) {
  if (!base64DataUrl) return '';
  const parts    = base64DataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime     = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bytes    = Utilities.base64Decode(parts[1]);
  const blob     = Utilities.newBlob(bytes, mime, name);
  const file     = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ── Получить все заявки (admin) ──────────────
function handleGetAll(data) {
  if (!checkAuth(data.token)) return { success: false, error: 'Unauthorized' };

  const { spreadsheetId } = getConfig();
  const ss    = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName('Заявки');

  if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
  const apps = rows.map(r => ({
    id:          r[0],
    date:        r[1],
    type:        r[2],
    fio:         r[3],
    iin:         r[4],
    passport:    r[5],
    workplace:   r[6],
    position:    r[7],
    photo:       r[8],
    passportScan:r[9],
    status:      r[10],
  }));

  return { success: true, data: apps };
}

// ── Сменить статус (admin) ───────────────────
function handleUpdateStatus(data) {
  if (!checkAuth(data.token)) return { success: false, error: 'Unauthorized' };

  const { spreadsheetId } = getConfig();
  const ss    = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName('Заявки');
  const ids   = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.id) {
      sheet.getRange(i + 2, 11).setValue(data.status);
      return { success: true };
    }
  }
  return { success: false, error: 'Заявка не найдена' };
}

// ── Утилита ──────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
