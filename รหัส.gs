/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - CORE ROUTER & DATABASE HELPERS (รหัส.gs / Code.gs)
 * Version: 5.2.2 (Master Production Release)
 * ⚠️ หมายเหตุ: วางโค้ดไฟล์นี้ใน "รหัส.gs" (หรือ Code.gs) เท่านั้น
 * ============================================================================
 */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase().trim() : 'index';
  
  if (page === 'driver') {
    return HtmlService.createTemplateFromFile('Driver')
      .evaluate()
      .setTitle('ระบบหน่วยรถสายส่ง - โรงน้ำแข็งแม่ใจ')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('โรงน้ำแข็งแม่ใจ - Smart Factory ERP V5.2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 🔗 ดึง URL มาตรฐานของ Web App สำหรับสลับหน้าระหว่างสำนักงานกับหน่วยรถสายส่ง
 */
function api_getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * 🔌 API Gateway กลาง: เชื่อมต่อ Frontend เข้ากับฟังก์ชัน api_* ใน Controller.gs อัตโนมัติ
 */
function processApiRequest(req) {
  try {
    var action = req && req.action ? String(req.action).trim() : '';
    var payload = (req && req.payload !== undefined) ? req.payload : {};
    if (!action) throw new Error('ไม่ได้ระบุ Action สำหรับเรียกใช้งาน API');

    var fnName = 'api_' + action;
    var targetFn = this[fnName];

    if (typeof targetFn !== 'function') {
      throw new Error('ไม่พบฟังก์ชันฝั่งเซิร์ฟเวอร์: ' + fnName);
    }

    var result = targetFn(payload);
    return { status: 'success', data: result };
  } catch (err) {
    writeLog('API_ERROR', (req && req.action ? req.action : 'UNKNOWN') + ': ' + err.message, 'ERROR');
    return { status: 'error', message: err.message || String(err) };
  }
}

// ==========================================
// 🗄️ DATABASE ENGINE (Google Sheets Batch Helpers)
// ==========================================
function getOrCreateSheet(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f5f9');
      sheet.setFrozenRows(1);
    }
  } else if (headers && headers.length > 0 && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSheetDataAsObjects(sheetName, expectedHeaders) {
  var sheet = getOrCreateSheet(sheetName, expectedHeaders || []);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];

  var data = sheet.getRange(1, 1, lastRow, Math.max(lastCol, (expectedHeaders ? expectedHeaders.length : lastCol))).getValues();
  var rawHeaders = data[0];
  var headers = rawHeaders.map(function(h, idx) {
    var clean = String(h || '').trim();
    return clean !== '' ? clean : (expectedHeaders && expectedHeaders[idx] ? expectedHeaders[idx] : 'Col' + idx);
  });

  var tz = Session.getScriptTimeZone() || 'GMT+7';
  var results = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '' && row[1] === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
      }
      obj[headers[j]] = val !== undefined ? val : '';
    }
    results.push(obj);
  }
  return results;
}

function generateId(sheet, prefix, padLen) {
  var len = padLen || 4;
  var lastRow = sheet.getLastRow();
  var maxNum = 0;

  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var searchPrefix = prefix + '-';
    for (var i = 0; i < ids.length; i++) {
      var idStr = String(ids[i][0] || '').trim();
      if (idStr.indexOf(searchPrefix) === 0) {
        var tail = idStr.slice(searchPrefix.length);
        var num = parseInt(tail, 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  }
  var nextNum = maxNum + 1;
  return prefix + '-' + nextNum.toString().padStart(len, '0');
}

function writeLog(action, details, status) {
  try {
    var headers = ['LogID', 'Timestamp', 'Action', 'Details', 'Status'];
    var sheet = getOrCreateSheet('tb_Logs', headers);
    var now = new Date();
    var id = 'LOG-' + Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd-HHmmss');
    sheet.appendRow([id, now, action || '', details || '', status || 'INFO']);
  } catch (e) {}
}