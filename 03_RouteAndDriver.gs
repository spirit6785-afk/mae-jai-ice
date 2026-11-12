/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 03: ROUTE SETTLEMENT & DRIVER PORTAL (03_RouteAndDriver.gs)
 * Version: 5.7 (Clean Modular Architecture - Zero Duplicate Functions)
 * ⚠️ วิธีติดตั้ง: สร้างไฟล์สคริปต์ชื่อ "03_RouteAndDriver" ใน GAS แล้ววางโค้ดนี้ทั้งหมด
 * ============================================================================
 */

// ==========================================
// 📦 1. HELPER: ดึงประวัติการเบิกน้ำแข็งขึ้นรถรายรอบ
// ==========================================
function getDispatchLoadRounds_(dsp, allInvLogs) {
  var dspId = String(dsp.DispatchID || '').trim();
  var roundsMap = {};
  var roundOrder = [];

  (allInvLogs || []).forEach(function(log) {
    if (String(log.Reference || '').trim() !== dspId) return;
    var act = String(log.ActionType || '');
    var qOut = parseFloat(log.QtyOut) || 0;
    if (qOut <= 0) return;
    if (act.indexOf('เบิก') === -1) return;
    if (String(log.Note || '').indexOf('[ยกเลิกแล้ว]') !== -1) return;

    var timeKey = String(log.LogDate || '').slice(0, 16);
    var groupKey = act + '|' + timeKey;
    if (!roundsMap[groupKey]) {
      roundsMap[groupKey] = {
        RoundKey: groupKey,
        ActionType: act,
        LogTime: String(log.LogDate || '').slice(11, 16) || '-',
        LogDate: String(log.LogDate || '').slice(0, 16),
        CreatedBy: log.CreatedBy || '-',
        TotalQty: 0,
        Items: [],
        InvLogIDs: []
      };
      roundOrder.push(groupKey);
    }
    roundsMap[groupKey].TotalQty += qOut;
    roundsMap[groupKey].Items.push({
      InvLogID: log.InvLogID,
      ProductID: String(log.ProductID),
      ProductName: log.ProductName,
      Qty: qOut
    });
    roundsMap[groupKey].InvLogIDs.push(log.InvLogID);
  });

  return roundOrder.map(function(k, idx) {
    var r = roundsMap[k];
    r.RoundNo = idx + 1;
    r.SummaryText = r.Items.map(function(i) { return i.ProductName + ' x' + i.Qty; }).join(', ');
    return r;
  });
}

