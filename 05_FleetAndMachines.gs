/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 05: FLEET, FUEL & FACTORY MACHINES (05_FleetAndMachines.gs)
 * Version: 5.7 (Clean Modular Architecture - Trip Logbook, 7,000 KM PM & Machine Inspection)
 * ⚠️ วิธีติดตั้ง: สร้างไฟล์สคริปต์ชื่อ "05_FleetAndMachines" ใน GAS แล้ววางโค้ดนี้ทั้งหมด
 * ============================================================================
 */

// ==========================================
// 🚛 1. SMART FLEET, TRIP LOGBOOK, FUEL & 7,000 KM PM ENGINE
// ==========================================
function api_getFleetDashboard(payload) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var defaultStart = todayStr.slice(0, 8) + '01';
  var startDate = (payload && payload.startDate) ? String(payload.startDate).trim() : defaultStart;
  var endDate = (payload && payload.endDate) ? String(payload.endDate).trim() : todayStr;

  var maintHeaders = ['MaintID', 'TxDate', 'VehicleID', 'MaintType', 'Title', 'CurrentMileage', 'NextDueMileage', 'NextDueDate', 'Cost', 'PayChannel', 'VendorName', 'RefExpID', 'Status', 'CreatedBy', 'Note'];
  getOrCreateSheet('tb_VehicleMaintenances', maintHeaders);

  var vehicles = getSheetDataAsObjects('tb_Vehicles', ['VehicleID', 'LicensePlate', 'VehicleType', 'Capacity', 'Status', 'CreatedAt']).filter(function(v) { return v.Status !== 'Inactive'; });
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails']);
  var fuelLogs = getSheetDataAsObjects('tb_FuelLogs', ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note']);
  var maintLogs = getSheetDataAsObjects('tb_VehicleMaintenances', maintHeaders);
  var employees = getSheetDataAsObjects('tb_Employees', ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt']).filter(function(e) { return e.Status !== 'Inactive'; });
  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);

  function inRange_(dVal) {
    var d = String(dVal || '').slice(0, 10);
    return d >= startDate && d <= endDate;
  }

  var dailyRouteSalesMap = {};
  sales.forEach(function(s) {
    if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') return;
    if (String(s.SaleID || '').indexOf('AR-') === 0) return;
    var sDay = String(s.SaleDate || '').slice(0, 10);
    var rId = String(s.RouteID || '').trim();
    if (!sDay || !rId) return;
    var key = sDay + '|' + rId;
    dailyRouteSalesMap[key] = (dailyRouteSalesMap[key] || 0) + (parseFloat(s.TotalAmount) || 0);
  });

  var fleetMap = {};
  vehicles.forEach(function(v) {
    var plate = String(v.LicensePlate || v.VehicleID || '').trim();
    if (!plate) return;
    fleetMap[plate] = {
      VehicleID: v.VehicleID,
      LicensePlate: plate,
      VehicleType: v.VehicleType || 'รถกระบะบรรทุกน้ำแข็ง',
      Capacity: parseFloat(v.Capacity) || 0,
      CurrentOdometer: 0,
      tripCount: 0,
      missingMileTrips: 0,
      unaccountedKm: 0,
      distanceKm: 0,
      loadedIceQty: 0,
      soldIceQty: 0,
      lossIceQty: 0,
      revenueGenerated: 0,
      fuelCount: 0,
      fuelLiters: 0,
      fuelCost: 0,
      maintCost: 0,
      lastDriverName: '-',
      lastRouteName: '-',
      lastTripDate: '',
      lastOilDate: '',
      lastOilMileage: 0,
      nextOilMileage: 0,
      oilRemainKm: null,
      oilStatus: 'NO_DATA',
      lastTaxTitle: '',
      taxExpiryDate: '',
      taxRemainDays: null,
      taxStatus: 'NO_DATA'
    };
  });

  function ensureVehicleEntry_(plateRaw) {
    var p = String(plateRaw || '').trim();
    if (!p) p = 'ไม่ระบุทะเบียน';
    if (!fleetMap[p]) {
      fleetMap[p] = {
        VehicleID: p, LicensePlate: p, VehicleType: 'รถส่งน้ำแข็ง', Capacity: 0, CurrentOdometer: 0,
        tripCount: 0, missingMileTrips: 0, unaccountedKm: 0, distanceKm: 0, loadedIceQty: 0, soldIceQty: 0, lossIceQty: 0, revenueGenerated: 0,
        fuelCount: 0, fuelLiters: 0, fuelCost: 0, maintCost: 0,
        lastDriverName: '-', lastRouteName: '-', lastTripDate: '',
        lastOilDate: '', lastOilMileage: 0, nextOilMileage: 0, oilRemainKm: null, oilStatus: 'NO_DATA',
        lastTaxTitle: '', taxExpiryDate: '', taxRemainDays: null, taxStatus: 'NO_DATA'
      };
    }
    return fleetMap[p];
  }

  var prevEndMileByVehicle = {};
  var periodDispatches = [];
  var totalPeriodRevenue = 0;
  var totalUnaccountedKm = 0;

  dispatches.forEach(function(dsp) {
    var plate = String(dsp.VehicleID || '').trim();
    if (!plate) return;
    var vObj = ensureVehicleEntry_(plate);

    var sm = parseFloat(dsp.StartMileage) || 0;
    var em = parseFloat(dsp.EndMileage) || 0;
    if (sm > vObj.CurrentOdometer) vObj.CurrentOdometer = sm;
    if (em > vObj.CurrentOdometer) vObj.CurrentOdometer = em;

    var dDateStr = String(dsp.DispatchDate || '').slice(0, 10);
    if (dDateStr >= vObj.lastTripDate) {
      vObj.lastTripDate = dDateStr;
      vObj.lastDriverName = dsp.DriverName || '-';
      vObj.lastRouteName = dsp.RouteName || '-';
    }

    var mileageGap = 0;
    if (prevEndMileByVehicle[plate] !== undefined && sm > prevEndMileByVehicle[plate]) {
      mileageGap = sm - prevEndMileByVehicle[plate];
    }
    if (em > 0) {
      prevEndMileByVehicle[plate] = em;
    } else if (sm > 0 && prevEndMileByVehicle[plate] === undefined) {
      prevEndMileByVehicle[plate] = sm;
    }

    if (inRange_(dsp.DispatchDate)) {
      var dist = (sm > 0 && em >= sm) ? (em - sm) : 0;
      var isMissingMile = (sm <= 0 || em <= 0);
      var lQty = parseFloat(dsp.LoadedQty) || 0;
      var sQty = parseFloat(dsp.SoldQty) || 0;
      var lossQ = parseFloat(dsp.LossQty) || 0;

      var dspRevenue = (parseFloat(dsp.CashSales) || 0) + (parseFloat(dsp.TransferSales) || 0) + (parseFloat(dsp.CreditSales) || 0);
      if (dspRevenue <= 0) {
        var rKey1 = dDateStr + '|' + String(dsp.RouteID || '').trim();
        var rKey2 = dDateStr + '|' + String(dsp.RouteName || '').trim();
        dspRevenue = dailyRouteSalesMap[rKey1] || dailyRouteSalesMap[rKey2] || 0;
      }

      vObj.tripCount++;
      if (isMissingMile && dsp.Status !== 'กำลังวิ่งส่ง') vObj.missingMileTrips++;
      if (mileageGap > 0) {
        vObj.unaccountedKm += mileageGap;
        totalUnaccountedKm += mileageGap;
      }
      vObj.distanceKm += dist;
      vObj.loadedIceQty += lQty;
      vObj.soldIceQty += sQty;
      vObj.lossIceQty += lossQ;
      vObj.revenueGenerated += dspRevenue;
      totalPeriodRevenue += dspRevenue;

      periodDispatches.push({
        DispatchID: dsp.DispatchID,
        DispatchDate: dsp.DispatchDate,
        RouteID: dsp.RouteID,
        RouteName: dsp.RouteName,
        VehicleID: plate,
        DriverName: dsp.DriverName || '-',
        StartMileage: sm,
        EndMileage: em,
        DistanceKm: dist,
        MileageGap: mileageGap,
        IsMissingMile: isMissingMile,
        LoadedQty: lQty,
        SoldQty: sQty,
        ReturnedQty: parseFloat(dsp.ReturnedQty) || 0,
        LossQty: lossQ,
        Revenue: dspRevenue,
        Status: dsp.Status,
        Note: dsp.Note || ''
      });
    }
  });

  var periodFuelLogs = [];
  var totalPeriodFuelCost = 0;
  var totalPeriodFuelLiters = 0;

  fuelLogs.forEach(function(f) {
    var plate = String(f.VehicleID || '').trim();
    var vObj = ensureVehicleEntry_(plate);
    var fMile = parseFloat(f.Mileage) || 0;
    if (fMile > vObj.CurrentOdometer) vObj.CurrentOdometer = fMile;

    if (inRange_(f.FuelDate)) {
      var cost = parseFloat(f.TotalCost) || 0;
      var liters = parseFloat(f.Liters) || 0;
      vObj.fuelCount++;
      vObj.fuelCost += cost;
      vObj.fuelLiters += liters;
      totalPeriodFuelCost += cost;
      totalPeriodFuelLiters += liters;
      periodFuelLogs.push(f);
    }
  });

  var periodMaintLogs = [];
  var allActiveMaintLogs = [];
  var totalPeriodMaintCost = 0;

  maintLogs.forEach(function(m) {
    var isCancelled = (m.Status === 'Cancelled' || m.Status === 'ยกเลิก');
    var plate = String(m.VehicleID || '').trim();
    var vObj = ensureVehicleEntry_(plate);

    if (!isCancelled) {
      allActiveMaintLogs.push(m);
      var mMile = parseFloat(m.CurrentMileage) || 0;
      if (mMile > vObj.CurrentOdometer) vObj.CurrentOdometer = mMile;

      var mType = String(m.MaintType || '');
      var txDateStr = String(m.TxDate || '').slice(0, 10);

      if (mType === 'OIL_SERVICE') {
        if (mMile >= vObj.lastOilMileage && txDateStr >= vObj.lastOilDate) {
          vObj.lastOilDate = txDateStr;
          vObj.lastOilMileage = mMile;
          vObj.nextOilMileage = parseFloat(m.NextDueMileage) || (mMile + 7000);
        }
      }

      if (mType === 'TAX_INSURANCE' && m.NextDueDate) {
        var dueStr = String(m.NextDueDate || '').slice(0, 10);
        if (dueStr && dueStr >= vObj.taxExpiryDate) {
          vObj.taxExpiryDate = dueStr;
          vObj.lastTaxTitle = m.Title || 'ต่อภาษี/พ.ร.บ.';
        }
      }
    }

    if (inRange_(m.TxDate)) {
      periodMaintLogs.push(m);
      if (!isCancelled) {
        var c = parseFloat(m.Cost) || 0;
        vObj.maintCost += c;
        totalPeriodMaintCost += c;
      }
    }
  });

  var tParts = todayStr.split('-');
  var todayMidnight = new Date(parseInt(tParts[0], 10), parseInt(tParts[1], 10) - 1, parseInt(tParts[2], 10)).getTime();

  var oilAlertCount = 0;
  var taxAlertCount = 0;
  var totalPeriodDistKm = 0;
  var totalPeriodTrips = 0;
  var totalPeriodLoadedIce = 0;

  var fleetList = Object.keys(fleetMap).map(function(k) {
    var v = fleetMap[k];
    totalPeriodDistKm += v.distanceKm;
    totalPeriodTrips += v.tripCount;
    totalPeriodLoadedIce += v.loadedIceQty;

    if (v.nextOilMileage > 0) {
      var curOdo = v.CurrentOdometer > 0 ? v.CurrentOdometer : v.lastOilMileage;
      v.oilRemainKm = v.nextOilMileage - curOdo;
      if (v.oilRemainKm <= 0) {
        v.oilStatus = 'OVERDUE';
        oilAlertCount++;
      } else if (v.oilRemainKm <= 700) {
        v.oilStatus = 'WARN';
        oilAlertCount++;
      } else {
        v.oilStatus = 'OK';
      }
    }

    if (v.taxExpiryDate) {
      var dp = v.taxExpiryDate.split('-');
      if (dp.length === 3) {
        var expMidnight = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10)).getTime();
        v.taxRemainDays = Math.round((expMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
        if (v.taxRemainDays < 0) {
          v.taxStatus = 'OVERDUE';
          taxAlertCount++;
        } else if (v.taxRemainDays <= 30) {
          v.taxStatus = 'WARN';
          taxAlertCount++;
        } else {
          v.taxStatus = 'OK';
        }
      }
    }

    v.totalOperatingCost = v.fuelCost + v.maintCost;
    v.fuelCostPerKm = v.distanceKm > 0 ? Number((v.fuelCost / v.distanceKm).toFixed(2)) : 0;
    v.totalCostPerKm = v.distanceKm > 0 ? Number((v.totalOperatingCost / v.distanceKm).toFixed(2)) : 0;
    v.fuelCostPerBag = v.loadedIceQty > 0 ? Number((v.fuelCost / v.loadedIceQty).toFixed(2)) : 0;
    v.totalCostPerBag = v.loadedIceQty > 0 ? Number((v.totalOperatingCost / v.loadedIceQty).toFixed(2)) : 0;
    v.avgKmPerTrip = v.tripCount > 0 ? Number((v.distanceKm / v.tripCount).toFixed(1)) : 0;
    v.netContribution = v.revenueGenerated - v.totalOperatingCost;

    return v;
  }).filter(function(v) {
    return v.LicensePlate !== 'ไม่ระบุทะเบียน' || v.fuelCost > 0 || v.maintCost > 0 || v.tripCount > 0;
  });

  var avgFuelPerKm = totalPeriodDistKm > 0 ? Number((totalPeriodFuelCost / totalPeriodDistKm).toFixed(2)) : 0;
  var avgCostPerBag = totalPeriodLoadedIce > 0 ? Number(((totalPeriodFuelCost + totalPeriodMaintCost) / totalPeriodLoadedIce).toFixed(2)) : 0;

  return {
    filters: { startDate: startDate, endDate: endDate },
    summary: {
      totalVehicles: vehicles.length,
      oilAlertCount: oilAlertCount,
      taxAlertCount: taxAlertCount,
      totalTrips: totalPeriodTrips,
      totalDistanceKm: totalPeriodDistKm,
      totalUnaccountedKm: totalUnaccountedKm,
      totalLoadedIce: totalPeriodLoadedIce,
      totalRevenue: totalPeriodRevenue,
      totalFuelCost: totalPeriodFuelCost,
      totalFuelLiters: totalPeriodFuelLiters,
      avgFuelPerKm: avgFuelPerKm,
      avgCostPerBag: avgCostPerBag,
      totalMaintCost: totalPeriodMaintCost,
      totalFleetExpense: totalPeriodFuelCost + totalPeriodMaintCost
    },
    fleetList: fleetList,
    tripLogsList: periodDispatches.reverse(),
    fuelLogsList: periodFuelLogs.reverse(),
    maintLogsList: periodMaintLogs.reverse(),
    allMaintLogsRecent: allActiveMaintLogs.reverse().slice(0, 50),
    vehicles: vehicles,
    employees: employees
  };
}

