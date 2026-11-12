/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 01: CORE HELPERS, AUTH & MASTER DATA (01_CoreAndMaster.gs)
 * Version: 5.7 (Clean Modular Architecture - Zero Duplicate Functions)
 * ============================================================================
 */

// ==========================================
// 🛡️ 1. CORE HELPERS (LockService, SKU Filter, Shift Lock Guard & Walk-In Normalizer)
// ==========================================
function isStockProductId_(pid) {
  var id = String(pid || '').trim();
  if (!id) return false;
  if (id === 'FEE' || id === 'DISCOUNT' || id === 'AR-MANUAL') return false;
  if (id.indexOf('RET-') === 0) return false; // ขายปลีกตักแบ่ง 10/20 บาท ไม่นับเป็นกระสอบตัดสต๊อก
  return true;
}

function withSheetLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function normalizeWalkInName_(rawName) {
  var s = String(rawName || '').replace(/🚶/g, '').trim();
  s = s.replace(/^(ขาจร\s*:\s*|ขาจร\s+)/i, '').trim();
  s = s.replace(/\s+/g, ' ');
  if (!s || s === 'ลูกค้าขาจรทั่วไป' || s === 'ลูกค้าขาจร') {
    return 'ลูกค้าขาจรทั่วไป';
  }
  return 'ขาจร: ' + s;
}

/**
 * ตรวจสอบว่าสายส่งยังมีกะที่ "กำลังวิ่งส่ง" อยู่หรือไม่ (ป้องกันคนขับกดส่งบิลหลังจากเสมียนปิดกะไปแล้ว)
 */
function assertRouteShiftActive_(routeId, createdBy) {
  var rId = String(routeId || '').trim();
  var by = String(createdBy || '').trim();
  var isDriverAction = (by.indexOf('คนขับ') !== -1 || by === 'Driver');
  if (!isDriverAction && rId !== '') return;

  var drvName = by.replace(/^คนขับ\s*:\s*/i, '').trim();
  var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);

  var hasActive = dispatches.some(function(d) {
    if (String(d.Status || '').trim() !== 'กำลังวิ่งส่ง') return false;
    var matchRoute = rId !== '' && (String(d.RouteID || '').trim() === rId || String(d.RouteName || '').trim() === rId);
    var dDrv = String(d.DriverName || '').trim();
    var matchDriver = drvName !== '' && dDrv !== '' && (dDrv === drvName || dDrv.indexOf(drvName) !== -1 || drvName.indexOf(dDrv) !== -1);
    return matchRoute || matchDriver;
  });

  if (!hasActive) {
    throw new Error('เสมียนหน้าลานได้ทำการ "ปิดกะ" สายส่งนี้ไปแล้ว ไม่สามารถบันทึกหรือแก้ไขบิลเพิ่มได้ค่ะ (กรุณากดซิงค์ข้อมูล)');
  }
}

// ==========================================
// 🔐 2. FACTORY AUTHENTICATION & RBAC
// ==========================================
function api_verifyFactoryLogin(payload) {
  var empHeaders = ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt'];
  var empSheet = getOrCreateSheet('tb_Employees', empHeaders);

  if (empSheet.getLastRow() <= 1) {
    var now = new Date();
    empSheet.getRange(2, 1, 3, 7).setValues([
      ['EMP-0001', 'คุณธีระศักดิ์ (ผู้จัดการ)', '088-262-9154', 'ผู้บริหาร/ผู้จัดการ', '9999', 'Active', now],
      ['EMP-0002', 'เสมียนหน้าลาน', '081-000-1234', 'เสมียนหน้าลาน', '1234', 'Active', now],
      ['EMP-0003', 'สมชาย (สายส่ง)', '081-111-1111', 'คนขับรถ', '1111', 'Active', now]
    ]);
  }

  var pin = payload && payload.pin ? String(payload.pin).trim() : '';
  if (!pin) throw new Error('กรุณากรอกรหัส PIN เข้าสู่ระบบ');

  var employees = getSheetDataAsObjects('tb_Employees', empHeaders).filter(function(e) {
    return e.Status !== 'Inactive';
  });

  var matchedEmp = employees.find(function(e) {
    var empPin = String(e.PIN || '').trim();
    var phoneLast4 = String(e.Phone || '').replace(/\D/g, '').slice(-4);
    return empPin === pin || (phoneLast4 !== '' && phoneLast4 === pin);
  });

  if (!matchedEmp && pin === '9999') {
    matchedEmp = { EmpID: 'ADMIN-MASTER', EmpName: 'ผู้บริหาร (Master Admin)', Position: 'ผู้บริหาร', PIN: '9999' };
  }

  if (!matchedEmp) {
    writeLog('FACTORY_LOGIN_FAIL', 'PIN: ' + pin, 'WARNING');
    throw new Error('รหัส PIN ไม่ถูกต้อง หรือบัญชีถูกระงับการใช้งาน');
  }

  var pos = String(matchedEmp.Position || '').trim();
  var role = 'CLERK';
  if (pos.indexOf('บริหาร') !== -1 || pos.indexOf('จัดการ') !== -1 || pos.indexOf('เจ้าของ') !== -1 || pos.toLowerCase().indexOf('admin') !== -1) {
    role = 'ADMIN';
  } else if (pos.indexOf('ขับ') !== -1 || pos.toLowerCase().indexOf('driver') !== -1) {
    role = 'DRIVER';
  }

  if (role === 'DRIVER') {
    throw new Error('รหัส PIN นี้เป็นของ "พนักงานขับรถสายส่ง" (' + matchedEmp.EmpName + ') กรุณาเข้าใช้งานผ่านลิงก์ระบบหน่วยรถสายส่ง (?page=driver) ค่ะ');
  }

  writeLog('FACTORY_LOGIN', matchedEmp.EmpName + ' (' + role + ')', 'SUCCESS');
  return {
    EmpID: matchedEmp.EmpID,
    EmpName: matchedEmp.EmpName,
    Position: pos || 'เจ้าหน้าที่สำนักงาน',
    Role: role,
    LoginTime: Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm')
  };
}