// ==========================================
// 🚚 2. ROUTE DISPATCH, RELOAD & SETTLEMENT ENGINE
// ==========================================
function api_getRouteSettlementData() {
  var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
  var fuelHeaders = ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note'];
  var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
  var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
  var payHeaders = ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note'];
  var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];

  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);
  var fuelLogs = getSheetDataAsObjects('tb_FuelLogs', fuelHeaders);
  var routes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']).filter(function(r) { return r.Status !== 'Inactive'; });
  var vehicles = getSheetDataAsObjects('tb_Vehicles', ['VehicleID', 'LicensePlate', 'VehicleType', 'Capacity', 'Status', 'CreatedAt']).filter(function(v) { return v.Status !== 'Inactive'; });
  var employees = getSheetDataAsObjects('tb_Employees', ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt']).filter(function(e) { return e.Status !== 'Inactive'; });
  var products = getSheetDataAsObjects('tb_Products', ['ProductID', 'ProductName', 'DefaultPrice', 'Unit', 'Status', 'CreatedAt']).filter(function(p) { return p.Status !== 'Inactive'; });

  var allSales = getSheetDataAsObjects('tb_Sales', salesHeaders);
  var allDetails = getSheetDataAsObjects('tb_SalesDetails', detailHeaders);
  var allPayments = getSheetDataAsObjects('tb_Payments', payHeaders);
  var allCustomers = api_getCustomers();
  var allInvLogs = getSheetDataAsObjects('tb_InventoryLogs', invHeaders);

  var custRouteMap = {};
  allCustomers.forEach(function(c) {
    custRouteMap[String(c.CustomerID).trim()] = String(c.RouteID || '').trim();
  });

  var qtyBySaleId = {};
  var prodSoldBySaleId = {};
  var itemSummaryBySaleId = {};
  allDetails.forEach(function(d) {
    var pid = String(d.ProductID || '').trim();
    var q = parseFloat(d.Quantity) || 0;
    if (!itemSummaryBySaleId[d.SaleID]) itemSummaryBySaleId[d.SaleID] = [];
    itemSummaryBySaleId[d.SaleID].push(d.ProductName + (q > 1 ? ' x' + q : ''));

    if (isStockProductId_(pid)) {
      qtyBySaleId[d.SaleID] = (qtyBySaleId[d.SaleID] || 0) + q;
      if (!prodSoldBySaleId[d.SaleID]) prodSoldBySaleId[d.SaleID] = {};
      prodSoldBySaleId[d.SaleID][pid] = (prodSoldBySaleId[d.SaleID][pid] || 0) + q;
    }
  });

  var unpaidDebtByCust = {};
  allSales.forEach(function(s) {
    var pType = String(s.PaymentType || '');
    var isCredit = (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1 || pType.indexOf('ยอดยกมา') !== -1);
    var isUnpaid = (s.PaymentStatus === 'Unpaid' || s.PaymentStatus === 'ค้างชำระ');
    if (isCredit && isUnpaid) {
      var cid = String(s.CustomerID || '').trim();
      unpaidDebtByCust[cid] = (unpaidDebtByCust[cid] || 0) + (parseFloat(s.TotalAmount) || 0);
    }
  });

  dispatches.forEach(function(dsp) {
    if (dsp.Status === 'กำลังวิ่งส่ง') {
      var dspDatePrefix = String(dsp.DispatchDate || '').slice(0, 10);
      var rId = String(dsp.RouteID || '').trim();
      var rName = String(dsp.RouteName || '').trim();
      var drvName = String(dsp.DriverName || '').trim();
      var vehId = String(dsp.VehicleID || '').trim();

      var liveSoldQty = 0, liveCashOnlySales = 0, liveTransferSales = 0, liveCreditSales = 0;
      var liveSoldByProd = {};
      var custSalesMap = {};
      var walkInGroupOrder = [];

      allSales.forEach(function(s) {
        var sDatePrefix = String(s.SaleDate || '').slice(0, 10);
        var isSameDate = (sDatePrefix === dspDatePrefix);
        var isSameRoute = (String(s.RouteID || '').trim() === rId || String(s.RouteID || '').trim() === rName);
        var isValid = (s.PaymentStatus !== 'Cancelled' && s.PaymentStatus !== 'ยกเลิก' && String(s.SaleID || '').indexOf('AR-') !== 0);

        if (isSameDate && isSameRoute && isValid) {
          var amt = parseFloat(s.TotalAmount) || 0;
          var pType = String(s.PaymentType || '');
          var sQty = qtyBySaleId[s.SaleID] || 0;
          liveSoldQty += sQty;

          var sProdMap = prodSoldBySaleId[s.SaleID] || {};
          for (var pid in sProdMap) {
            liveSoldByProd[pid] = (liveSoldByProd[pid] || 0) + sProdMap[pid];
          }

          if (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1) {
            liveCreditSales += amt;
          } else if (pType.indexOf('โอน') !== -1) {
            liveTransferSales += amt;
          } else {
            liveCashOnlySales += amt;
          }

          var rawCid = String(s.CustomerID || 'WALK-IN').trim();
          var isWalkIn = (rawCid === 'WALK-IN' || rawCid === '');
          var rawCName = isWalkIn
            ? normalizeWalkInName_(s.CustomerName)
            : String(s.CustomerName || 'ลูกค้าขาจรทั่วไป').trim();
          var groupKey = isWalkIn ? ('WALK-IN::' + rawCName) : rawCid;

          if (!custSalesMap[groupKey]) {
            custSalesMap[groupKey] = {
              CustomerID: groupKey,
              RawCustomerID: rawCid,
              CustomerName: rawCName,
              count: 0,
              totalAmt: 0,
              totalQty: 0,
              lastTime: String(s.SaleDate || '').slice(11, 16),
              summaries: []
            };
            if (isWalkIn) walkInGroupOrder.push(groupKey);
          }
          custSalesMap[groupKey].count++;
          custSalesMap[groupKey].totalAmt += amt;
          custSalesMap[groupKey].totalQty += sQty;
          var sumTxt = (itemSummaryBySaleId[s.SaleID] || []).join(', ');
          if (sumTxt) custSalesMap[groupKey].summaries.push(sumTxt + ' [' + pType + ']');
        }
      });

      var liveDebtCash = 0, liveDebtTransfer = 0;
      var reportDebtPaymentsList = [];
      allPayments.forEach(function(p) {
        if (String(p.PaymentDate || '').slice(0, 10) !== dspDatePrefix) return;
        var pBy = String(p.CreatedBy || '');
        var cRoute = custRouteMap[String(p.CustomerID || '').trim()] || '';
        var isByThisDriver = (drvName !== '' && pBy.indexOf(drvName) !== -1);
        var isThisRouteCust = (cRoute === rId || cRoute === rName);

        if (isByThisDriver || isThisRouteCust) {
          var pAmt = parseFloat(p.AmountPaid) || 0;
          if (String(p.PaymentMethod || '').indexOf('โอน') !== -1) liveDebtTransfer += pAmt;
          else liveDebtCash += pAmt;
          reportDebtPaymentsList.push(p);
        }
      });

      var liveFuelCash = 0, liveFuelCredit = 0;
      fuelLogs.forEach(function(f) {
        if (String(f.FuelDate || '').slice(0, 10) !== dspDatePrefix) return;
        var fDrv = String(f.DriverName || '').trim();
        var fVeh = String(f.VehicleID || '').trim();
        var matchDrv = (drvName !== '' && fDrv !== '' && (fDrv === drvName || fDrv.indexOf(drvName) !== -1 || drvName.indexOf(fDrv) !== -1));
        var matchVeh = (vehId !== '' && fVeh !== '' && fVeh === vehId);

        if (matchDrv || matchVeh) {
          var fCost = parseFloat(f.TotalCost) || 0;
          var paidBy = String(f.PaidBy || '');
          if (paidBy.indexOf('เงินสด') !== -1 || paidBy.indexOf('หัก') !== -1) liveFuelCash += fCost;
          else liveFuelCredit += fCost;
        }
      });

      var loadedItems = [];
      try { loadedItems = JSON.parse(dsp.LoadDetails || '[]'); } catch (e) { loadedItems = []; }
      var itemBreakdown = loadedItems.map(function(ld) {
        var pid = String(ld.id);
        var lQty = parseFloat(ld.qty) || 0;
        var sQty = liveSoldByProd[pid] || 0;
        return {
          id: pid,
          name: ld.name,
          loadedQty: lQty,
          soldQty: sQty,
          expectedRemain: Math.max(0, lQty - sQty)
        };
      });

      var routeCusts = allCustomers.filter(function(c) {
        var cr = String(c.RouteID || '').trim();
        return cr === rId || (rName !== '' && cr === rName);
      });

      var reportBoughtList = [];
      var reportMissedList = [];
      routeCusts.forEach(function(c) {
        if (custSalesMap[c.CustomerID]) {
          reportBoughtList.push(custSalesMap[c.CustomerID]);
        } else {
          reportMissedList.push({
            CustomerID: c.CustomerID,
            CustomerName: c.CustomerName,
            Phone: c.Phone || '-',
            TotalDebt: unpaidDebtByCust[c.CustomerID] || 0
          });
        }
      });

      walkInGroupOrder.forEach(function(wKey) {
        var wInfo = custSalesMap[wKey];
        if (wInfo) {
          reportBoughtList.push({
            CustomerID: wInfo.CustomerID,
            CustomerName: wInfo.CustomerName + (wInfo.count > 1 ? ' (' + wInfo.count + ' บิล)' : ''),
            count: wInfo.count,
            totalAmt: wInfo.totalAmt,
            totalQty: wInfo.totalQty,
            lastTime: wInfo.lastTime,
            summaries: wInfo.summaries
          });
        }
      });

      dsp.LiveSoldQty = liveSoldQty;
      dsp.LiveCashOnlySales = liveCashOnlySales;
      dsp.LiveDebtCash = liveDebtCash;
      dsp.LiveDebtTransfer = liveDebtTransfer;
      dsp.LiveCashSales = liveCashOnlySales + liveDebtCash;
      dsp.LiveTransferSales = liveTransferSales;
      dsp.LiveCreditSales = liveCreditSales;
      dsp.LiveFuelCash = liveFuelCash;
      dsp.LiveFuelExpense = liveFuelCash;
      dsp.LiveFuelCredit = liveFuelCredit;
      dsp.ItemBreakdown = itemBreakdown;
      dsp.ReportBoughtList = reportBoughtList;
      dsp.ReportMissedList = reportMissedList;
      dsp.ReportDebtPaymentsList = reportDebtPaymentsList;
      dsp.LoadRounds = getDispatchLoadRounds_(dsp, allInvLogs);
    }
  });

  return {
    dispatches: dispatches.reverse().slice(0, 40),
    fuelLogs: fuelLogs.reverse().slice(0, 40),
    routes: routes,
    vehicles: vehicles,
    employees: employees,
    products: products
  };
}