function api_saveFuelLog(payload) {
  return withSheetLock_(function() {
    var headers = ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note'];
    var sheet = getOrCreateSheet('tb_FuelLogs', headers);
    var now = new Date();
    var todayStr = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');

    var targetDateObj = now;
    var reqDateStr = payload && payload.FuelDate ? String(payload.FuelDate).trim().slice(0, 10) : '';
    if (reqDateStr && reqDateStr !== todayStr) {
      var parsed = new Date(reqDateStr + 'T12:00:00');
      if (!isNaN(parsed.getTime())) targetDateObj = parsed;
    }

    var datePrefix = Utilities.formatDate(targetDateObj, 'GMT+7', 'yyyyMMdd');
    var fuelId = generateId(sheet, 'FL-' + datePrefix, 4);

    sheet.appendRow([
      fuelId,
      targetDateObj,
      payload.VehicleID || '',
      payload.DriverName || '',
      parseFloat(payload.Mileage) || 0,
      parseFloat(payload.Liters) || 0,
      parseFloat(payload.TotalCost) || 0,
      payload.PaidBy || 'เงินสดหน้าลาน',
      payload.Note || ''
    ]);

    SpreadsheetApp.flush();
    writeLog('SAVE_FUEL', fuelId + ' | วันที่: ' + (reqDateStr || todayStr) + ' | รถ: ' + payload.VehicleID + ' (฿' + payload.TotalCost + ')', 'SUCCESS');
    return { FuelID: fuelId };
  });
}