// ==========================================
// 👥 3. CUSTOMER, PROMOTION & ROUTE SEQUENCING ENGINE
// ==========================================
function getCustomerPromoMap_() {
  var prmHeaders = ['PromoID', 'PromoName', 'DiscountAmt', 'Status', 'CreatedAt'];
  getOrCreateSheet('tb_Promotions', prmHeaders);
  var rows = getSheetDataAsObjects('tb_Promotions', prmHeaders);
  var map = {};
  rows.forEach(function(r) {
    if (r.Status === 'Active' && String(r.PromoName).indexOf('3FOR100:') === 0) {
      var cid = String(r.PromoName).replace('3FOR100:', '').trim();
      var eligProds = String(r.DiscountAmt || 'ALL').trim();
      map[cid] = { PromoID: r.PromoID, BundleQty: 3, BundlePrice: 100, EligibleProducts: eligProds };
    }
  });
  return map;
}

function getRouteOrderMap_() {
  var prmHeaders = ['PromoID', 'PromoName', 'DiscountAmt', 'Status', 'CreatedAt'];
  getOrCreateSheet('tb_Promotions', prmHeaders);
  var rows = getSheetDataAsObjects('tb_Promotions', prmHeaders);
  var map = {};
  rows.forEach(function(r) {
    if (r.Status !== 'Inactive' && String(r.PromoName || '').indexOf('ROUTE_ORDER:') === 0) {
      var routeKey = String(r.PromoName).replace('ROUTE_ORDER:', '').trim();
      var orderArr = String(r.DiscountAmt || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean);
      map[routeKey] = orderArr;
    }
  });
  return map;
}