function api_createDispatch(payload) {
  return withSheetLock_(function() {
    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var sheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var existingDispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);

    var reqRouteId = String(payload.RouteID || '').trim();
    var reqDriver = String(payload.DriverName || '').trim();

    var duplicateActive = existingDispatches.find(function(d) {
      if (String(d.Status || '').trim() !== 'กำลังวิ่งส่ง') return false;
      var sameRoute = reqRouteId !== '' && String(d.RouteID || '').trim() === reqRouteId;
      var sameDriver = reqDriver !== '' && String(d.DriverName || '').trim() === reqDriver;
      return sameRoute || sameDriver;
    });

    if (duplicateActive) {
      throw new Error('สายส่ง "' + duplicateActive.RouteName + '" (คนขับ: ' + duplicateActive.DriverName + ') มีกะที่กำลังวิ่งส่งอยู่แล้ว (' + duplicateActive.DispatchID + ') หากต้องการเพิ่มน้ำแข็ง กรุณากดปุ่ม "เบิกน้ำแข็งเพิ่ม" แทนการเปิดกะใหม่ค่ะ');
    }

    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var dspId = generateId(sheet, 'DSP-' + datePrefix, 4);
    var loadedQty = parseFloat(payload.LoadedQty) || 0;
    var noteStr = payload.LoadDetailsText ? ('เบิก: ' + payload.LoadDetailsText + (payload.Note ? ' | ' + payload.Note : '')) : (payload.Note || '');

    sheet.appendRow([
      dspId,
      now,
      reqRouteId,
      payload.RouteName || '',
      payload.VehicleID || '',
      reqDriver,
      parseFloat(payload.StartMileage) || 0,
      0,
      loadedQty,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'กำลังวิ่งส่ง',
      noteStr,
      payload.LoadDetailsJSON || '[]'
    ]);

    var detailsArr = [];
    try { detailsArr = JSON.parse(payload.LoadDetailsJSON || '[]'); } catch (e) { detailsArr = []; }
    if (detailsArr.length > 0) {
      var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
      var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);
      var invLastRow = invSheet.getLastRow();
      var invRows = [];

      detailsArr.forEach(function(item) {
        var q = parseFloat(item.qty) || 0;
        if (q > 0) {
          var invId = 'INV-' + datePrefix + '-' + (invLastRow + invRows.length + 1).toString().padStart(4, '0');
          invRows.push([
            invId,
            now,
            String(item.id || '').trim(),
            item.name,
            'เบิกขึ้นรถ',
            0,
            q,
            dspId,
            reqDriver || 'Admin',
            'ปล่อยรถสาย: ' + (payload.RouteName || reqRouteId)
          ]);
        }
      });

      if (invRows.length > 0) {
        invSheet.getRange(invLastRow + 1, 1, invRows.length, 10).setValues(invRows);
      }
    }

    SpreadsheetApp.flush();
    writeLog('CREATE_DISPATCH', dspId + ' (' + payload.RouteName + ')', 'SUCCESS');
    return { DispatchID: dspId };
  });
}

function api_reloadDispatch(payload) {
  return withSheetLock_(function() {
    var dspId = payload && payload.DispatchID ? String(payload.DispatchID).trim() : '';
    var addedQty = parseFloat(payload.AddedQty) || 0;
    if (!dspId) throw new Error('ไม่พบรหัสใบปล่อยรถที่ต้องการเบิกเพิ่ม');
    if (addedQty <= 0) throw new Error('กรุณาระบุจำนวนน้ำแข็งที่เบิกเพิ่มอย่างน้อย 1 รายการ');

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var dspSheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var dspData = dspSheet.getDataRange().getValues();

    var rowIdx = -1;
    for (var i = 1; i < dspData.length; i++) {
      if (String(dspData[i][0]) === dspId) {
        if (dspData[i][20] !== 'กำลังวิ่งส่ง') {
          throw new Error('ใบปล่อยรถนี้ปิดกะไปแล้ว ไม่สามารถเบิกเพิ่มได้');
        }
        rowIdx = i;
        break;
      }
    }
    if (rowIdx === -1) throw new Error('ไม่พบใบปล่อยรถรหัส: ' + dspId);

    var addedArr = [];
    try { addedArr = JSON.parse(payload.AddedDetailsJSON || '[]'); } catch (e) { addedArr = []; }
    if (addedArr.length === 0) throw new Error('ข้อมูลรายการสินค้าไม่ถูกต้อง');

    var currentLoadedQty = parseFloat(dspData[rowIdx][8]) || 0;
    var newLoadedQty = currentLoadedQty + addedQty;

    var currentDetails = [];
    try { currentDetails = JSON.parse(dspData[rowIdx][22] || '[]'); } catch (e) { currentDetails = []; }

    addedArr.forEach(function(addItem) {
      var addQ = parseFloat(addItem.qty) || 0;
      if (addQ <= 0) return;
      var found = false;
      currentDetails.forEach(function(curItem) {
        if (String(curItem.id) === String(addItem.id)) {
          curItem.qty = (parseFloat(curItem.qty) || 0) + addQ;
          found = true;
        }
      });
      if (!found) {
        currentDetails.push({ id: addItem.id, name: addItem.name, qty: addQ });
      }
    });

    var now = new Date();
    var timeStr = Utilities.formatDate(now, 'GMT+7', 'HH:mm');
    var oldNote = String(dspData[rowIdx][21] || '');
    var newNote = oldNote + ' | เบิกเพิ่ม (' + timeStr + '): ' + (payload.AddedDetailsText || '') + (payload.Note ? ' [' + payload.Note + ']' : '');

    dspSheet.getRange(rowIdx + 1, 9).setValue(newLoadedQty);
    dspSheet.getRange(rowIdx + 1, 22, 1, 2).setValues([[newNote, JSON.stringify(currentDetails)]]);

    var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
    var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);
    var invLastRow = invSheet.getLastRow();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var invRows = [];
    var routeName = dspData[rowIdx][3] || dspData[rowIdx][2];
    var driverName = dspData[rowIdx][5] || 'Driver';

    addedArr.forEach(function(item) {
      var q = parseFloat(item.qty) || 0;
      if (q > 0) {
        var invId = 'INV-' + datePrefix + '-' + (invLastRow + invRows.length + 1).toString().padStart(4, '0');
        invRows.push([
          invId,
          now,
          String(item.id || '').trim(),
          item.name,
          'เบิกเพิ่มขึ้นรถ',
          0,
          q,
          dspId,
          payload.CreatedBy || driverName,
          'เบิกเพิ่มระหว่างวัน สาย: ' + routeName + (payload.Note ? ' (' + payload.Note + ')' : '')
        ]);
      }
    });

    if (invRows.length > 0) {
      invSheet.getRange(invLastRow + 1, 1, invRows.length, 10).setValues(invRows);
    }

    SpreadsheetApp.flush();
    writeLog('RELOAD_DISPATCH', dspId + ' (+' + addedQty + ' หน่วย)', 'SUCCESS');
    return { DispatchID: dspId, NewLoadedQty: newLoadedQty };
  });
}