function api_deleteFuelLog(payload) {
  return withSheetLock_(function() {
    var fuelId = payload && payload.FuelID ? String(payload.FuelID).trim() : '';
    if (!fuelId) throw new Error('ไม่พบรหัสบิลน้ำมันที่ต้องการลบ');

    var headers = ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note'];
    var sheet = getOrCreateSheet('tb_FuelLogs', headers);
    var data = sheet.getDataRange().getValues();

    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === fuelId) {
        var detailStr = data[i][2] + ' ฿' + data[i][6] + ' (' + data[i][7] + ')';
        sheet.deleteRow(i + 1);
        SpreadsheetApp.flush();
        writeLog('DELETE_FUEL_LOG', fuelId + ' | ' + detailStr, 'WARNING');
        return { FuelID: fuelId, Status: 'Deleted' };
      }
    }
    throw new Error('ไม่พบบิลน้ำมันรหัส: ' + fuelId);
  });
}

function api_saveHistoricalDispatchMileage(payload) {
  return withSheetLock_(function() {
    var txDate = payload && payload.DispatchDate ? String(payload.DispatchDate).trim().slice(0, 10) : '';
    var vehicleId = payload && payload.VehicleID ? String(payload.VehicleID).trim() : '';
    var routeId = payload && payload.RouteID ? String(payload.RouteID).trim() : '';
    var routeName = payload && payload.RouteName ? String(payload.RouteName).trim() : routeId;
    var driverName = payload && payload.DriverName ? String(payload.DriverName).trim() : '';
    var startMile = parseFloat(payload.StartMileage) || 0;
    var endMile = parseFloat(payload.EndMileage) || 0;
    var loadedQty = parseFloat(payload.LoadedQty) || 0;

    if (!txDate) throw new Error('กรุณาเลือกวันที่วิ่งรถย้อนหลัง');
    if (!vehicleId) throw new Error('กรุณาเลือกทะเบียนรถขนส่ง');
    if (startMile <= 0 || endMile <= 0) throw new Error('กรุณากรอกเลขไมล์เริ่มต้นและเลขไมล์สิ้นสุดให้ครบถ้วน');
    if (endMile < startMile) throw new Error('เลขไมล์สิ้นสุด (' + endMile + ') ต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น (' + startMile + ')');

    var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
    var sheet = getOrCreateSheet('tb_RouteDispatches', dspHeaders);
    var data = sheet.getDataRange().getValues();
    var tz = Session.getScriptTimeZone() || 'GMT+7';

    for (var i = 1; i < data.length; i++) {
      var rowDateVal = data[i][1];
      var rowDateStr = (rowDateVal instanceof Date)
        ? Utilities.formatDate(rowDateVal, tz, 'yyyy-MM-dd')
        : String(rowDateVal || '').slice(0, 10);
      var rowRouteId = String(data[i][2] || '').trim();
      var rowVeh = String(data[i][4] || '').trim();

      if (rowDateStr === txDate && (rowVeh === vehicleId || (routeId && rowRouteId === routeId))) {
        var dspIdExisting = String(data[i][0]);
        sheet.getRange(i + 1, 5, 1, 4).setValues([[
          vehicleId,
          driverName || data[i][5],
          startMile,
          endMile
        ]]);
        if (loadedQty > 0 && (parseFloat(data[i][8]) || 0) === 0) {
          sheet.getRange(i + 1, 9, 1, 2).setValues([[loadedQty, loadedQty]]);
        }
        var oldNote = String(data[i][21] || '');
        if (payload.Note) {
          sheet.getRange(i + 1, 22).setValue(oldNote ? (oldNote + ' | ' + payload.Note) : payload.Note);
        }
        SpreadsheetApp.flush();
        writeLog('UPDATE_HIST_MILEAGE', dspIdExisting + ' | ' + txDate + ' | ' + vehicleId + ' (' + startMile + ' -> ' + endMile + ')', 'SUCCESS');
        return { DispatchID: dspIdExisting, Mode: 'UPDATED', DistanceKm: endMile - startMile };
      }
    }

    var dateObj = new Date(txDate + 'T07:30:00');
    if (isNaN(dateObj.getTime())) dateObj = new Date();
    var datePrefix = txDate.replace(/\D/g, '').slice(0, 8);
    var newDspId = generateId(sheet, 'DSP-' + datePrefix, 4);
    var noteStr = 'บันทึกไมล์ย้อนหลัง' + (payload.Note ? ': ' + payload.Note : '');

    sheet.appendRow([
      newDspId,
      dateObj,
      routeId || 'ย้อนหลัง',
      routeName || 'บันทึกวิ่งรถย้อนหลัง',
      vehicleId,
      driverName,
      startMile,
      endMile,
      loadedQty,
      loadedQty,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'ปิดกะแล้ว',
      noteStr,
      '[]'
    ]);

    SpreadsheetApp.flush();
    writeLog('INSERT_HIST_MILEAGE', newDspId + ' | ' + txDate + ' | ' + vehicleId + ' (' + startMile + ' -> ' + endMile + ')', 'SUCCESS');
    return { DispatchID: newDspId, Mode: 'INSERTED', DistanceKm: endMile - startMile };
  });
}