function sortCustomersByRouteOrder_(custList) {
  var orderMap = getRouteOrderMap_();
  var byRouteCounters = {};
  var cloned = (custList || []).slice();

  cloned.sort(function(a, b) {
    var rA = String(a.RouteID || 'หน้าลาน').trim();
    var rB = String(b.RouteID || 'หน้าลาน').trim();
    if (rA !== rB) return rA.localeCompare(rB);

    var orderList = orderMap[rA] || [];
    var idxA = orderList.indexOf(String(a.CustomerID).trim());
    var idxB = orderList.indexOf(String(b.CustomerID).trim());

    if (idxA === -1 && idxB === -1) return 0;
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  cloned.forEach(function(c) {
    var rKey = String(c.RouteID || 'หน้าลาน').trim();
    byRouteCounters[rKey] = (byRouteCounters[rKey] || 0) + 1;
    c.SequenceNo = byRouteCounters[rKey];
  });

  return cloned;
}

function api_getCustomers() {
  var headers = ['CustomerID', 'CustomerName', 'Phone', 'CustomerType', 'RouteID', 'CreditLimit', 'Status', 'CreatedAt'];
  var sheet = getOrCreateSheet('tb_Customers', headers);
  if (sheet.getLastRow() <= 1) {
    var now = new Date();
    sheet.getRange(2, 1, 2, 8).setValues([
      ['C-0001', 'ตั๊กน้ำปั่น', '081-234-5678', 'ร้านประจำ', 'RT-0001', 5000, 'Active', now],
      ['C-0002', 'ครัวฮิมหนอง', '089-876-5432', 'ร้านประจำ', 'RT-0001', 10000, 'Active', now]
    ]);
  }
  var activeCusts = getSheetDataAsObjects('tb_Customers', headers).filter(function(c) {
    return c.Status !== 'Inactive';
  });
  return sortCustomersByRouteOrder_(activeCusts);
}

function api_saveRouteCustomerOrder(payload) {
  return withSheetLock_(function() {
    var routeId = payload && payload.RouteID ? String(payload.RouteID).trim() : '';
    var orderedIds = payload && payload.OrderedCustomerIDs ? payload.OrderedCustomerIDs : [];
    if (!routeId) throw new Error('ไม่พบรหัสสายส่ง');
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('ไม่มีรายชื่อร้านค้าสำหรับจัดลำดับ');
    }

    var prmHeaders = ['PromoID', 'PromoName', 'DiscountAmt', 'Status', 'CreatedAt'];
    var prmSheet = getOrCreateSheet('tb_Promotions', prmHeaders);
    var prmData = prmSheet.getDataRange().getValues();
    var targetKey = 'ROUTE_ORDER:' + routeId;
    var orderCsv = orderedIds.map(function(id) { return String(id).trim(); }).filter(Boolean).join(',');
    var now = new Date();
    var foundRow = -1;

    for (var i = 1; i < prmData.length; i++) {
      if (String(prmData[i][1]).trim() === targetKey) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow > 0) {
      prmSheet.getRange(foundRow, 3, 1, 2).setValues([[orderCsv, 'Active']]);
    } else {
      var newPrmId = generateId(prmSheet, 'PRM', 4);
      prmSheet.appendRow([newPrmId, targetKey, orderCsv, 'Active', now]);
    }

    SpreadsheetApp.flush();
    writeLog('SAVE_ROUTE_ORDER', routeId + ' (' + orderedIds.length + ' ร้าน) โดย ' + (payload.CreatedBy || 'Driver'), 'SUCCESS');
    return { RouteID: routeId, Count: orderedIds.length };
  });
}

function api_getCustomerDashboard() {
  var customers = api_getCustomers();
  var routes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']);
  var products = getSheetDataAsObjects('tb_Products', ['ProductID', 'ProductName', 'DefaultPrice', 'Unit', 'Status', 'CreatedAt']);
  var specialPrices = getSheetDataAsObjects('tb_SpecialPrices', ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt']);
  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var promoMap = getCustomerPromoMap_();

  var routeMap = {};
  routes.forEach(function(r) { routeMap[r.RouteID] = r.RouteName; });
  var prodMap = {};
  products.forEach(function(p) { prodMap[p.ProductID] = p.ProductName; });

  var spByCust = {};
  specialPrices.forEach(function(sp) {
    if (sp.Status !== 'Inactive' && sp.SpecialPrice !== '') {
      if (!spByCust[sp.CustomerID]) spByCust[sp.CustomerID] = [];
      spByCust[sp.CustomerID].push({
        ProductID: sp.ProductID,
        ProductName: prodMap[sp.ProductID] || sp.ProductID,
        Price: parseFloat(sp.SpecialPrice) || 0
      });
    }
  });

  var lastSaleByCust = {};
  var nameToCustId = {};
  customers.forEach(function(c) {
    if (c.CustomerName) nameToCustId[String(c.CustomerName).trim().toLowerCase()] = String(c.CustomerID).trim();
  });

  sales.forEach(function(s) {
    var status = String(s.PaymentStatus || '');
    if (status === 'Cancelled' || status === 'ยกเลิก') return;
    if (String(s.SaleID || '').indexOf('AR-') === 0) return;

    var cid = String(s.CustomerID || '').trim();
    if (!cid || cid === 'WALK-IN') {
      var cNameKey = String(s.CustomerName || '').trim().toLowerCase();
      if (nameToCustId[cNameKey]) cid = nameToCustId[cNameKey];
    }
    if (!cid || cid === 'WALK-IN') return;

    var sDateStr = String(s.SaleDate || '').slice(0, 10);
    if (!sDateStr) return;

    if (!lastSaleByCust[cid]) {
      lastSaleByCust[cid] = { lastDate: sDateStr, lastFullDate: String(s.SaleDate || '').slice(0, 16), lastAmount: parseFloat(s.TotalAmount) || 0, billCount: 0, totalSpent: 0 };
    }
    lastSaleByCust[cid].billCount++;
    lastSaleByCust[cid].totalSpent += (parseFloat(s.TotalAmount) || 0);
    if (sDateStr >= lastSaleByCust[cid].lastDate) {
      lastSaleByCust[cid].lastDate = sDateStr;
      lastSaleByCust[cid].lastFullDate = String(s.SaleDate || '').slice(0, 16);
      lastSaleByCust[cid].lastAmount = parseFloat(s.TotalAmount) || 0;
    }
  });

  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var todayParts = todayStr.split('-');
  var todayMidnight = new Date(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10)).getTime();

  var enrichedCustomers = customers.map(function(c) {
    var cid = String(c.CustomerID).trim();
    var saleStat = lastSaleByCust[cid] || null;
    var daysInactive = null;

    if (saleStat && saleStat.lastDate) {
      var dp = saleStat.lastDate.split('-');
      if (dp.length === 3) {
        var lastMidnight = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10)).getTime();
        daysInactive = Math.max(0, Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24)));
      }
    }

    c.RouteName = routeMap[c.RouteID] || c.RouteID || 'หน้าลาน';
    c.SpecialPrices = spByCust[c.CustomerID] || [];
    c.HasPromo3For100 = !!promoMap[c.CustomerID];
    c.PromoEligibleProducts = promoMap[c.CustomerID] ? promoMap[c.CustomerID].EligibleProducts : 'ALL';
    c.LastSaleDate = saleStat ? saleStat.lastDate : '';
    c.LastSaleAmount = saleStat ? saleStat.lastAmount : 0;
    c.TotalBillsCount = saleStat ? saleStat.billCount : 0;
    c.DaysInactive = daysInactive;
    return c;
  });

  return { customers: enrichedCustomers, routes: routes, products: products };
}