function api_closeDispatch(payload) {
  return withSheetLock_(function() {
    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var sheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var data = sheet.getDataRange().getValues();
    var foundRow = -1;
    var dspRouteId = '';
    var dspRouteName = '';
    var dspDriverName = '';
    var existingNote = '';

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.DispatchID).trim()) {
        foundRow = i + 1;
        dspRouteId = String(data[i][2] || '').trim();
        dspRouteName = String(data[i][3] || '').trim();
        dspDriverName = String(data[i][5] || '').trim();
        existingNote = String(data[i][21] || '');
        break;
      }
    }
    if (foundRow === -1) throw new Error('ไม่พบใบปล่อยรถรหัส: ' + payload.DispatchID);

    var loadedQty = parseFloat(data[foundRow - 1][8]) || 0;
    var soldQty = parseFloat(payload.SoldQty) || 0;
    var returnedQty = parseFloat(payload.ReturnedQty) || 0;
    var lossQty = Math.max(0, loadedQty - soldQty - returnedQty);

    var cashSales = parseFloat(payload.CashSales) || 0;
    var transferSales = parseFloat(payload.TransferSales) || 0;
    var creditSales = parseFloat(payload.CreditSales) || 0;
    var fuelExp = parseFloat(payload.FuelExpense) || 0;
    var otherExp = parseFloat(payload.OtherExpense) || 0;

    var expectedCash = cashSales - fuelExp - otherExp;
    var actualCash = parseFloat(payload.ActualCash) || 0;
    var cashDiff = actualCash - expectedCash;

    var closeNote = payload.CloseNote ? (' | ปิดกะ: ' + payload.CloseNote) : '';
    var finalNote = existingNote + closeNote;

    sheet.getRange(foundRow, 8, 1, 15).setValues([[
      parseFloat(payload.EndMileage) || parseFloat(data[foundRow - 1][7]) || 0,
      loadedQty,
      soldQty,
      returnedQty,
      lossQty,
      cashSales,
      transferSales,
      creditSales,
      fuelExp,
      otherExp,
      expectedCash,
      actualCash,
      cashDiff,
      'ปิดกะแล้ว',
      finalNote
    ]]);

    for (var k = 1; k < data.length; k++) {
      if ((k + 1) === foundRow) continue;
      var rowStatus = String(data[k][20] || '').trim();
      var rowRouteId = String(data[k][2] || '').trim();
      var rowDriver = String(data[k][5] || '').trim();
      if (rowStatus === 'กำลังวิ่งส่ง' && ((dspRouteId !== '' && rowRouteId === dspRouteId) || (dspDriverName !== '' && rowDriver === dspDriverName))) {
        sheet.getRange(k + 1, 21).setValue('ปิดกะแล้ว');
      }
    }

    var returnItems = payload.ReturnItems || [];
    if (Array.isArray(returnItems) && returnItems.length > 0) {
      var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
      var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);
      var invLastRow = invSheet.getLastRow();
      var now = new Date();
      var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
      var invRows = [];

      returnItems.forEach(function(item) {
        var rQty = parseFloat(item.qty) || 0;
        if (rQty > 0) {
          var invId = 'INV-' + datePrefix + '-' + (invLastRow + invRows.length + 1).toString().padStart(4, '0');
          invRows.push([
            invId,
            now,
            String(item.id || '').trim(),
            item.name,
            'รับคืนจากรถสายส่ง (ปิดกะ)',
            rQty,
            0,
            payload.DispatchID,
            dspDriverName || 'Admin',
            'ตีคืนคลังจาก ' + dspRouteName
          ]);
        }
      });

      if (invRows.length > 0) {
        invSheet.getRange(invLastRow + 1, 1, invRows.length, 10).setValues(invRows);
      }
    }

    SpreadsheetApp.flush();
    writeLog('CLOSE_DISPATCH', payload.DispatchID + ' | ขาย: ' + soldQty + ' | คืน: ' + returnedQty + ' | หาย/ละลาย: ' + lossQty + ' | เงินส่งจริง: ฿' + actualCash + ' (Diff: ' + cashDiff + ')', lossQty > 0 || cashDiff < 0 ? 'WARNING' : 'SUCCESS');
    return { DispatchID: payload.DispatchID, LossQty: lossQty, CashDiff: cashDiff };
  });
}