function api_saveVehicleMaintenance(payload) {
  return withSheetLock_(function() {
    var vehicleId = payload && payload.VehicleID ? String(payload.VehicleID).trim() : '';
    var maintType = payload && payload.MaintType ? String(payload.MaintType).trim() : 'OIL_SERVICE';
    var title = payload && payload.Title ? String(payload.Title).trim() : '';
    if (!vehicleId) throw new Error('กรุณาเลือกทะเบียนรถขนส่ง');
    if (!title) throw new Error('กรุณาระบุรายละเอียดรายการ (เช่น เปลี่ยนน้ำมันเครื่อง 7,000 กม., ต่อภาษีประจำปี)');

    var maintHeaders = ['MaintID', 'TxDate', 'VehicleID', 'MaintType', 'Title', 'CurrentMileage', 'NextDueMileage', 'NextDueDate', 'Cost', 'PayChannel', 'VendorName', 'RefExpID', 'Status', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_VehicleMaintenances', maintHeaders);

    var now = new Date();
    var txDateStr = payload.TxDate ? String(payload.TxDate).trim() : Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');
    var datePrefix = txDateStr.replace(/\D/g, '').slice(0, 8) || Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var maintId = generateId(sheet, 'VMT-' + datePrefix, 4);

    var curMile = parseFloat(payload.CurrentMileage) || 0;
    var nextMile = parseFloat(payload.NextDueMileage) || 0;
    if (maintType === 'OIL_SERVICE' && curMile > 0 && nextMile <= 0) {
      nextMile = curMile + 7000;
    }

    var cost = parseFloat(payload.Cost) || 0;
    var payChannel = String(payload.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)').trim();
    var refExpId = '';

    if (cost > 0 && payChannel.indexOf('ไม่ตัดบัญชี') === -1) {
      var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
      var expSheet = getOrCreateSheet('tb_Expenses', expHeaders);
      refExpId = generateId(expSheet, 'EXP-' + datePrefix, 4);

      var typeLabel = maintType === 'OIL_SERVICE' ? '[น้ำมันเครื่อง 7,000 กม.] '
        : (maintType === 'TAX_INSURANCE' ? '[ต่อภาษี/พ.ร.บ./ประกัน] '
        : (maintType === 'TIRE_BATTERY' ? '[ยาง/แบตเตอรี่] ' : '[ซ่อมรถ] '));

      var expTimeSuffix = Utilities.formatDate(now, 'GMT+7', 'HH:mm:ss');
      var expDateObj = new Date(txDateStr + 'T' + expTimeSuffix);
      if (isNaN(expDateObj.getTime())) expDateObj = now;

      expSheet.appendRow([
        refExpId,
        expDateObj,
        'EXPENSE',
        '🚚 ซ่อมบำรุงรถสายส่ง / ยาง / น้ำมันเครื่อง',
        typeLabel + vehicleId + ' - ' + title,
        cost,
        payChannel,
        'รถ: ' + vehicleId,
        'Active',
        payload.CreatedBy || 'Admin',
        (payload.VendorName ? 'ร้าน/อู่: ' + payload.VendorName + ' | ' : '') + (payload.Note || '') + ' (อ้างอิง ' + maintId + ')'
      ]);
    }

    sheet.appendRow([
      maintId,
      txDateStr,
      vehicleId,
      maintType,
      title,
      curMile,
      nextMile,
      payload.NextDueDate || '',
      cost,
      payChannel,
      payload.VendorName || '',
      refExpId,
      'Active',
      payload.CreatedBy || 'Admin',
      payload.Note || ''
    ]);

    SpreadsheetApp.flush();
    writeLog('SAVE_VEHICLE_MAINT', maintId + ' | ' + vehicleId + ' | ' + title + ' (฿' + cost + ')', 'SUCCESS');
    return { MaintID: maintId, RefExpID: refExpId };
  });
}

function api_cancelVehicleMaintenance(payload) {
  return withSheetLock_(function() {
    var maintId = payload && payload.MaintID ? String(payload.MaintID).trim() : '';
    if (!maintId) throw new Error('ไม่พบรหัสรายการที่ต้องการยกเลิก');

    var maintHeaders = ['MaintID', 'TxDate', 'VehicleID', 'MaintType', 'Title', 'CurrentMileage', 'NextDueMileage', 'NextDueDate', 'Cost', 'PayChannel', 'VendorName', 'RefExpID', 'Status', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_VehicleMaintenances', maintHeaders);
    var data = sheet.getDataRange().getValues();
    var refExpId = '';

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === maintId) {
        refExpId = String(data[i][11] || '').trim();
        sheet.getRange(i + 1, 13).setValue('Cancelled');
        break;
      }
    }

    if (refExpId) {
      var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
      var expSheet = getOrCreateSheet('tb_Expenses', expHeaders);
      var expData = expSheet.getDataRange().getValues();
      for (var j = 1; j < expData.length; j++) {
        if (String(expData[j][0]).trim() === refExpId) {
          expSheet.getRange(j + 1, 9).setValue('Cancelled');
          break;
        }
      }
    }

    SpreadsheetApp.flush();
    writeLog('CANCEL_VEHICLE_MAINT', maintId + (refExpId ? ' & ' + refExpId : ''), 'WARNING');
    return { MaintID: maintId, Status: 'Cancelled' };
  });
}