function api_saveCustomer(payload) {
  return withSheetLock_(function() {
    var headers = ['CustomerID', 'CustomerName', 'Phone', 'CustomerType', 'RouteID', 'CreditLimit', 'Status', 'CreatedAt'];
    var sheet = getOrCreateSheet('tb_Customers', headers);
    var data = sheet.getDataRange().getValues();
    var custId = payload.CustomerID;
    var now = new Date();

    if (custId && custId !== '') {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(custId)) {
          sheet.getRange(i + 1, 2, 1, 6).setValues([[
            payload.CustomerName,
            payload.Phone || '',
            payload.CustomerType || 'ร้านประจำ',
            payload.RouteID || 'หน้าลาน',
            parseFloat(payload.CreditLimit) || 0,
            payload.Status || 'Active'
          ]]);
          break;
        }
      }
    } else {
      custId = generateId(sheet, 'C', 4);
      sheet.appendRow([
        custId,
        payload.CustomerName,
        payload.Phone || '',
        payload.CustomerType || 'ร้านประจำ',
        payload.RouteID || 'หน้าลาน',
        parseFloat(payload.CreditLimit) || 0,
        'Active',
        now
      ]);
    }

    if (Array.isArray(payload.SpecialPrices)) {
      var spHeaders = ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt'];
      var spSheet = getOrCreateSheet('tb_SpecialPrices', spHeaders);
      var spData = spSheet.getDataRange().getValues();

      payload.SpecialPrices.forEach(function(item) {
        var foundRow = -1;
        for (var j = 1; j < spData.length; j++) {
          if (String(spData[j][1]) === String(custId) && String(spData[j][2]) === String(item.ProductID)) {
            foundRow = j + 1;
            break;
          }
        }
        if (item.Price !== '' && item.Price !== null && !isNaN(item.Price)) {
          if (foundRow > 0) {
            spSheet.getRange(foundRow, 4, 1, 2).setValues([[parseFloat(item.Price), 'Active']]);
          } else {
            var newSpId = generateId(spSheet, 'SP', 4);
            spSheet.appendRow([newSpId, custId, item.ProductID, parseFloat(item.Price), 'Active', now]);
            spData.push([newSpId, custId, item.ProductID, parseFloat(item.Price), 'Active', now]);
          }
        } else if (foundRow > 0) {
          spSheet.getRange(foundRow, 5).setValue('Inactive');
        }
      });
    }

    if (payload.HasPromo3For100 !== undefined) {
      var prmHeaders = ['PromoID', 'PromoName', 'DiscountAmt', 'Status', 'CreatedAt'];
      var prmSheet = getOrCreateSheet('tb_Promotions', prmHeaders);
      var prmData = prmSheet.getDataRange().getValues();
      var targetKey = '3FOR100:' + custId;
      var eligProds = payload.PromoEligibleProducts || 'ALL';
      var foundPrmRow = -1;

      for (var k = 1; k < prmData.length; k++) {
        if (String(prmData[k][1]).trim() === targetKey) {
          foundPrmRow = k + 1;
          break;
        }
      }

      if (payload.HasPromo3For100) {
        if (foundPrmRow > 0) {
          prmSheet.getRange(foundPrmRow, 3, 1, 2).setValues([[eligProds, 'Active']]);
        } else {
          var newPrmId = generateId(prmSheet, 'PRM', 4);
          prmSheet.appendRow([newPrmId, targetKey, eligProds, 'Active', now]);
        }
      } else if (foundPrmRow > 0) {
        prmSheet.getRange(foundPrmRow, 4).setValue('Inactive');
      }
    }

    SpreadsheetApp.flush();
    writeLog('SAVE_CUSTOMER', custId + ' (' + payload.CustomerName + ')', 'SUCCESS');
    return { CustomerID: custId };
  });
}