function api_cancelDispatchLoadItem(payload) {
  return withSheetLock_(function() {
    var dspId = payload && payload.DispatchID ? String(payload.DispatchID).trim() : '';
    var invLogIds = payload && payload.InvLogIDs ? payload.InvLogIDs : [];
    if (!dspId || !Array.isArray(invLogIds) || invLogIds.length === 0) {
      throw new Error('ไม่พบรหัสรายการเบิกน้ำแข็งที่ต้องการยกเลิก');
    }

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];

    var dspSheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);

    var dspData = dspSheet.getDataRange().getValues();
    var dspRowIdx = -1;
    for (var i = 1; i < dspData.length; i++) {
      if (String(dspData[i][0]).trim() === dspId) {
        if (String(dspData[i][20]).trim() !== 'กำลังวิ่งส่ง') {
          throw new Error('กะสายส่งนี้ปิดกะไปแล้ว ไม่สามารถลบรายการเบิกได้ค่ะ');
        }
        dspRowIdx = i;
        break;
      }
    }
    if (dspRowIdx === -1) throw new Error('ไม่พบใบปล่อยรถรหัส: ' + dspId);

    var targetSet = {};
    invLogIds.forEach(function(id) { targetSet[String(id).trim()] = true; });

    var invData = invSheet.getDataRange().getValues();
    var deductByProd = {};
    var deductNameByProd = {};
    var totalDeductQty = 0;
    var rowsToMarkCancelled = [];

    for (var j = 1; j < invData.length; j++) {
      var logId = String(invData[j][0]).trim();
      var refId = String(invData[j][7]).trim();
      var noteStr = String(invData[j][9] || '');
      if (targetSet[logId] && refId === dspId && noteStr.indexOf('[ยกเลิกแล้ว]') === -1) {
        var pid = String(invData[j][2]).trim();
        var pname = String(invData[j][3] || pid);
        var qOut = parseFloat(invData[j][6]) || 0;
        if (qOut > 0) {
          deductByProd[pid] = (deductByProd[pid] || 0) + qOut;
          deductNameByProd[pid] = pname;
          totalDeductQty += qOut;
          rowsToMarkCancelled.push({ rowNum: j + 1, oldNote: noteStr, pid: pid, pname: pname, qty: qOut });
        }
      }
    }

    if (totalDeductQty <= 0) {
      throw new Error('รายการเบิกนี้ถูกยกเลิกไปแล้ว หรือไม่พบข้อมูลในระบบค่ะ');
    }

    var curLoadedQty = parseFloat(dspData[dspRowIdx][8]) || 0;
    var curDetails = [];
    try { curDetails = JSON.parse(dspData[dspRowIdx][22] || '[]'); } catch (e) { curDetails = []; }

    curDetails.forEach(function(item) {
      var pid = String(item.id);
      if (deductByProd[pid]) {
        item.qty = Math.max(0, (parseFloat(item.qty) || 0) - deductByProd[pid]);
      }
    });
    curDetails = curDetails.filter(function(item) { return (parseFloat(item.qty) || 0) > 0; });

    var newLoadedQty = Math.max(0, curLoadedQty - totalDeductQty);
    var now = new Date();
    var timeStr = Utilities.formatDate(now, 'GMT+7', 'HH:mm');
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');

    var deductSummary = Object.keys(deductByProd).map(function(pid) {
      return deductNameByProd[pid] + ' -' + deductByProd[pid];
    }).join(', ');
    var oldDspNote = String(dspData[dspRowIdx][21] || '');
    var newDspNote = oldDspNote + ' | ❌ ลบเบิกผิด (' + timeStr + '): ' + deductSummary;

    dspSheet.getRange(dspRowIdx + 1, 9).setValue(newLoadedQty);
    dspSheet.getRange(dspRowIdx + 1, 22, 1, 2).setValues([[newDspNote, JSON.stringify(curDetails)]]);

    var invLastRow = invSheet.getLastRow();
    var refundRows = [];
    var routeName = String(dspData[dspRowIdx][3] || '');
    var cancelledBy = payload.CreatedBy || 'Admin';

    rowsToMarkCancelled.forEach(function(r, idx) {
      invSheet.getRange(r.rowNum, 10).setValue('[ยกเลิกแล้ว] ' + r.oldNote);
      var newInvId = 'INV-' + datePrefix + '-' + (invLastRow + idx + 1).toString().padStart(4, '0');
      refundRows.push([
        newInvId,
        now,
        r.pid,
        r.pname,
        'คืนสต๊อก (ลบเบิกขึ้นรถผิด)',
        r.qty,
        0,
        dspId,
        cancelledBy,
        'คืนสต๊อกจากลบเบิกผิด สาย: ' + routeName
      ]);
    });

    if (refundRows.length > 0) {
      invSheet.getRange(invLastRow + 1, 1, refundRows.length, 10).setValues(refundRows);
    }

    SpreadsheetApp.flush();
    writeLog('CANCEL_LOAD_ROUND', dspId + ' | คืนสต๊อก ' + totalDeductQty + ' หน่วย (' + deductSummary + ') โดย ' + cancelledBy, 'WARNING');
    return { DispatchID: dspId, DeductedQty: totalDeductQty, NewLoadedQty: newLoadedQty };
  });
}