// ==========================================
// ⚙️ 2. MACHINE REGISTRY, SHIFT INSPECTION & MAINTENANCE ENGINE
// ==========================================
function api_getMachineDashboard() {
  var macHeaders = ['MachineID', 'MachineName', 'MachineType', 'Location', 'StandardSpec', 'Status', 'CreatedAt'];
  var logHeaders = ['LogID', 'LogDate', 'MachineID', 'MachineName', 'ShiftName', 'HighPressure', 'LowPressure', 'Amperage', 'OilLevel', 'IceYieldBags', 'MachineStatus', 'MaintenanceCost', 'InspectorName', 'RefExpID', 'Note'];

  var macSheet = getOrCreateSheet('tb_Machines', macHeaders);
  if (macSheet.getLastRow() <= 1) {
    var now = new Date();
    macSheet.getRange(2, 1, 4, 7).setValues([
      ['MAC-0001', 'เครื่องทำน้ำแข็งหลอดใหญ่ #1', 'เครื่องผลิตน้ำแข็ง', 'อาคารผลิตหลัก', 'High 150-180 PSI | Low 20-35 PSI', 'Active', now],
      ['MAC-0002', 'เครื่องทำน้ำแข็งหลอดเล็ก #1', 'เครื่องผลิตน้ำแข็ง', 'อาคารผลิตหลัก', 'High 150-180 PSI | Low 20-35 PSI', 'Active', now],
      ['MAC-0003', 'ห้องเย็นเก็บน้ำแข็งหลัก #1', 'ระบบทำความเย็น/ห้องเย็น', 'โซนคลังสินค้าหน้าลาน', 'อุณหภูมิ -5 ถึง -10 °C', 'Active', now],
      ['MAC-0004', 'เครื่องบดน้ำแข็ง & ชุดกรองน้ำ', 'เครื่องแปรรูป/ระบบน้ำ', 'หน้าห้องเย็น', 'ตรวจสอบใบมีด/เกลือซอฟต์', 'Active', now]
    ]);
  }

  getOrCreateSheet('tb_MachineLogs', logHeaders);

  var machines = getSheetDataAsObjects('tb_Machines', macHeaders).filter(function(m) {
    return m.Status !== 'Inactive';
  });
  var allLogs = getSheetDataAsObjects('tb_MachineLogs', logHeaders).reverse();

  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var todayLogs = allLogs.filter(function(l) {
    return String(l.LogDate || '').slice(0, 10) === todayStr;
  });

  return {
    machines: machines,
    todayLogs: todayLogs,
    recentLogs: allLogs.slice(0, 50)
  };
}