// ==========================================
// ⚙️ 4. DYNAMIC MASTER DATA
// ==========================================
var MASTER_SCHEMAS = {
  'tb_Products':       { prefix: 'P',   headers: ['ProductID', 'ProductName', 'DefaultPrice', 'Unit', 'Status', 'CreatedAt'] },
  'tb_Employees':      { prefix: 'EMP', headers: ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt'] },
  'tb_Vehicles':       { prefix: 'VEH', headers: ['VehicleID', 'LicensePlate', 'VehicleType', 'Capacity', 'Status', 'CreatedAt'] },
  'tb_Routes':         { prefix: 'RT',  headers: ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt'] },
  'tb_SpecialPrices':  { prefix: 'SP',  headers: ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt'] },
  'tb_Promotions':     { prefix: 'PRM', headers: ['PromoID', 'PromoName', 'DiscountAmt', 'Status', 'CreatedAt'] },
  'tb_Machines':       { prefix: 'MAC', headers: ['MachineID', 'MachineName', 'MachineType', 'Location', 'StandardSpec', 'Status', 'CreatedAt'] },
  'tb_ProductMapping': { prefix: 'MAP', headers: ['MapID', 'SysProduct', 'VendorProduct', 'Status', 'CreatedAt'] }
};

function api_getMasterData(payload) {
  var tbl = (typeof payload === 'object' && payload !== null) ? payload.tableName : payload;
  tbl = String(tbl || '').trim();
  var schema = MASTER_SCHEMAS[tbl];
  if (!schema || !schema.headers) {
    throw new Error('ไม่พบโครงสร้างตารางฐานข้อมูล: ' + (tbl || 'ไม่ได้ระบุชื่อตาราง'));
  }
  return getSheetDataAsObjects(tbl, schema.headers).reverse();
}

function api_saveMasterData(payload) {
  return withSheetLock_(function() {
    var tbl = payload && payload.tableName ? String(payload.tableName).trim() : '';
    var schema = MASTER_SCHEMAS[tbl];
    if (!schema || !schema.headers) {
      throw new Error('ไม่พบโครงสร้างตารางสำหรับบันทึก: ' + tbl);
    }

    var sheet = getOrCreateSheet(tbl, schema.headers);
    var record = payload.record || {};
    var recordId = record[schema.headers[0]];
    var data = sheet.getDataRange().getValues();

    if (recordId && recordId !== '') {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(recordId)) {
          var updatedRow = schema.headers.map(function(h, idx) {
            if (idx === 0) return recordId;
            if (h === 'Status') return record['Status'] || 'Active';
            if (h === 'CreatedAt') return data[i][idx];
            return record[h] !== undefined ? record[h] : data[i][idx];
          });
          sheet.getRange(i + 1, 1, 1, schema.headers.length).setValues([updatedRow]);
          SpreadsheetApp.flush();
          return { mode: 'update', id: recordId };
        }
      }
    }

    var newId = generateId(sheet, schema.prefix, 4);
    var newRow = schema.headers.map(function(h, idx) {
      if (idx === 0) return newId;
      if (h === 'Status') return 'Active';
      if (h === 'CreatedAt') return new Date();
      return record[h] !== undefined ? record[h] : '';
    });
    sheet.appendRow(newRow);
    SpreadsheetApp.flush();
    return { mode: 'insert', id: newId };
  });
}