function api_cancelEntireDispatch(payload) {
  return withSheetLock_(function() {
    var dspId = payload && payload.DispatchID ? String(payload.DispatchID).trim() : '';
    if (!dspId) throw new Error('ไม่พบรหัสใบปล่อยรถที่ต้องการยกเลิก');

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];

    var dspSheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);

    var dspData = dspSheet.getDataRange().getValues();
    var foundRow = -1;
    var routeName = '';

    for (var i = 1; i < dspData.length; i++) {
      if (String(dspData[i][0]).trim() === dspId) {
        foundRow = i + 1;
        routeName = String(dspData[i][3] || '');
        break;
      }
    }
    if (foundRow === -1) throw new Error('ไม่พบใบปล่อยรถรหัส: ' + dspId);

    var invData = invSheet.getDataRange().getValues();
    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var invLastRow = invSheet.getLastRow();
    var refundRows = [];
    var cancelledBy = payload.CreatedBy || 'Admin';

    for (var j = 1; j < invData.length; j++) {
      if (String(invData[j][7]).trim() === dspId && String(invData[j][9] || '').indexOf('[ยกเลิกแล้ว]') === -1) {
        var qOut = parseFloat(invData[j][6]) || 0;
        if (qOut > 0) {
          invSheet.getRange(j + 1, 10).setValue('[ยกเลิกแล้ว] ' + String(invData[j][9] || ''));
          var newInvId = 'INV-' + datePrefix + '-' + (invLastRow + refundRows.length + 1).toString().padStart(4, '0');
          refundRows.push([
            newInvId,
            now,
            invData[j][2],
            invData[j][3],
            'คืนสต๊อก (ยกเลิกใบปล่อยรถ)',
            qOut,
            0,
            dspId,
            cancelledBy,
            'ยกเลิกใบปล่อยรถทั้งกะ สาย: ' + routeName
          ]);
        }
      }
    }

    if (refundRows.length > 0) {
      invSheet.getRange(invLastRow + 1, 1, refundRows.length, 10).setValues(refundRows);
    }

    dspSheet.deleteRow(foundRow);
    SpreadsheetApp.flush();
    writeLog('CANCEL_ENTIRE_DISPATCH', dspId + ' (' + routeName + ') โดย ' + cancelledBy, 'WARNING');
    return { DispatchID: dspId, Status: 'Deleted' };
  });
}