function api_saveMachineLog(payload) {
  return withSheetLock_(function() {
    var macId = payload && payload.MachineID ? String(payload.MachineID).trim() : '';
    var macName = payload && payload.MachineName ? String(payload.MachineName).trim() : macId;
    if (!macId) throw new Error('กรุณาเลือกเครื่องจักรที่ต้องการบันทึกผลตรวจเช็ก');

    var logHeaders = ['LogID', 'LogDate', 'MachineID', 'MachineName', 'ShiftName', 'HighPressure', 'LowPressure', 'Amperage', 'OilLevel', 'IceYieldBags', 'MachineStatus', 'MaintenanceCost', 'InspectorName', 'RefExpID', 'Note'];
    var logSheet = getOrCreateSheet('tb_MachineLogs', logHeaders);

    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var logId = generateId(logSheet, 'MLG-' + datePrefix, 4);

    var maintCost = parseFloat(payload.MaintenanceCost) || 0;
    var inspector = String(payload.InspectorName || payload.CreatedBy || 'ช่างประจำกะ').trim();
    var refExpId = '';

    if (maintCost > 0) {
      var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
      var expSheet = getOrCreateSheet('tb_Expenses', expHeaders);
      refExpId = generateId(expSheet, 'EXP-' + datePrefix, 4);

      expSheet.appendRow([
        refExpId,
        now,
        'EXPENSE',
        '🔧 ซ่อมบำรุงเครื่องจักร / ห้องเย็น',
        '[ซ่อมเครื่องจักร] ' + macName + (payload.Note ? ' - ' + payload.Note : ''),
        maintCost,
        payload.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)',
        'เครื่องจักร: ' + macName,
        'Active',
        inspector,
        'อ้างอิงใบตรวจเครื่องจักร ' + logId + ' (' + (payload.ShiftName || '') + ')'
      ]);
    }

    logSheet.appendRow([
      logId,
      now,
      macId,
      macName,
      payload.ShiftName || 'กะเช้า (07:00-15:00)',
      parseFloat(payload.HighPressure) || 0,
      parseFloat(payload.LowPressure) || 0,
      parseFloat(payload.Amperage) || 0,
      payload.OilLevel || 'ปกติ',
      parseFloat(payload.IceYieldBags) || 0,
      payload.MachineStatus || 'ปกติ',
      maintCost,
      inspector,
      refExpId,
      payload.Note || ''
    ]);

    SpreadsheetApp.flush();
    writeLog('SAVE_MACHINE_LOG', logId + ' | ' + macName + ' | สถานะ: ' + (payload.MachineStatus || 'ปกติ') + (maintCost > 0 ? ' | ค่าซ่อม ฿' + maintCost : ''), payload.MachineStatus !== 'ปกติ' ? 'WARNING' : 'SUCCESS');
    return { LogID: logId, RefExpID: refExpId };
  });
}