// ==========================================
// 📱 3. DRIVER MOBILE PORTAL ENGINE
// ==========================================
function api_getDriverInitData(payload) {
  var empHeaders = ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt'];
  var empSheet = getOrCreateSheet('tb_Employees', empHeaders);
  if (empSheet.getLastRow() <= 1) {
    empSheet.appendRow(['EMP-0001', 'สมชาย (สายส่ง)', '081-111-1111', 'คนขับรถ', '1111', 'Active', new Date()]);
  }

  var employees = getSheetDataAsObjects('tb_Employees', empHeaders).filter(function(e) { return e.Status !== 'Inactive'; });
  var pin = payload && payload.pin ? String(payload.pin).trim() : '';
  if (!pin) throw new Error('กรุณากรอกรหัส PIN พนักงาน');

  var driver = employees.find(function(e) {
    var empPin = String(e.PIN || '').trim();
    var phoneLast4 = String(e.Phone || '').replace(/\D/g, '').slice(-4);
    return empPin === pin || (phoneLast4 !== '' && phoneLast4 === pin);
  });

  if (!driver) {
    throw new Error('รหัส PIN ไม่ถูกต้อง กรุณาตรวจสอบกับเสมียนหน้าลาน');
  }

  var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);
  var activeDispatches = dispatches.filter(function(d) {
    return String(d.Status || '').trim() === 'กำลังวิ่งส่ง';
  });

  var drvName = String(driver.EmpName || '').trim();
  var myDispatch = null;

  for (var i = activeDispatches.length - 1; i >= 0; i--) {
    var dDrv = String(activeDispatches[i].DriverName || '').trim();
    if (dDrv !== '' && drvName !== '' && (dDrv === drvName || dDrv.indexOf(drvName) !== -1 || drvName.indexOf(dDrv) !== -1)) {
      myDispatch = activeDispatches[i];
      break;
    }
  }

  var vehicles = getSheetDataAsObjects('tb_Vehicles', ['VehicleID', 'LicensePlate', 'VehicleType', 'Capacity', 'Status', 'CreatedAt']);
  var products = getSheetDataAsObjects('tb_Products', ['ProductID', 'ProductName', 'DefaultPrice', 'Unit', 'Status', 'CreatedAt']).filter(function(p) { return p.Status !== 'Inactive'; });

  if (!myDispatch) {
    return {
      driver: driver,
      lockedRoute: null,
      myDispatch: null,
      otherActiveRoutes: [],
      vehicles: vehicles,
      products: products,
      customers: [],
      specialPrices: [],
      promoMap: {},
      customerDebtMap: {},
      todayDebtPayments: [],
      todayRouteSales: [],
      todayTransfers: [],
      todayFuelLogs: []
    };
  }

  var myRouteId = String(myDispatch.RouteID || '').trim();
  var myRouteName = String(myDispatch.RouteName || '').trim();
  var allRoutes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']);
  var lockedRoute = allRoutes.find(function(r) { return String(r.RouteID) === myRouteId; }) || { RouteID: myRouteId, RouteName: myRouteName };

  var otherActiveRoutes = activeDispatches.filter(function(d) {
    return String(d.DispatchID) !== String(myDispatch.DispatchID);
  }).map(function(d) {
    return { DispatchID: d.DispatchID, RouteID: d.RouteID, RouteName: d.RouteName, DriverName: d.DriverName, VehicleID: d.VehicleID };
  });

  var allCustomers = api_getCustomers();
  var myCustIdSet = {};
  var custNameById = {};
  var myCustomers = allCustomers.filter(function(c) {
    var cRoute = String(c.RouteID || '').trim();
    var match = (cRoute === myRouteId || (myRouteName !== '' && cRoute === myRouteName));
    if (match) {
      myCustIdSet[String(c.CustomerID)] = true;
      custNameById[String(c.CustomerID)] = c.CustomerName;
    }
    return match;
  });

  var allSpecialPrices = getSheetDataAsObjects('tb_SpecialPrices', ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt']);
  var mySpecialPrices = allSpecialPrices.filter(function(sp) {
    return sp.Status !== 'Inactive' && myCustIdSet[String(sp.CustomerID)];
  });
  var promoMap = getCustomerPromoMap_();

  var dspDatePrefix = String(myDispatch.DispatchDate || '').slice(0, 10) || Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);

  var targetSaleIds = {};
  var rawTodaySales = [];
  var rawUnpaidSales = [];

  for (var sIdx = 0; sIdx < sales.length; sIdx++) {
    var s = sales[sIdx];
    var sStatus = String(s.PaymentStatus || '');
    if (sStatus === 'Cancelled' || sStatus === 'ยกเลิก') continue;

    var sRoute = String(s.RouteID || '');
    var sCustId = String(s.CustomerID || '');
    var isMyRouteSale = (sRoute === myRouteId || (myRouteName !== '' && sRoute === myRouteName));
    var isMyCustSale = !!myCustIdSet[sCustId];

    if (!isMyRouteSale && !isMyCustSale) continue;

    var isManualAr = String(s.SaleID || '').indexOf('AR-') === 0;
    var isSameShiftDate = String(s.SaleDate || '').indexOf(dspDatePrefix) === 0;
    var isUnpaid = (sStatus === 'Unpaid' || sStatus === 'ค้างชำระ');
    var pType = String(s.PaymentType || '');
    var isCredit = (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1 || pType.indexOf('ยอดยกมา') !== -1);

    if (!isManualAr && isSameShiftDate && isMyRouteSale) {
      rawTodaySales.push(s);
      targetSaleIds[s.SaleID] = true;
    }
    if (isUnpaid && isCredit) {
      rawUnpaidSales.push(s);
      targetSaleIds[s.SaleID] = true;
    }
  }

  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal']);
  var qtyBySaleId = {};
  var itemSummaryBySaleId = {};
  var itemDetailsBySaleId = {};

  for (var dIdx = 0; dIdx < saleDetails.length; dIdx++) {
    var d = saleDetails[dIdx];
    var sid = d.SaleID;
    if (!targetSaleIds[sid]) continue;

    var q = parseFloat(d.Quantity) || 0;
    if (isStockProductId_(d.ProductID)) {
      qtyBySaleId[sid] = (qtyBySaleId[sid] || 0) + q;
      if (!itemDetailsBySaleId[sid]) itemDetailsBySaleId[sid] = [];
      itemDetailsBySaleId[sid].push({
        ProductID: String(d.ProductID),
        ProductName: String(d.ProductName),
        Quantity: q
      });
    }
    if (!itemSummaryBySaleId[sid]) itemSummaryBySaleId[sid] = [];
    itemSummaryBySaleId[sid].push(d.ProductName + (q > 1 ? ' x' + q : ''));
  }

  var todayRouteSales = rawTodaySales.map(function(s) {
    s.TotalQty = qtyBySaleId[s.SaleID] || 0;
    s.ItemSummary = (itemSummaryBySaleId[s.SaleID] || []).join(', ');
    s.Items = itemDetailsBySaleId[s.SaleID] || [];
    return s;
  }).reverse();

  var customerDebtMap = {};
  rawUnpaidSales.forEach(function(s) {
    var rawCid = String(s.CustomerID || 'WALK-IN').trim();
    var isWalkIn = (rawCid === 'WALK-IN' || rawCid === '');
    var resolvedCustName = isWalkIn
      ? normalizeWalkInName_(s.CustomerName)
      : String(s.CustomerName || custNameById[rawCid] || 'ลูกค้าขาจรทั่วไป').trim();
    var debtKey = isWalkIn ? ('WALK-IN::' + resolvedCustName) : rawCid;

    if (!customerDebtMap[debtKey]) {
      customerDebtMap[debtKey] = {
        CustomerID: debtKey,
        RawCustomerID: rawCid,
        CustomerName: resolvedCustName,
        IsWalkIn: isWalkIn,
        totalDebt: 0,
        billCount: 0,
        bills: []
      };
    }
    var bAmt = parseFloat(s.TotalAmount) || 0;
    customerDebtMap[debtKey].totalDebt += bAmt;
    customerDebtMap[debtKey].billCount++;
    customerDebtMap[debtKey].bills.push({
      SaleID: s.SaleID,
      SaleDate: String(s.SaleDate || '').slice(0, 10),
      CustomerName: resolvedCustName,
      TotalAmount: bAmt,
      ItemSummary: (itemSummaryBySaleId[s.SaleID] || []).join(', ') || 'ยอดค้างชำระ'
    });
  });

  var trfHeaders = ['TransferID', 'TransferDate', 'FromDispatchID', 'FromRouteID', 'FromRouteName', 'ToDispatchID', 'ToRouteID', 'ToRouteName', 'ProductID', 'ProductName', 'Quantity', 'Unit', 'CreatedBy', 'Note'];
  var allTransfers = getSheetDataAsObjects('tb_IceTransfers', trfHeaders);
  var todayTransfers = allTransfers.filter(function(t) {
    var isSameShiftDate = String(t.TransferDate || '').indexOf(dspDatePrefix) === 0;
    var isInvolved = String(t.FromRouteID) === myRouteId || String(t.ToRouteID) === myRouteId || String(t.FromDispatchID) === String(myDispatch.DispatchID) || String(t.ToDispatchID) === String(myDispatch.DispatchID);
    return isSameShiftDate && isInvolved;
  }).reverse();

  var fuelHeaders = ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note'];
  var allFuels = getSheetDataAsObjects('tb_FuelLogs', fuelHeaders);
  var myVeh = String(myDispatch.VehicleID || '').trim();
  var myDspDrv = String(myDispatch.DriverName || '').trim();

  var todayFuelLogs = allFuels.filter(function(f) {
    var isSameShiftDate = String(f.FuelDate || '').indexOf(dspDatePrefix) === 0;
    if (!isSameShiftDate) return false;
    var fDrv = String(f.DriverName || '').trim();
    var fVeh = String(f.VehicleID || '').trim();
    var matchDrv = (fDrv !== '' && (fDrv === drvName || fDrv === myDspDrv || fDrv.indexOf(drvName) !== -1 || drvName.indexOf(fDrv) !== -1));
    var matchVeh = (myVeh !== '' && fVeh === myVeh);
    return matchDrv || matchVeh;
  }).reverse();

  var payHeaders = ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note'];
  var allPayments = getSheetDataAsObjects('tb_Payments', payHeaders);
  var todayDebtPayments = allPayments.filter(function(p) {
    var isSameShiftDate = String(p.PaymentDate || '').indexOf(dspDatePrefix) === 0;
    var isByDriver = String(p.CreatedBy || '').indexOf(drvName) !== -1 || myCustIdSet[String(p.CustomerID)];
    return isSameShiftDate && isByDriver;
  }).reverse();

  return {
    driver: driver,
    lockedRoute: lockedRoute,
    myDispatch: myDispatch,
    otherActiveRoutes: otherActiveRoutes,
    vehicles: vehicles,
    products: products,
    customers: myCustomers,
    specialPrices: mySpecialPrices,
    promoMap: promoMap,
    customerDebtMap: customerDebtMap,
    todayDebtPayments: todayDebtPayments,
    todayRouteSales: todayRouteSales,
    todayTransfers: todayTransfers,
    todayFuelLogs: todayFuelLogs
  };
}

function api_saveIceTransfer(payload) {
  return withSheetLock_(function() {
    var qty = parseFloat(payload.Quantity) || 0;
    if (qty <= 0) throw new Error('กรุณาระบุจำนวนน้ำแข็งที่ต้องการโอนให้ถูกต้อง');
    if (!payload.FromDispatchID || !payload.ToDispatchID) throw new Error('กรุณาเลือกสายส่งปลายทางที่ต้องการโอนไป');
    if (String(payload.FromDispatchID) === String(payload.ToDispatchID)) throw new Error('ไม่สามารถโอนเข้าสายส่งตัวเองได้');

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var dspSheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var dspData = dspSheet.getDataRange().getValues();

    var fromRowIdx = -1, toRowIdx = -1;
    for (var i = 1; i < dspData.length; i++) {
      if (String(dspData[i][0]) === String(payload.FromDispatchID)) fromRowIdx = i;
      if (String(dspData[i][0]) === String(payload.ToDispatchID)) toRowIdx = i;
    }

    if (fromRowIdx === -1) throw new Error('ไม่พบใบปล่อยรถต้นทาง');
    if (toRowIdx === -1) throw new Error('ไม่พบใบปล่อยรถปลายทางที่กำลังวิ่งอยู่');
    if (String(dspData[fromRowIdx][20]) !== 'กำลังวิ่งส่ง') throw new Error('ใบปล่อยรถต้นทางปิดกะไปแล้ว ไม่สามารถโอนได้');

    var pid = String(payload.ProductID);
    var pname = String(payload.ProductName || '');

    var fromLoadedQty = (parseFloat(dspData[fromRowIdx][8]) || 0) - qty;
    var fromDetails = [];
    try { fromDetails = JSON.parse(dspData[fromRowIdx][22] || '[]'); } catch (e) { fromDetails = []; }
    fromDetails.forEach(function(item) {
      if (String(item.id) === pid) item.qty = Math.max(0, (parseFloat(item.qty) || 0) - qty);
    });
    var fromNote = String(dspData[fromRowIdx][21] || '') + ' | โอนให้ ' + dspData[toRowIdx][3] + ': ' + pname + ' x' + qty;
    dspSheet.getRange(fromRowIdx + 1, 9).setValue(fromLoadedQty);
    dspSheet.getRange(fromRowIdx + 1, 22, 1, 2).setValues([[fromNote, JSON.stringify(fromDetails)]]);

    var toLoadedQty = (parseFloat(dspData[toRowIdx][8]) || 0) + qty;
    var toDetails = [];
    try { toDetails = JSON.parse(dspData[toRowIdx][22] || '[]'); } catch (e) { toDetails = []; }
    var foundInTo = false;
    toDetails.forEach(function(item) {
      if (String(item.id) === pid) {
        item.qty = (parseFloat(item.qty) || 0) + qty;
        foundInTo = true;
      }
    });
    if (!foundInTo) {
      toDetails.push({ id: pid, name: pname, qty: qty });
    }
    var toNote = String(dspData[toRowIdx][21] || '') + ' | รับโอนจาก ' + dspData[fromRowIdx][3] + ': ' + pname + ' x' + qty;
    dspSheet.getRange(toRowIdx + 1, 9).setValue(toLoadedQty);
    dspSheet.getRange(toRowIdx + 1, 22, 1, 2).setValues([[toNote, JSON.stringify(toDetails)]]);

    var trfHeaders = ['TransferID', 'TransferDate', 'FromDispatchID', 'FromRouteID', 'FromRouteName', 'ToDispatchID', 'ToRouteID', 'ToRouteName', 'ProductID', 'ProductName', 'Quantity', 'Unit', 'CreatedBy', 'Note'];
    var trfSheet = getOrCreateSheet('tb_IceTransfers', trfHeaders);
    var now = new Date();
    var trfId = generateId(trfSheet, 'TRF-' + Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd'), 4);

    trfSheet.appendRow([
      trfId,
      now,
      payload.FromDispatchID,
      dspData[fromRowIdx][2],
      dspData[fromRowIdx][3],
      payload.ToDispatchID,
      dspData[toRowIdx][2],
      dspData[toRowIdx][3],
      pid,
      pname,
      qty,
      payload.Unit || 'หน่วย',
      payload.DriverName || 'คนขับรถ',
      payload.Note || ''
    ]);

    SpreadsheetApp.flush();
    writeLog('ICE_TRANSFER', trfId + ': ' + dspData[fromRowIdx][3] + ' -> ' + dspData[toRowIdx][3] + ' (' + pname + ' x' + qty + ')', 'SUCCESS');
    return { TransferID: trfId };
  });
}

function api_updateDriverMileage(payload) {
  return withSheetLock_(function() {
    var dspId = payload && payload.DispatchID ? String(payload.DispatchID).trim() : '';
    var type = payload && payload.Type ? String(payload.Type).toUpperCase().trim() : 'START';
    var mile = parseFloat(payload.Mileage) || 0;

    if (!dspId) throw new Error('ไม่พบรหัสใบปล่อยรถ');
    if (mile <= 0) throw new Error('กรุณากรอกเลขไมล์หน้าปัดรถให้ถูกต้อง (ต้องมากกว่า 0)');

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var sheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === dspId) {
        var currentStart = parseFloat(data[i][6]) || 0;
        if (type === 'START') {
          sheet.getRange(i + 1, 7).setValue(mile);
        } else {
          if (currentStart > 0 && mile < currentStart) {
            throw new Error('เลขไมล์หลังส่งเสร็จ (' + mile + ') ต้องไม่น้อยกว่าเลขไมล์ก่อนออกส่ง (' + currentStart + ')');
          }
          sheet.getRange(i + 1, 8).setValue(mile);
        }
        SpreadsheetApp.flush();
        writeLog('DRIVER_MILEAGE_' + type, dspId + ' -> ' + mile + ' km', 'SUCCESS');
        return { DispatchID: dspId, Type: type, Mileage: mile };
      }
    }
    throw new Error('ไม่พบใบปล่อยรถรหัส: ' + dspId);
  });
}