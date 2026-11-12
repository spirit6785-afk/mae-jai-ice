/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 06: DASHBOARD, EXPENSES, REPORTS & AUTO BACKUP (06_FinanceAndReports.gs)
 * Version: 5.7 (Clean Modular Architecture - Zero Duplicate Functions)
 * ⚠️ วิธีติดตั้ง: สร้างไฟล์สคริปต์ชื่อ "06_FinanceAndReports" ใน GAS แล้ววางโค้ดนี้ทั้งหมด
 * ============================================================================
 */

// ==========================================
// 📊 1. EXECUTIVE DASHBOARD ENGINE (ภาพรวมวันนี้ & เลือกดูวันย้อนหลัง)
// ==========================================
function api_getDashboardData(payload) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var targetDate = (payload && payload.targetDate) ? String(payload.targetDate).trim().slice(0, 10) : todayStr;
  if (!targetDate) targetDate = todayStr;

  var dpParts = targetDate.split('-');
  var targetDisplay = (dpParts.length === 3) ? (dpParts[2] + '/' + dpParts[1] + '/' + dpParts[0]) : targetDate;

  var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
  var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
  var custHeaders = ['CustomerID', 'CustomerName', 'Phone', 'CustomerType', 'RouteID', 'CreditLimit', 'Status', 'CreatedAt'];
  var routeHeaders = ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt'];
  var payHeaders = ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note'];
  var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
  var fuelHeaders = ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note'];
  var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
  var bktHeaders = ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate'];

  var sales = getSheetDataAsObjects('tb_Sales', salesHeaders);
  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', detailHeaders);
  var customers = getSheetDataAsObjects('tb_Customers', custHeaders);
  var routes = getSheetDataAsObjects('tb_Routes', routeHeaders);
  var payments = getSheetDataAsObjects('tb_Payments', payHeaders);
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);
  var fuelLogs = getSheetDataAsObjects('tb_FuelLogs', fuelHeaders);
  var expenses = getSheetDataAsObjects('tb_Expenses', expHeaders);
  var buckets = typeof normalizeBucketsData_ === 'function'
    ? normalizeBucketsData_(getSheetDataAsObjects('tb_Buckets', bktHeaders))
    : getSheetDataAsObjects('tb_Buckets', bktHeaders);

  var routeNameMap = { 'หน้าลาน': '🏠 หน้าลาน (หน้าร้าน)', 'หน้าร้าน': '🏠 หน้าลาน (หน้าร้าน)', 'WALK-IN': '🏠 หน้าลาน (หน้าร้าน)' };
  routes.forEach(function(r) {
    var rId = String(r.RouteID || '').trim();
    var rName = String(r.RouteName || '').trim();
    if (rId) routeNameMap[rId] = rName || rId;
    if (rName) routeNameMap[rName] = rName;
  });

  var custRouteMap = {};
  customers.forEach(function(c) {
    custRouteMap[String(c.CustomerID).trim()] = String(c.RouteID || 'หน้าลาน').trim();
  });

  var todaySaleIds = {};
  var rawTodaySales = [];
  var cancelledBillsCount = 0;
  var cancelledBillsAmt = 0;
  var totalUnpaidCreditAllTime = 0;
  var unpaidDebtorSet = {};

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    var pTypeAll = String(s.PaymentType || '');
    var isCreditAll = (pTypeAll.indexOf('เครดิต') !== -1 || pTypeAll.indexOf('บิลเชื่อ') !== -1 || pTypeAll.indexOf('ค้างชำระ') !== -1 || pTypeAll.indexOf('ยอดยกมา') !== -1);
    if (isCreditAll && (s.PaymentStatus === 'Unpaid' || s.PaymentStatus === 'ค้างชำระ')) {
      totalUnpaidCreditAllTime += (parseFloat(s.TotalAmount) || 0);
      unpaidDebtorSet[String(s.CustomerID || s.CustomerName || 'WALK-IN').trim()] = true;
    }

    if (String(s.SaleDate || '').indexOf(targetDate) === 0 && String(s.SaleID || '').indexOf('AR-') === -1) {
      rawTodaySales.push(s);
      todaySaleIds[s.SaleID] = true;
      if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') {
        cancelledBillsCount++;
        cancelledBillsAmt += (parseFloat(s.TotalAmount) || 0);
      }
    }
  }

  var qtyBySaleId = {};
  var summaryBySaleId = {};
  for (var j = 0; j < saleDetails.length; j++) {
    var d = saleDetails[j];
    if (!todaySaleIds[d.SaleID]) continue;
    var q = parseFloat(d.Quantity) || 0;
    if (isStockProductId_(d.ProductID)) {
      qtyBySaleId[d.SaleID] = (qtyBySaleId[d.SaleID] || 0) + q;
    }
    if (!summaryBySaleId[d.SaleID]) summaryBySaleId[d.SaleID] = [];
    summaryBySaleId[d.SaleID].push(d.ProductName + (q > 1 ? ' x' + q : ''));
  }

  var routeStatsMap = {
    'หน้าลาน': { RouteKey: 'หน้าลาน', RouteName: '🏠 หน้าลาน (หน้าร้าน)', shiftStatus: 'FRONT', driverName: 'เสมียนหน้าลาน', vehiclePlate: '-', loadedQty: 0, returnedQty: 0, billCount: 0, totalQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCollectedCash: 0, debtCollectedTransfer: 0, debtCollectedTotal: 0, fuelCost: 0, fuelCashCost: 0, otherCashExp: 0, mileageDist: 0, lossQty: 0, cashDiff: 0 }
  };
  routes.forEach(function(r) {
    var rKey = String(r.RouteID || '').trim();
    if (rKey && r.Status !== 'Inactive') {
      routeStatsMap[rKey] = {
        RouteKey: rKey, RouteName: '🚚 ' + (r.RouteName || rKey),
        shiftStatus: 'NO_SHIFT', driverName: '-', vehiclePlate: '-',
        loadedQty: 0, returnedQty: 0, billCount: 0, totalQty: 0,
        cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0,
        debtCollectedCash: 0, debtCollectedTransfer: 0, debtCollectedTotal: 0,
        fuelCost: 0, fuelCashCost: 0, otherCashExp: 0, mileageDist: 0, lossQty: 0, cashDiff: 0
      };
    }
  });

  function resolveRouteKey_(rawRouteId) {
    var rId = String(rawRouteId || '').trim();
    if (!rId || rId === 'หน้าลาน' || rId === 'หน้าร้าน' || rId === 'หน้าโรง' || rId === 'หน้าโรงงาน' || rId === 'WALK-IN') {
      return 'หน้าลาน';
    }
    if (routeStatsMap[rId]) return rId;
    for (var k in routeStatsMap) {
      if (routeStatsMap[k].RouteName.indexOf(rId) !== -1 || k === rId) return k;
    }
    routeStatsMap[rId] = {
      RouteKey: rId, RouteName: '🚚 ' + (routeNameMap[rId] || rId),
      shiftStatus: 'NO_SHIFT', driverName: '-', vehiclePlate: '-',
      loadedQty: 0, returnedQty: 0, billCount: 0, totalQty: 0,
      cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0,
      debtCollectedCash: 0, debtCollectedTransfer: 0, debtCollectedTotal: 0,
      fuelCost: 0, fuelCashCost: 0, otherCashExp: 0, mileageDist: 0, lossQty: 0, cashDiff: 0
    };
    return rId;
  }

  var todaySales = 0, cashSales = 0, transferSales = 0, creditSales = 0, todayBills = 0, totalIceQty = 0;

  rawTodaySales.forEach(function(s) {
    var isCancelled = (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก');
    var resolvedKey = resolveRouteKey_(s.RouteID);
    var rBucket = routeStatsMap[resolvedKey];

    s.RouteID = resolvedKey;
    s.RouteName = rBucket.RouteName;
    s.ItemSummary = (summaryBySaleId[s.SaleID] || []).join(', ') || '-';
    s.TotalQty = qtyBySaleId[s.SaleID] || 0;

    if (!isCancelled) {
      var amt = parseFloat(s.TotalAmount) || 0;
      var q = s.TotalQty;
      var pType = String(s.PaymentType || '');

      todaySales += amt; todayBills++; totalIceQty += q;
      rBucket.billCount++; rBucket.totalQty += q; rBucket.totalSales += amt;

      if (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1) {
        creditSales += amt; rBucket.creditSales += amt;
      } else if (pType.indexOf('โอน') !== -1) {
        transferSales += amt; rBucket.transferSales += amt;
      } else {
        cashSales += amt; rBucket.cashSales += amt;
      }
    }
  });

  var driverToRouteMap = {};
  var vehicleToRouteMap = {};
  var totalLossIceToday = 0;
  var totalCashDiffToday = 0;
  var totalLoadedIceToday = 0;

  dispatches.forEach(function(dsp) {
    var rKey = resolveRouteKey_(dsp.RouteID || dsp.RouteName);
    var drv = String(dsp.DriverName || '').trim();
    var veh = String(dsp.VehicleID || '').trim();
    if (drv) driverToRouteMap[drv] = rKey;
    if (veh) vehicleToRouteMap[veh] = rKey;

    if (String(dsp.DispatchDate || '').indexOf(targetDate) === 0 && routeStatsMap[rKey]) {
      var rb = routeStatsMap[rKey];
      rb.driverName = drv || '-';
      rb.vehiclePlate = veh || '-';
      rb.shiftStatus = String(dsp.Status || '') === 'กำลังวิ่งส่ง' ? 'ACTIVE' : 'CLOSED';
      var lLoaded = parseFloat(dsp.LoadedQty) || 0;
      var lRet = parseFloat(dsp.ReturnedQty) || 0;
      rb.loadedQty += lLoaded;
      rb.returnedQty += lRet;
      totalLoadedIceToday += lLoaded;

      var startM = parseFloat(dsp.StartMileage) || 0;
      var endM = parseFloat(dsp.EndMileage) || 0;
      if (startM > 0 && endM >= startM) {
        rb.mileageDist += (endM - startM);
      }
      var lQty = parseFloat(dsp.LossQty) || 0;
      var cDiff = parseFloat(dsp.CashDiff) || 0;
      rb.lossQty += lQty;
      rb.cashDiff += cDiff;
      totalLossIceToday += lQty;
      if (cDiff < 0) totalCashDiffToday += cDiff;
    }
  });

  var totalFuelExpense = 0;
  var totalCashFuelExpense = 0;

  fuelLogs.forEach(function(f) {
    if (String(f.FuelDate || '').indexOf(targetDate) === 0) {
      var fCost = parseFloat(f.TotalCost) || 0;
      var paidBy = String(f.PaidBy || '');
      var isCashFuel = (paidBy.indexOf('เงินสด') !== -1 || paidBy.indexOf('หัก') !== -1);

      totalFuelExpense += fCost;
      if (isCashFuel) totalCashFuelExpense += fCost;

      var fDrv = String(f.DriverName || '').trim();
      var fVeh = String(f.VehicleID || '').trim();
      var matchedRouteKey = (paidBy.indexOf('หน้าลาน') !== -1) ? 'หน้าลาน' : (driverToRouteMap[fDrv] || vehicleToRouteMap[fVeh] || '');

      if (!matchedRouteKey && fDrv) {
        for (var dName in driverToRouteMap) {
          if (dName.indexOf(fDrv) !== -1 || fDrv.indexOf(dName) !== -1) {
            matchedRouteKey = driverToRouteMap[dName];
            break;
          }
        }
      }
      if (!matchedRouteKey) matchedRouteKey = 'หน้าลาน';

      var rBucket = routeStatsMap[matchedRouteKey] || routeStatsMap['หน้าลาน'];
      if (rBucket) {
        rBucket.fuelCost += fCost;
        if (isCashFuel) rBucket.fuelCashCost += fCost;
      }
    }
  });

  var todayManualExpenseTotal = 0;
  var todayDrawerCashExpense = 0;
  var todayOtherIncomeTotal = 0;
  var todayOtherIncomeCash = 0;

  expenses.forEach(function(ex) {
    if (String(ex.ExpDate || '').slice(0, 10) !== targetDate) return;
    var st = String(ex.Status || '').trim().toLowerCase();
    if (st === 'cancelled' || st === 'ยกเลิก' || st === 'inactive') return;

    var amt = parseFloat(ex.Amount) || 0;
    var txType = String(ex.TxType || 'EXPENSE').trim();
    var ch = String(ex.PayChannel || '');

    if (txType === 'OTHER_INCOME') {
      todayOtherIncomeTotal += amt;
      if (ch.indexOf('โอน') === -1 && ch.indexOf('ธนาคาร') === -1) {
        todayOtherIncomeCash += amt;
      }
    } else {
      todayManualExpenseTotal += amt;
      if (ch.indexOf('ลิ้นชัก') !== -1 || ch.indexOf('หน้าลาน') !== -1) {
        todayDrawerCashExpense += amt;
        routeStatsMap['หน้าลาน'].otherCashExp += amt;
      }
    }
  });

  var debtCollectedTotal = 0, debtCollectedCash = 0, debtCollectedTransfer = 0;
  var todayPayments = [];

  payments.forEach(function(p) {
    if (String(p.PaymentDate || '').indexOf(targetDate) === 0) {
      var pAmt = parseFloat(p.AmountPaid) || 0;
      var method = String(p.PaymentMethod || 'เงินสด');
      var cRoute = custRouteMap[String(p.CustomerID).trim()] || 'หน้าลาน';
      var byDriver = String(p.CreatedBy || '').indexOf('คนขับ') !== -1;
      var resolvedKey = (!byDriver && cRoute === 'หน้าลาน') ? 'หน้าลาน' : resolveRouteKey_(cRoute);
      var rBucket = routeStatsMap[resolvedKey] || routeStatsMap['หน้าลาน'];

      p.RouteName = rBucket.RouteName;
      p.RouteKey = rBucket.RouteKey;
      todayPayments.push(p);

      debtCollectedTotal += pAmt;
      rBucket.debtCollectedTotal += pAmt;

      if (method.indexOf('โอน') !== -1) {
        debtCollectedTransfer += pAmt; rBucket.debtCollectedTransfer += pAmt;
      } else {
        debtCollectedCash += pAmt; rBucket.debtCollectedCash += pAmt;
      }
    }
  });

  // ดึงสต๊อกน้ำแข็งในห้องเย็นจากฟังก์ชันกลาง computeMasterStockBalances_ (ตรงกับหน้าระบบสต๊อก 100%)
  var masterStockInfo = computeMasterStockBalances_(targetDate, targetDate);
  var coldRoomStocks = masterStockInfo.balances;
  var todayProducedIceQty = masterStockInfo.summary.todayProduction;

  var borrowedBucketsCount = buckets.filter(function(b) {
    var st = String(b.CurrentStatus || '').trim();
    return b.Status !== 'Inactive' && (st === 'ถูกยืม' || st.toLowerCase() === 'borrowed');
  }).length;
  var inStockBucketsCount = buckets.filter(function(b) {
    var st = String(b.CurrentStatus || '').trim();
    return b.Status !== 'Inactive' && st === 'ในคลัง';
  }).length;

  var routeBreakdown = Object.keys(routeStatsMap).map(function(k) { return routeStatsMap[k]; });
  var activeCustomers = customers.filter(function(c) { return c.Status !== 'Inactive'; }).length;

  var netCashInHand = cashSales + debtCollectedCash + todayOtherIncomeCash - totalCashFuelExpense - todayDrawerCashExpense;
  var frontDrawerNetCash = routeStatsMap['หน้าลาน'].cashSales + routeStatsMap['หน้าลาน'].debtCollectedCash + todayOtherIncomeCash - routeStatsMap['หน้าลาน'].fuelCashCost - todayDrawerCashExpense;
  var totalBankTransfer = transferSales + debtCollectedTransfer;

  var totalInflowToday = cashSales + transferSales + debtCollectedTotal + todayOtherIncomeTotal;
  var totalOutflowToday = totalFuelExpense + todayManualExpenseTotal;
  var netProfitToday = totalInflowToday - totalOutflowToday;

  return {
    targetDate: targetDate,
    reportDate: targetDisplay,
    todaySales: todaySales,
    cashSales: cashSales,
    transferSales: transferSales,
    creditSales: creditSales,
    todayBills: todayBills,
    totalIceQty: totalIceQty,
    totalLoadedIceToday: totalLoadedIceToday,
    todayProducedIceQty: todayProducedIceQty,
    debtCollectedTotal: debtCollectedTotal,
    debtCollectedCash: debtCollectedCash,
    debtCollectedTransfer: debtCollectedTransfer,
    totalFuelExpense: totalFuelExpense,
    totalCashFuelExpense: totalCashFuelExpense,
    todayManualExpenseTotal: todayManualExpenseTotal,
    todayDrawerCashExpense: todayDrawerCashExpense,
    totalOutflowToday: totalOutflowToday,
    netProfitToday: netProfitToday,
    frontDrawerNetCash: frontDrawerNetCash,
    totalCashInHand: netCashInHand,
    totalBankTransfer: totalBankTransfer,
    totalCustomers: activeCustomers,
    unpaidCreditAllTime: totalUnpaidCreditAllTime,
    unpaidDebtorCount: Object.keys(unpaidDebtorSet).length,
    borrowedBucketsCount: borrowedBucketsCount,
    inStockBucketsCount: inStockBucketsCount,
    coldRoomStocks: coldRoomStocks,
    auditFlags: {
      cancelledBillsCount: cancelledBillsCount,
      cancelledBillsAmt: cancelledBillsAmt,
      totalLossIceToday: totalLossIceToday,
      totalCashDiffToday: totalCashDiffToday
    },
    routeBreakdown: routeBreakdown,
    todayPayments: todayPayments.reverse(),
    recentSales: rawTodaySales.reverse()
  };
}

function api_getDashboardSummary(payload) {
  return api_getDashboardData(payload);
}

// ==========================================
// 💰 2. FACTORY CASHFLOW, PETTY CASH & EXPENSE MANAGEMENT
// ==========================================
function api_getExpenseDashboard(payload) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var startDate = (payload && payload.startDate) ? String(payload.startDate).trim() : todayStr;
  var endDate = (payload && payload.endDate) ? String(payload.endDate).trim() : todayStr;

  var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
  getOrCreateSheet('tb_Expenses', expHeaders);

  var expenses = getSheetDataAsObjects('tb_Expenses', expHeaders);
  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var payments = getSheetDataAsObjects('tb_Payments', ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note']);
  var fuelLogs = getSheetDataAsObjects('tb_FuelLogs', ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note']);
  var employees = getSheetDataAsObjects('tb_Employees', ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt']).filter(function(e) { return e.Status !== 'Inactive'; });
  var vehicles = getSheetDataAsObjects('tb_Vehicles', ['VehicleID', 'LicensePlate', 'VehicleType', 'Capacity', 'Status', 'CreatedAt']).filter(function(v) { return v.Status !== 'Inactive'; });

  function inRange_(dateVal) {
    var d = String(dateVal || '').slice(0, 10);
    return d >= startDate && d <= endDate;
  }

  var iceCashFront = 0, iceCashRoute = 0, iceTransferTotal = 0, iceCreditNew = 0;
  sales.forEach(function(s) {
    if (!inRange_(s.SaleDate)) return;
    var st = String(s.PaymentStatus || '').trim().toLowerCase();
    if (st === 'cancelled' || st === 'ยกเลิก') return;
    if (String(s.SaleID || '').indexOf('AR-') === 0) return;

    var amt = parseFloat(s.TotalAmount) || 0;
    var pType = String(s.PaymentType || 'เงินสด');
    var rId = String(s.RouteID || '').trim();
    var isFront = (rId === '' || rId === 'หน้าลาน' || rId === 'หน้าร้าน' || rId === 'หน้าโรง' || rId === 'หน้าโรงงาน' || rId === 'WALK-IN');

    if (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1) {
      iceCreditNew += amt;
    } else if (pType.indexOf('โอน') !== -1) {
      iceTransferTotal += amt;
    } else {
      if (isFront) iceCashFront += amt;
      else iceCashRoute += amt;
    }
  });

  var debtCashFront = 0, debtCashRoute = 0, debtTransferTotal = 0;
  payments.forEach(function(p) {
    if (!inRange_(p.PaymentDate)) return;
    var pAmt = parseFloat(p.AmountPaid) || 0;
    var method = String(p.PaymentMethod || 'เงินสด');
    var byDriver = String(p.CreatedBy || '').indexOf('คนขับ') !== -1;

    if (method.indexOf('โอน') !== -1) {
      debtTransferTotal += pAmt;
    } else {
      if (byDriver) debtCashRoute += pAmt;
      else debtCashFront += pAmt;
    }
  });

  var fuelCashRoute = 0, fuelCashFront = 0, fuelCreditStation = 0, fuelTotalCost = 0;
  var filteredFuelLogs = [];
  fuelLogs.forEach(function(f) {
    if (!inRange_(f.FuelDate)) return;
    var cost = parseFloat(f.TotalCost) || 0;
    var paidBy = String(f.PaidBy || '');
    fuelTotalCost += cost;
    if (paidBy.indexOf('สายส่ง') !== -1 || paidBy.indexOf('หัก') !== -1) {
      fuelCashRoute += cost;
    } else if (paidBy.indexOf('หน้าลาน') !== -1 || paidBy.indexOf('เงินสด') !== -1) {
      fuelCashFront += cost;
    } else {
      fuelCreditStation += cost;
    }

    filteredFuelLogs.push({
      ExpID: f.FuelID,
      IsAutoFuel: true,
      ExpDate: f.FuelDate,
      TxType: 'EXPENSE',
      Category: '⛽ ค่าน้ำมันเชื้อเพลิง (ดึงอัตโนมัติ)',
      Title: 'เติมน้ำมันรถ ' + (f.VehicleID || '-') + (f.Mileage ? ' (ไมล์ ' + f.Mileage + ')' : ''),
      Amount: cost,
      PayChannel: paidBy || 'หักเงินสดสายส่ง',
      RefTarget: f.DriverName ? ('คนขับ: ' + f.DriverName) : '',
      Status: 'Active',
      CreatedBy: f.DriverName || 'ระบบน้ำมัน',
      Note: f.Note || ''
    });
  });

  var filteredExpenses = [];
  var otherIncomeCashFront = 0, otherIncomeBank = 0, otherIncomeTotal = 0;
  var expDrawerCash = 0, expSafeCash = 0, expBankTransfer = 0, expManualTotal = 0;

  var categoryMap = {
    '⛽ ค่าน้ำมันเชื้อเพลิง (ดึงอัตโนมัติ)': fuelTotalCost,
    '⚡ ค่าไฟฟ้า (PEA)': 0,
    '🛍️ ค่ากระสอบ / ถุง / เชือก': 0,
    '👷 ค่าแรง / เงินเดือน / OT': 0,
    '💸 พนักงานเบิกเงินล่วงหน้า': 0,
    '🔧 ซ่อมบำรุงเครื่องจักร / ห้องเย็น': 0,
    '🚚 ซ่อมบำรุงรถสายส่ง / ยาง / น้ำมันเครื่อง': 0,
    '💧 ค่าน้ำดิบ / สารกรอง / เกลือ / คลอรีน': 0,
    '🍱 ค่าอาหาร / น้ำดื่ม / สวัสดิการ': 0,
    '🏢 ค่าใช้จ่ายบริหาร / เบ็ดเตล็ดหน้าลาน': 0
  };

  var empAdvanceMap = {};

  expenses.forEach(function(ex) {
    if (!inRange_(ex.ExpDate)) return;
    var st = String(ex.Status || '').trim().toLowerCase();
    var isCancelled = (st === 'cancelled' || st === 'ยกเลิก' || st === 'inactive');
    filteredExpenses.push(ex);
    if (isCancelled) return;

    var amt = parseFloat(ex.Amount) || 0;
    var txType = String(ex.TxType || 'EXPENSE').trim();
    var channel = String(ex.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)');
    var cat = String(ex.Category || '🏢 ค่าใช้จ่ายบริหาร / เบ็ดเตล็ดหน้าลาน');

    if (txType === 'OTHER_INCOME') {
      otherIncomeTotal += amt;
      if (channel.indexOf('โอน') !== -1 || channel.indexOf('ธนาคาร') !== -1) otherIncomeBank += amt;
      else otherIncomeCashFront += amt;
    } else {
      expManualTotal += amt;
      if (channel.indexOf('ลิ้นชัก') !== -1 || channel.indexOf('หน้าลาน') !== -1) expDrawerCash += amt;
      else if (channel.indexOf('โอน') !== -1 || channel.indexOf('ธนาคาร') !== -1) expBankTransfer += amt;
      else expSafeCash += amt;

      if (categoryMap[cat] === undefined) categoryMap[cat] = 0;
      categoryMap[cat] += amt;

      if (cat.indexOf('เบิกเงินล่วงหน้า') !== -1 && ex.RefTarget) {
        var empName = String(ex.RefTarget).trim();
        empAdvanceMap[empName] = (empAdvanceMap[empName] || 0) + amt;
      }
    }
  });

  var totalCashIn = iceCashFront + iceCashRoute + debtCashFront + debtCashRoute + otherIncomeCashFront;
  var totalBankIn = iceTransferTotal + debtTransferTotal + otherIncomeBank;
  var totalInflow = totalCashIn + totalBankIn;

  var totalOutflow = fuelTotalCost + expManualTotal;
  var netCashflow = totalInflow - totalOutflow;
  var frontDrawerNetCash = iceCashFront + debtCashFront + otherIncomeCashFront - fuelCashFront - expDrawerCash;
  var routeNetCash = iceCashRoute + debtCashRoute - fuelCashRoute;

  var categoryBreakdown = Object.keys(categoryMap).map(function(k) {
    var val = categoryMap[k];
    var pct = totalOutflow > 0 ? Number(((val / totalOutflow) * 100).toFixed(1)) : 0;
    return { category: k, amount: val, percent: pct };
  }).filter(function(item) { return item.amount > 0; }).sort(function(a, b) { return b.amount - a.amount; });

  var advanceList = Object.keys(empAdvanceMap).map(function(emp) {
    return { empName: emp, totalAdvance: empAdvanceMap[emp] };
  }).sort(function(a, b) { return b.totalAdvance - a.totalAdvance; });

  var combinedList = filteredExpenses.reverse().concat(filteredFuelLogs.reverse());

  return {
    filters: { startDate: startDate, endDate: endDate },
    summary: {
      iceCashFront: iceCashFront,
      iceCashRoute: iceCashRoute,
      iceTransferTotal: iceTransferTotal,
      iceCreditNew: iceCreditNew,
      debtCashFront: debtCashFront,
      debtCashRoute: debtCashRoute,
      debtTransferTotal: debtTransferTotal,
      otherIncomeTotal: otherIncomeTotal,
      totalInflow: totalInflow,
      fuelTotalCost: fuelTotalCost,
      fuelCashRoute: fuelCashRoute,
      fuelCashFront: fuelCashFront,
      expManualTotal: expManualTotal,
      expDrawerCash: expDrawerCash,
      expSafeCash: expSafeCash,
      expBankTransfer: expBankTransfer,
      totalOutflow: totalOutflow,
      netCashflow: netCashflow,
      frontDrawerNetCash: frontDrawerNetCash,
      routeNetCash: routeNetCash
    },
    categoryBreakdown: categoryBreakdown,
    advanceList: advanceList,
    expensesList: combinedList,
    employees: employees,
    vehicles: vehicles
  };
}

function api_saveExpense(payload) {
  return withSheetLock_(function() {
    var title = payload && payload.Title ? String(payload.Title).trim() : '';
    var amount = parseFloat(payload.Amount) || 0;
    if (!title) throw new Error('กรุณาระบุรายละเอียดรายการ (เช่น จ่ายค่าปะยาง, ค่าไฟเดือน ต.ค.)');
    if (amount <= 0) throw new Error('กรุณาระบุจำนวนเงินให้มากกว่า 0 บาท');

    var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_Expenses', expHeaders);

    var now = new Date();
    var txDateObj = now;
    if (payload.ExpDate) {
      var timeSuffix = Utilities.formatDate(now, 'GMT+7', 'HH:mm:ss');
      var parsed = new Date(payload.ExpDate + 'T' + timeSuffix);
      if (!isNaN(parsed.getTime())) txDateObj = parsed;
    }

    var datePrefix = Utilities.formatDate(txDateObj, 'GMT+7', 'yyyyMMdd');
    var expId = generateId(sheet, 'EXP-' + datePrefix, 4);

    sheet.appendRow([
      expId,
      txDateObj,
      payload.TxType || 'EXPENSE',
      payload.Category || '🏢 ค่าใช้จ่ายบริหาร / เบ็ดเตล็ดหน้าลาน',
      title,
      amount,
      payload.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)',
      payload.RefTarget || '',
      'Active',
      payload.CreatedBy || 'Admin',
      payload.Note || ''
    ]);

    SpreadsheetApp.flush();
    writeLog('SAVE_EXPENSE', expId + ' | ' + payload.Category + ' | ' + title + ' (฿' + amount + ')', 'SUCCESS');
    return { ExpID: expId };
  });
}

function api_cancelExpense(payload) {
  return withSheetLock_(function() {
    var expId = payload && payload.ExpID ? String(payload.ExpID).trim() : '';
    if (!expId) throw new Error('ไม่พบรหัสรายการที่ต้องการยกเลิก');

    var expHeaders = ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_Expenses', expHeaders);
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === expId) {
        sheet.getRange(i + 1, 9).setValue('Cancelled');
        SpreadsheetApp.flush();
        writeLog('CANCEL_EXPENSE', expId + ' (' + data[i][4] + ' ฿' + data[i][5] + ') โดย ' + (payload.CreatedBy || 'Admin'), 'WARNING');
        return { ExpID: expId, Status: 'Cancelled' };
      }
    }
    throw new Error('ไม่พบรหัสรายการ: ' + expId);
  });
}

// ==========================================
// 📈 3. HISTORICAL BUSINESS REPORTS & CUSTOMER MONTHLY PERFORMANCE ENGINE
// ==========================================
function api_getHistoricalReport(payload) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var startDate = (payload && payload.startDate) ? String(payload.startDate).trim() : todayStr;
  var endDate = (payload && payload.endDate) ? String(payload.endDate).trim() : todayStr;
  var filterRoute = (payload && payload.routeId) ? String(payload.routeId).trim() : 'ALL';

  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal']);
  var routes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']);
  var customers = api_getCustomers();
  var payments = getSheetDataAsObjects('tb_Payments', ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note']);
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails']);
  var fuelLogs = getSheetDataAsObjects('tb_FuelLogs', ['FuelID', 'FuelDate', 'VehicleID', 'DriverName', 'Mileage', 'Liters', 'TotalCost', 'PaidBy', 'Note']);
  var invLogs = getSheetDataAsObjects('tb_InventoryLogs', ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note']);
  var buckets = typeof normalizeBucketsData_ === 'function'
    ? normalizeBucketsData_(getSheetDataAsObjects('tb_Buckets', ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate']))
    : getSheetDataAsObjects('tb_Buckets', ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate']);
  var specialPrices = getSheetDataAsObjects('tb_SpecialPrices', ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt']);
  var expenses = getSheetDataAsObjects('tb_Expenses', ['ExpID', 'ExpDate', 'TxType', 'Category', 'Title', 'Amount', 'PayChannel', 'RefTarget', 'Status', 'CreatedBy', 'Note']);
  var promoMap = getCustomerPromoMap_();

  var routeNameMap = { 'หน้าลาน': '🏠 หน้าลาน (หน้าร้าน)', 'หน้าร้าน': '🏠 หน้าลาน (หน้าร้าน)' };
  routes.forEach(function(r) {
    if (r.RouteID) routeNameMap[String(r.RouteID).trim()] = r.RouteName;
    if (r.RouteName) routeNameMap[String(r.RouteName).trim()] = r.RouteName;
  });

  var custRouteMap = {};
  var nameToCustId = {};
  customers.forEach(function(c) {
    var cid = String(c.CustomerID).trim();
    var cName = String(c.CustomerName || '').trim();
    custRouteMap[cid] = String(c.RouteID || 'หน้าลาน').trim();
    if (cName) nameToCustId[cName.toLowerCase()] = cid;
  });

  var spCountByCust = {};
  specialPrices.forEach(function(sp) {
    if (sp.Status !== 'Inactive' && sp.SpecialPrice !== '') {
      var cid = String(sp.CustomerID).trim();
      spCountByCust[cid] = (spCountByCust[cid] || 0) + 1;
    }
  });

  var bucketsByHolder = {};
  buckets.forEach(function(b) {
    if (b.Status !== 'Inactive' && b.CurrentStatus === 'ถูกยืม') {
      var holderKey = String(b.CurrentLocation || '').trim().toLowerCase();
      if (!holderKey) return;
      if (!bucketsByHolder[holderKey]) bucketsByHolder[holderKey] = [];
      bucketsByHolder[holderKey].push(b.SerialNumber + ' (' + b.Capacity + ')');
    }
  });

  function normalizeRoute_(rawRoute) {
    var r = String(rawRoute || '').trim();
    if (!r || r === 'หน้าลาน' || r === 'หน้าร้าน' || r === 'หน้าโรง' || r === 'หน้าโรงงาน' || r === 'WALK-IN') {
      return 'หน้าลาน';
    }
    for (var i = 0; i < routes.length; i++) {
      if (routes[i].RouteID === r || routes[i].RouteName === r) return routes[i].RouteID;
    }
    return r;
  }

  function inDateRange_(dateStr) {
    var d = String(dateStr || '').slice(0, 10);
    return (d >= startDate && d <= endDate);
  }

  function matchRouteFilter_(rKey) {
    if (filterRoute === 'ALL') return true;
    return rKey === filterRoute || (routeNameMap[rKey] && routeNameMap[rKey] === filterRoute);
  }

  var sParts = startDate.split('-');
  var eParts = endDate.split('-');
  var periodDays = 1;
  if (sParts.length === 3 && eParts.length === 3) {
    var sTime = new Date(parseInt(sParts[0], 10), parseInt(sParts[1], 10) - 1, parseInt(sParts[2], 10)).getTime();
    var eTime = new Date(parseInt(eParts[0], 10), parseInt(eParts[1], 10) - 1, parseInt(eParts[2], 10)).getTime();
    periodDays = Math.max(1, Math.round((eTime - sTime) / (1000 * 60 * 60 * 24)) + 1);
  }

  var matchedSaleIds = {};
  var filteredSales = [];
  var cancelledSales = [];

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    if (!inDateRange_(s.SaleDate)) continue;
    if (String(s.SaleID || '').indexOf('AR-') === 0) continue;

    var rKey = normalizeRoute_(s.RouteID);
    if (!matchRouteFilter_(rKey)) continue;

    s.RouteKey = rKey;
    s.RouteName = routeNameMap[rKey] || rKey;
    matchedSaleIds[s.SaleID] = true;

    if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') {
      cancelledSales.push(s);
    } else {
      filteredSales.push(s);
    }
  }

  var qtyBySale = {};
  var summaryBySale = {};
  var skuBySale = {};

  for (var j = 0; j < saleDetails.length; j++) {
    var det = saleDetails[j];
    if (!matchedSaleIds[det.SaleID]) continue;

    var q = parseFloat(det.Quantity) || 0;
    var pName = String(det.ProductName || '');
    if (!summaryBySale[det.SaleID]) summaryBySale[det.SaleID] = [];
    summaryBySale[det.SaleID].push(pName + (q > 1 ? ' x' + q : ''));

    if (isStockProductId_(det.ProductID)) {
      qtyBySale[det.SaleID] = (qtyBySale[det.SaleID] || 0) + q;
      if (!skuBySale[det.SaleID]) skuBySale[det.SaleID] = { bigTube: 0, crushed: 0, smallTube: 0, block: 0, other: 0 };
      if (pName.indexOf('หลอดใหญ่') !== -1) skuBySale[det.SaleID].bigTube += q;
      else if (pName.indexOf('บด') !== -1) skuBySale[det.SaleID].crushed += q;
      else if (pName.indexOf('หลอดเล็ก') !== -1) skuBySale[det.SaleID].smallTube += q;
      else if (pName.indexOf('ก้อน') !== -1 || pName.indexOf('ซอง') !== -1) skuBySale[det.SaleID].block += q;
      else skuBySale[det.SaleID].other += q;
    }
  }

  var routeMatrix = {
    'หน้าลาน': { RouteKey: 'หน้าลาน', RouteName: '🏠 หน้าลาน (หน้าร้าน)', billCount: 0, iceQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCash: 0, debtTransfer: 0, fuelCash: 0, fuelTotal: 0, otherCashExp: 0, distanceKm: 0 }
  };
  routes.forEach(function(r) {
    if (r.Status !== 'Inactive') {
      routeMatrix[r.RouteID] = { RouteKey: r.RouteID, RouteName: '🚚 ' + r.RouteName, billCount: 0, iceQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCash: 0, debtTransfer: 0, fuelCash: 0, fuelTotal: 0, otherCashExp: 0, distanceKm: 0 };
    }
  });

  function getRouteRow_(rKey) {
    if (!routeMatrix[rKey]) {
      routeMatrix[rKey] = { RouteKey: rKey, RouteName: routeNameMap[rKey] || rKey, billCount: 0, iceQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCash: 0, debtTransfer: 0, fuelCash: 0, fuelTotal: 0, otherCashExp: 0, distanceKm: 0 };
    }
    return routeMatrix[rKey];
  }

  var custPerfMap = {};
  customers.forEach(function(c) {
    var cid = String(c.CustomerID).trim();
    var cRouteKey = normalizeRoute_(c.RouteID);
    if (!matchRouteFilter_(cRouteKey)) return;

    var cNameLower = String(c.CustomerName || '').trim().toLowerCase();
    var heldBuckets = bucketsByHolder[cNameLower] || [];

    custPerfMap[cid] = {
      CustomerID: cid,
      CustomerName: c.CustomerName,
      Phone: c.Phone || '',
      RouteID: cRouteKey,
      RouteName: routeNameMap[cRouteKey] || cRouteKey,
      HasSpecialPrice: (spCountByCust[cid] || 0) > 0,
      HasPromo3For100: !!promoMap[cid],
      BucketCount: heldBuckets.length,
      BucketSerials: heldBuckets.join(', '),
      billCount: 0,
      activeDaysMap: {},
      activeDaysCount: 0,
      bigTubeQty: 0, crushedQty: 0, smallTubeQty: 0, blockQty: 0, totalIceQty: 0,
      cashAmt: 0, transferAmt: 0, creditAmt: 0, totalAmt: 0,
      lastSaleDate: ''
    };
  });

  var kpi = {
    totalSales: 0, cashSales: 0, transferSales: 0, creditSales: 0,
    billCount: 0, totalIceQty: 0,
    debtCollectedTotal: 0, debtCollectedCash: 0, debtCollectedTransfer: 0,
    totalFuelCost: 0, totalFuelCash: 0,
    expManualTotal: 0, expDrawerCash: 0, otherIncomeTotal: 0, otherIncomeCash: 0,
    totalOutflow: 0, netCashflow: 0,
    totalDistanceKm: 0, totalLossQty: 0, cancelledCount: cancelledSales.length
  };

  filteredSales.forEach(function(s) {
    var amt = parseFloat(s.TotalAmount) || 0;
    var q = qtyBySale[s.SaleID] || 0;
    var pType = String(s.PaymentType || 'เงินสด');
    var rRow = getRouteRow_(s.RouteKey);

    s.TotalQty = q;
    s.ItemSummary = (summaryBySale[s.SaleID] || []).join(', ') || '-';

    kpi.totalSales += amt;
    kpi.billCount++;
    kpi.totalIceQty += q;

    rRow.billCount++;
    rRow.iceQty += q;
    rRow.totalSales += amt;

    var isCredit = (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1);
    var isTrf = (pType.indexOf('โอน') !== -1);

    if (isCredit) {
      kpi.creditSales += amt; rRow.creditSales += amt;
    } else if (isTrf) {
      kpi.transferSales += amt; rRow.transferSales += amt;
    } else {
      kpi.cashSales += amt; rRow.cashSales += amt;
    }

    var rawCid = String(s.CustomerID || 'WALK-IN').trim();
    if (rawCid === 'WALK-IN' || !custPerfMap[rawCid]) {
      var matchedByName = nameToCustId[String(s.CustomerName || '').trim().toLowerCase()];
      if (matchedByName && custPerfMap[matchedByName]) rawCid = matchedByName;
    }

    var stdName = (rawCid === 'WALK-IN' && typeof normalizeWalkInName_ === 'function')
      ? normalizeWalkInName_(s.CustomerName)
      : (s.CustomerName || 'ลูกค้าขาจรทั่วไป');
    var custKey = custPerfMap[rawCid] ? rawCid : ('WALKIN:' + stdName);

    if (!custPerfMap[custKey]) {
      var wNameLower = String(stdName).trim().toLowerCase();
      var wBuckets = bucketsByHolder[wNameLower] || [];
      custPerfMap[custKey] = {
        CustomerID: rawCid,
        CustomerName: stdName,
        Phone: '',
        RouteID: s.RouteKey,
        RouteName: s.RouteName,
        HasSpecialPrice: false,
        HasPromo3For100: false,
        BucketCount: wBuckets.length,
        BucketSerials: wBuckets.join(', '),
        billCount: 0,
        activeDaysMap: {},
        activeDaysCount: 0,
        bigTubeQty: 0, crushedQty: 0, smallTubeQty: 0, blockQty: 0, totalIceQty: 0,
        cashAmt: 0, transferAmt: 0, creditAmt: 0, totalAmt: 0,
        lastSaleDate: ''
      };
    }

    var cPerf = custPerfMap[custKey];
    var sDay = String(s.SaleDate || '').slice(0, 10);
    cPerf.billCount++;
    if (sDay) {
      cPerf.activeDaysMap[sDay] = true;
      if (sDay > cPerf.lastSaleDate) cPerf.lastSaleDate = sDay;
    }

    var sk = skuBySale[s.SaleID] || { bigTube: 0, crushed: 0, smallTube: 0, block: 0, other: 0 };
    cPerf.bigTubeQty += sk.bigTube;
    cPerf.crushedQty += sk.crushed;
    cPerf.smallTubeQty += sk.smallTube;
    cPerf.blockQty += (sk.block + sk.other);
    cPerf.totalIceQty += q;
    cPerf.totalAmt += amt;

    if (isCredit) cPerf.creditAmt += amt;
    else if (isTrf) cPerf.transferAmt += amt;
    else cPerf.cashAmt += amt;
  });

  var customerRankingList = Object.keys(custPerfMap).map(function(k) {
    var c = custPerfMap[k];
    c.activeDaysCount = Object.keys(c.activeDaysMap).length;
    delete c.activeDaysMap;
    c.avgQtyPerPeriodDay = Number((c.totalIceQty / periodDays).toFixed(1));
    c.avgQtyPerOrderDay = c.activeDaysCount > 0 ? Number((c.totalIceQty / c.activeDaysCount).toFixed(1)) : 0;

    var roiStatus = 'NONE';
    if (c.BucketCount > 0) {
      if (c.totalIceQty === 0) roiStatus = 'DEAD_BUCKET';
      else if (c.avgQtyPerPeriodDay < (c.BucketCount * 1.0)) roiStatus = 'LOW_ROI';
      else roiStatus = 'GOOD_ROI';
    }
    c.BucketROIStatus = roiStatus;
    return c;
  }).filter(function(c) {
    return c.billCount > 0 || c.BucketCount > 0 || c.HasSpecialPrice || c.HasPromo3For100;
  }).sort(function(a, b) {
    if (b.totalAmt !== a.totalAmt) return b.totalAmt - a.totalAmt;
    return b.BucketCount - a.BucketCount;
  });

  cancelledSales.forEach(function(cs) {
    cs.ItemSummary = (summaryBySale[cs.SaleID] || []).join(', ') || '-';
  });

  var filteredPayments = [];
  payments.forEach(function(p) {
    if (!inDateRange_(p.PaymentDate)) return;
    var cRoute = custRouteMap[String(p.CustomerID || '').trim()] || 'หน้าลาน';
    var byDriver = String(p.CreatedBy || '').indexOf('คนขับ') !== -1;
    var rKey = (!byDriver && cRoute === 'หน้าลาน') ? 'หน้าลาน' : normalizeRoute_(cRoute);
    if (!matchRouteFilter_(rKey)) return;

    var pAmt = parseFloat(p.AmountPaid) || 0;
    var method = String(p.PaymentMethod || 'เงินสด');
    var rRow = getRouteRow_(rKey);

    p.RouteName = rRow.RouteName;
    filteredPayments.push(p);

    kpi.debtCollectedTotal += pAmt;
    if (method.indexOf('โอน') !== -1) {
      kpi.debtCollectedTransfer += pAmt;
      rRow.debtTransfer += pAmt;
    } else {
      kpi.debtCollectedCash += pAmt;
      rRow.debtCash += pAmt;
    }
  });

  var filteredDispatches = [];
  var driverRouteMap = {};
  var vehicleRouteMap = {};

  dispatches.forEach(function(dsp) {
    var rKeyAll = normalizeRoute_(dsp.RouteID || dsp.RouteName);
    if (dsp.DriverName) driverRouteMap[String(dsp.DriverName).trim()] = rKeyAll;
    if (dsp.VehicleID) vehicleRouteMap[String(dsp.VehicleID).trim()] = rKeyAll;

    if (!inDateRange_(dsp.DispatchDate)) return;
    if (!matchRouteFilter_(rKeyAll)) return;

    var startM = parseFloat(dsp.StartMileage) || 0;
    var endM = parseFloat(dsp.EndMileage) || 0;
    var dist = (startM > 0 && endM >= startM) ? (endM - startM) : 0;
    var loss = parseFloat(dsp.LossQty) || 0;

    dsp.DistanceKm = dist;
    filteredDispatches.push(dsp);

    var rRow = getRouteRow_(rKeyAll);
    rRow.distanceKm += dist;
    kpi.totalDistanceKm += dist;
    kpi.totalLossQty += loss;
  });

  var filteredFuels = [];
  fuelLogs.forEach(function(f) {
    if (!inDateRange_(f.FuelDate)) return;
    var paidBy = String(f.PaidBy || '');
    var fDrv = String(f.DriverName || '').trim();
    var fVeh = String(f.VehicleID || '').trim();
    var rKey = (paidBy.indexOf('หน้าลาน') !== -1) ? 'หน้าลาน' : (driverRouteMap[fDrv] || vehicleRouteMap[fVeh] || 'หน้าลาน');

    if (!matchRouteFilter_(rKey)) return;

    var fCost = parseFloat(f.TotalCost) || 0;
    var isCashFuel = (paidBy.indexOf('เงินสด') !== -1 || paidBy.indexOf('หัก') !== -1);
    var rRow = getRouteRow_(rKey);

    f.RouteName = rRow.RouteName;
    filteredFuels.push(f);

    kpi.totalFuelCost += fCost;
    rRow.fuelTotal += fCost;
    if (isCashFuel) {
      kpi.totalFuelCash += fCost;
      rRow.fuelCash += fCost;
    }
  });

  var filteredExpenses = [];
  expenses.forEach(function(ex) {
    if (!inDateRange_(ex.ExpDate)) return;
    var st = String(ex.Status || '').trim().toLowerCase();
    if (st === 'cancelled' || st === 'ยกเลิก' || st === 'inactive') return;

    if (filterRoute !== 'ALL' && filterRoute !== 'หน้าลาน') return;

    var amt = parseFloat(ex.Amount) || 0;
    var txType = String(ex.TxType || 'EXPENSE').trim();
    var ch = String(ex.PayChannel || '');
    filteredExpenses.push(ex);

    if (txType === 'OTHER_INCOME') {
      kpi.otherIncomeTotal += amt;
      if (ch.indexOf('โอน') === -1 && ch.indexOf('ธนาคาร') === -1) {
        kpi.otherIncomeCash += amt;
      }
    } else {
      kpi.expManualTotal += amt;
      if (ch.indexOf('ลิ้นชัก') !== -1 || ch.indexOf('หน้าลาน') !== -1) {
        kpi.expDrawerCash += amt;
        if (routeMatrix['หน้าลาน']) {
          routeMatrix['หน้าลาน'].otherCashExp += amt;
        }
      }
    }
  });

  var filteredInvLogs = [];
  var invStats = { totalProduced: 0, totalCrushedOut: 0, totalCrushedIn: 0, totalDispatched: 0, totalAdjusted: 0 };

  invLogs.forEach(function(log) {
    if (!inDateRange_(log.LogDate)) return;
    if (String(log.Note || '').indexOf('[ยกเลิกแล้ว]') !== -1) return;
    var act = String(log.ActionType || '');
    if (act.indexOf('คืนสต๊อก') !== -1) return;

    var qIn = parseFloat(log.QtyIn) || 0;
    var qOut = parseFloat(log.QtyOut) || 0;

    if (act === 'ผลิตเข้าคลัง') invStats.totalProduced += qIn;
    else if (act.indexOf('เบิกไปบด') !== -1) invStats.totalCrushedOut += qOut;
    else if (act.indexOf('รับเข้าจากบด') !== -1) invStats.totalCrushedIn += qIn;
    else if (act.indexOf('เบิกขึ้นรถ') !== -1 || act.indexOf('เบิกเพิ่ม') !== -1 || act === 'ขายหน้าลาน') invStats.totalDispatched += qOut;
    else invStats.totalAdjusted += (qIn - qOut);

    filteredInvLogs.push(log);
  });

  var routeBreakdown = Object.keys(routeMatrix).map(function(k) {
    var r = routeMatrix[k];
    var addIncome = (k === 'หน้าลาน') ? kpi.otherIncomeCash : 0;
    r.netCashToSafe = r.cashSales + r.debtCash + addIncome - r.fuelCash - (r.otherCashExp || 0);
    return r;
  }).filter(function(r) {
    return filterRoute === 'ALL' ? true : (r.RouteKey === filterRoute);
  });

  kpi.netCashToSafe = kpi.cashSales + kpi.debtCollectedCash + kpi.otherIncomeCash - kpi.totalFuelCash - kpi.expDrawerCash;
  kpi.totalBankTransfer = kpi.transferSales + kpi.debtCollectedTransfer;
  kpi.totalInflow = kpi.cashSales + kpi.transferSales + kpi.debtCollectedTotal + kpi.otherIncomeTotal;
  kpi.totalOutflow = kpi.totalFuelCost + kpi.expManualTotal;
  kpi.netCashflow = kpi.totalInflow - kpi.totalOutflow;
  kpi.periodDays = periodDays;

  return {
    filters: { startDate: startDate, endDate: endDate, routeId: filterRoute },
    routes: routes,
    kpi: kpi,
    routeBreakdown: routeBreakdown,
    customerRankingList: customerRankingList,
    salesList: filteredSales.reverse(),
    cancelledList: cancelledSales.reverse(),
    paymentsList: filteredPayments.reverse(),
    expensesList: filteredExpenses.reverse(),
    dispatchesList: filteredDispatches.reverse(),
    fuelsList: filteredFuels.reverse(),
    invStats: invStats,
    invLogsList: filteredInvLogs.reverse()
  };
}

// ==========================================
// 🛡️ 4. AUTOMATED DATABASE BACKUP & DAILY EXECUTIVE ALERT ENGINE
// ==========================================
function getSystemConfigMap_() {
  var cfgHeaders = ['ConfigKey', 'ConfigValue', 'UpdatedAt', 'UpdatedBy'];
  getOrCreateSheet('tb_SystemConfigs', cfgHeaders);
  var rows = getSheetDataAsObjects('tb_SystemConfigs', cfgHeaders);
  var map = {
    'AUTO_ENABLED': 'TRUE',
    'TRIGGER_HOUR': '20',
    'ADMIN_EMAIL': 'spirit6785@gmail.com',
    'RETENTION_DAYS': '30',
    'BACKUP_FOLDER_ID': '',
    'BACKUP_FOLDER_URL': '',
    'TELEGRAM_BOT_TOKEN': '',
    'TELEGRAM_CHAT_ID': ''
  };
  rows.forEach(function(r) {
    var k = String(r.ConfigKey || '').trim();
    if (k) map[k] = String(r.ConfigValue !== undefined ? r.ConfigValue : '').trim();
  });
  return map;
}

function saveSystemConfigMap_(newValuesObj, updatedBy) {
  var cfgHeaders = ['ConfigKey', 'ConfigValue', 'UpdatedAt', 'UpdatedBy'];
  var sheet = getOrCreateSheet('tb_SystemConfigs', cfgHeaders);
  var data = sheet.getDataRange().getValues();
  var now = new Date();

  Object.keys(newValuesObj).forEach(function(key) {
    var val = String(newValuesObj[key] !== undefined ? newValuesObj[key] : '').trim();
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow > 0) {
      sheet.getRange(foundRow, 2, 1, 3).setValues([[val, now, updatedBy || 'Admin']]);
    } else {
      sheet.appendRow([key, val, now, updatedBy || 'Admin']);
      data.push([key, val, now, updatedBy || 'Admin']);
    }
  });
  SpreadsheetApp.flush();
}

function getOrCreateBackupFolder_(cfg) {
  var folderId = cfg['BACKUP_FOLDER_ID'];
  if (folderId) {
    try {
      var existing = DriveApp.getFolderById(folderId);
      if (existing && !existing.isTrashed()) return existing;
    } catch (e) {}
  }

  var folderName = 'MaeJai_IceFactory_ERP_Backups';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  saveSystemConfigMap_({
    'BACKUP_FOLDER_ID': folder.getId(),
    'BACKUP_FOLDER_URL': folder.getUrl()
  }, 'System');

  return folder;
}

function executeDatabaseBackup_(triggerType, createdBy) {
  var cfg = getSystemConfigMap_();
  var folder = getOrCreateBackupFolder_(cfg);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceFile = DriveApp.getFileById(ss.getId());

  var now = new Date();
  var stamp = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd_HHmm');
  var backupName = 'MaeJai_ERP_Backup_' + stamp;

  var copiedFile = sourceFile.makeCopy(backupName, folder);
  var fileUrl = copiedFile.getUrl();

  var retentionDays = Math.max(7, parseInt(cfg['RETENTION_DAYS'], 10) || 30);
  var cutoffTime = now.getTime() - (retentionDays * 24 * 60 * 60 * 1000);
  var purgedCount = 0;

  try {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var fName = String(f.getName() || '');
      if (fName.indexOf('MaeJai_ERP_Backup_') === 0) {
        var createdTime = f.getDateCreated().getTime();
        var isFirstDayOfMonth = fName.indexOf('-01_') !== -1;
        if (createdTime < cutoffTime && !isFirstDayOfMonth) {
          f.setTrashed(true);
          purgedCount++;
        }
      }
    }
  } catch (e) {}

  var bkpHeaders = ['BackupID', 'BackupDate', 'TriggerType', 'FileName', 'FileUrl', 'PurgedCount', 'EmailStatus', 'CreatedBy'];
  var bkpSheet = getOrCreateSheet('tb_BackupLogs', bkpHeaders);
  var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
  var bkpId = generateId(bkpSheet, 'BKP-' + datePrefix, 4);

  bkpSheet.appendRow([
    bkpId,
    now,
    triggerType || 'MANUAL',
    backupName,
    fileUrl,
    purgedCount,
    'Pending',
    createdBy || 'System'
  ]);
  SpreadsheetApp.flush();

  return {
    BackupID: bkpId,
    BackupRow: bkpSheet.getLastRow(),
    FileName: backupName,
    FileUrl: fileUrl,
    FolderUrl: folder.getUrl(),
    PurgedCount: purgedCount
  };
}

function sendDailyExecutiveReport_(backupInfo) {
  var cfg = getSystemConfigMap_();
  var adminEmail = String(cfg['ADMIN_EMAIL'] || '').trim();
  var tgToken = String(cfg['TELEGRAM_BOT_TOKEN'] || '').trim();
  var tgChatId = String(cfg['TELEGRAM_CHAT_ID'] || '').trim();

  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var dash = api_getDashboardData();
  var expDash = api_getExpenseDashboard({ startDate: todayStr, endDate: todayStr });
  var expSum = expDash.summary || {};

  var allSales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var cancelledToday = allSales.filter(function(s) {
    return String(s.SaleDate || '').indexOf(todayStr) === 0 && (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก');
  });

  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails']);
  var todayDispatches = dispatches.filter(function(d) {
    return String(d.DispatchDate || '').indexOf(todayStr) === 0;
  });

  var totalLossIce = 0;
  var totalCashShortage = 0;
  var openShiftCount = 0;
  todayDispatches.forEach(function(d) {
    totalLossIce += (parseFloat(d.LossQty) || 0);
    var diff = parseFloat(d.CashDiff) || 0;
    if (diff < 0) totalCashShortage += Math.abs(diff);
    if (d.Status === 'กำลังวิ่งส่ง') openShiftCount++;
  });

  var fleetAlertsText = '';
  if (typeof api_getFleetDashboard === 'function') {
    try {
      var flt = api_getFleetDashboard({ startDate: todayStr, endDate: todayStr });
      var alertVehs = (flt.fleetList || []).filter(function(v) {
        return v.oilStatus === 'OVERDUE' || v.oilStatus === 'WARN' || v.taxStatus === 'OVERDUE' || v.taxStatus === 'WARN';
      });
      if (alertVehs.length > 0) {
        fleetAlertsText = alertVehs.map(function(v) {
          var alerts = [];
          if (v.oilStatus === 'OVERDUE') alerts.push('🚨 น้ำมันเครื่องเลยกำหนด ' + Math.abs(v.oilRemainKm) + ' กม.');
          else if (v.oilStatus === 'WARN') alerts.push('⚠️ น้ำมันเครื่องเหลือ ' + v.oilRemainKm + ' กม.');
          if (v.taxStatus === 'OVERDUE') alerts.push('🚨 ขาดต่อภาษี ' + Math.abs(v.taxRemainDays) + ' วัน');
          else if (v.taxStatus === 'WARN') alerts.push('⚠️ ภาษีหมดใน ' + v.taxRemainDays + ' วัน');
          return '• รถ ' + v.LicensePlate + ': ' + alerts.join(' | ');
        }).join('<br>');
      }
    } catch (e) {}
  }

  var routeRowsHtml = (dash.routeBreakdown || []).map(function(r) {
    var netCash = (r.cashSales || 0) + (r.debtCollectedCash || 0) - (r.fuelCashCost || 0) - (r.otherCashExp || 0);
    return '<tr>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; font-weight:bold;">' + r.RouteName + '</td>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; text-align:center;">' + r.billCount + ' บิล (' + r.totalQty + ' หน่วย)</td>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; text-align:right;">฿' + Number(r.totalSales || 0).toLocaleString() + '</td>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; text-align:right; color:#6d28d9;">+฿' + Number(r.debtCollectedTotal || 0).toLocaleString() + '</td>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; text-align:right; color:#be123c;">-฿' + Number((r.fuelCashCost || 0) + (r.otherCashExp || 0)).toLocaleString() + '</td>' +
      '<td style="padding:8px; border:1px solid #cbd5e1; text-align:right; font-weight:bold; color:#047857; background:#ecfdf5;">฿' + Number(netCash).toLocaleString() + '</td>' +
    '</tr>';
  }).join('');

  var emailStatus = 'Skipped';

  if (adminEmail) {
    var subject = '🧊 [โรงน้ำแข็งแม่ใจ ERP] สรุปผลประกอบการ & Audit ประจำวันที่ ' + dash.reportDate + ' (กำไรเงินสดสุทธิ ฿' + Number(expSum.netCashflow || 0).toLocaleString() + ')';
    var htmlBody = '<div style="font-family: Tahoma, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; color: #1e293b;">' +
      '<div style="background: #0f172a; color: #ffffff; padding: 20px;">' +
        '<h2 style="margin: 0; font-size: 20px;">🧊 โรงน้ำแข็งแม่ใจ — รายงานสรุปผู้บริหารประจำวัน</h2>' +
        '<p style="margin: 5px 0 0 0; font-size: 13px; color: #94a3b8;">ประจำวันที่: <b>' + dash.reportDate + '</b> | ประมวลผลเมื่อ: ' + Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm') + ' น.</p>' +
      '</div>' +
      '<div style="padding: 20px; background: #ffffff;">' +
        '<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; text-align: center;">' +
          '<tr>' +
            '<td style="padding: 12px; background: #f8fafc; border: 1px solid #cbd5e1; width: 25%;"><span style="font-size: 11px; color: #64748b;">ยอดขายรวม (' + dash.todayBills + ' บิล)</span><br><b style="font-size: 18px; color: #0f172a;">฿' + Number(dash.todaySales || 0).toLocaleString() + '</b><br><span style="font-size: 11px; color: #2563eb;">น้ำแข็ง ' + Number(dash.totalIceQty || 0).toLocaleString() + ' หน่วย</span></td>' +
            '<td style="padding: 12px; background: #fffbeb; border: 1px solid #fde68a; width: 25%;"><span style="font-size: 11px; color: #92400e;">เงินสดลิ้นชักหน้าลานสุทธิ</span><br><b style="font-size: 18px; color: #b45309;">฿' + Number(expSum.frontDrawerNetCash || 0).toLocaleString() + '</b><br><span style="font-size: 11px; color: #78350f;">เสมียนถือส่ง</span></td>' +
            '<td style="padding: 12px; background: #fef2f2; border: 1px solid #fecdd3; width: 25%;"><span style="font-size: 11px; color: #9f1239;">รายจ่ายรวมวันนี้</span><br><b style="font-size: 18px; color: #e11d48;">-฿' + Number(expSum.totalOutflow || 0).toLocaleString() + '</b><br><span style="font-size: 11px; color: #881337;">น้ำมัน+รายจ่ายโรงงาน</span></td>' +
            '<td style="padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; width: 25%;"><span style="font-size: 11px; color: #065f46;">กำไรเงินสดสุทธิวันนี้</span><br><b style="font-size: 18px; color: #059669;">฿' + Number(expSum.netCashflow || 0).toLocaleString() + '</b><br><span style="font-size: 11px; color: #047857;">โอนเข้าบัญชี ฿' + Number(dash.totalBankTransfer || 0).toLocaleString() + '</span></td>' +
          '</tr>' +
        '</table>' +

        '<div style="padding: 12px 15px; background: #fff1f2; border-left: 4px solid #e11d48; border-radius: 8px; margin-bottom: 16px; font-size: 13px;">' +
          '<b>🚨 ตรวจสอบความผิดปกติหน้างานวันนี้ (Daily Audit Red Flags):</b><br>' +
          '• บิลที่ถูกกดยกเลิกวันนี้: <b>' + cancelledToday.length + ' บิล</b><br>' +
          '• น้ำแข็งสูญหาย/ละลายจากสายส่ง: <b>' + totalLossIce + ' หน่วย</b> | เงินสดสายส่งขาด: <b>฿' + totalCashShortage.toLocaleString() + '</b><br>' +
          '• กะสายส่งที่ยังไม่ได้กดปิดกะ: <b>' + openShiftCount + ' สาย</b>' +
          (fleetAlertsText ? ('<br><br><b>🚛 แจ้งเตือนรถขนส่ง (รอบ 7,000 กม. / ภาษี):</b><br>' + fleetAlertsText) : '') +
        '</div>' +

        '<h3 style="font-size: 14px; margin: 0 0 8px 0; color: #334155;">🚚 สรุปผลงานแยกตามสายส่งและหน้าลานวันนี้</h3>' +
        '<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">' +
          '<tr style="background: #f1f5f9;">' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: left;">สายส่ง</th>' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1;">บิล / หน่วย</th>' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">รวมขาย</th>' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">เก็บหนี้ได้</th>' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">หักจ่ายสด</th>' +
            '<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">เงินสดส่ง</th>' +
          '</tr>' +
          routeRowsHtml +
        '</table>' +

        (backupInfo ? (
          '<div style="padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 12px; color: #166534;">' +
            '☁️ <b>สำรองฐานข้อมูล Google Sheets อัตโนมัติสำเร็จแล้ว!</b><br>' +
            'ชื่อไฟล์: <b>' + backupInfo.FileName + '</b><br>' +
            'คลิกเปิดไฟล์สำรอง: <a href="' + backupInfo.FileUrl + '" target="_blank">' + backupInfo.FileUrl + '</a>' +
          '</div>'
        ) : '') +
      '</div>' +
    '</div>';

    try {
      MailApp.sendEmail({
        to: adminEmail,
        subject: subject,
        htmlBody: htmlBody
      });
      emailStatus = 'Sent (' + adminEmail + ')';
    } catch (err) {
      emailStatus = 'Error: ' + err.message;
    }
  }

  if (tgToken && tgChatId) {
    try {
      var tgMsg = '🧊 *สรุปโรงน้ำแข็งแม่ใจ (' + dash.reportDate + ')*\n' +
        '━━━━━━━━━━━━━━\n' +
        '💰 *ยอดขายรวม:* ฿' + Number(dash.todaySales || 0).toLocaleString() + ' (' + dash.todayBills + ' บิล | ' + dash.totalIceQty + ' หน่วย)\n' +
        '💵 *ขายสด:* ฿' + Number(dash.cashSales || 0).toLocaleString() + ' | *โอน:* ฿' + Number(dash.transferSales || 0).toLocaleString() + '\n' +
        '💳 *บิลเชื่อใหม่:* ฿' + Number(dash.creditSales || 0).toLocaleString() + '\n' +
        '🤝 *เก็บหนี้เก่าได้:* ฿' + Number(dash.debtCollectedTotal || 0).toLocaleString() + '\n' +
        '━━━━━━━━━━━━━━\n' +
        '🗄️ *เงินสดลิ้นชักหน้าลาน:* ฿' + Number(expSum.frontDrawerNetCash || 0).toLocaleString() + '\n' +
        '📉 *รายจ่ายรวมวันนี้:* -฿' + Number(expSum.totalOutflow || 0).toLocaleString() + '\n' +
        '💎 *กำไรเงินสดสุทธิ:* ฿' + Number(expSum.netCashflow || 0).toLocaleString() + '\n' +
        '━━━━━━━━━━━━━━\n' +
        '🚨 *Audit:* ยกเลิกบิล ' + cancelledToday.length + ' ใบ | น้ำแข็งหาย ' + totalLossIce + ' หน่วย | เงินขาด ฿' + totalCashShortage + '\n' +
        (backupInfo ? ('☁️ สำรองฐานข้อมูลแล้ว: ' + backupInfo.FileName) : '');

      UrlFetchApp.fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: tgChatId, text: tgMsg, parse_mode: 'Markdown' }),
        muteHttpExceptions: true
      });
    } catch (e) {}
  }

  if (backupInfo && backupInfo.BackupRow) {
    try {
      var bkpSheet = getOrCreateSheet('tb_BackupLogs', ['BackupID', 'BackupDate', 'TriggerType', 'FileName', 'FileUrl', 'PurgedCount', 'EmailStatus', 'CreatedBy']);
      bkpSheet.getRange(backupInfo.BackupRow, 7).setValue(emailStatus);
    } catch (e) {}
  }

  return { EmailStatus: emailStatus };
}

function runAutomatedDailyBackupAndReport() {
  return withSheetLock_(function() {
    var bkp = executeDatabaseBackup_('AUTO (ตั้งเวลาอัตโนมัติ)', 'System Trigger');
    var mailRes = sendDailyExecutiveReport_(bkp);
    writeLog('AUTO_DAILY_JOB', bkp.FileName + ' | ' + mailRes.EmailStatus, 'SUCCESS');
    return { backup: bkp, report: mailRes };
  });
}

function api_getBackupDashboard() {
  var cfg = getSystemConfigMap_();
  var bkpHeaders = ['BackupID', 'BackupDate', 'TriggerType', 'FileName', 'FileUrl', 'PurgedCount', 'EmailStatus', 'CreatedBy'];
  var logs = getSheetDataAsObjects('tb_BackupLogs', bkpHeaders).reverse().slice(0, 30);

  var triggers = ScriptApp.getProjectTriggers();
  var hasActiveTrigger = triggers.some(function(t) {
    return t.getHandlerFunction() === 'runAutomatedDailyBackupAndReport';
  });

  return {
    config: cfg,
    hasActiveTrigger: hasActiveTrigger,
    logs: logs
  };
}

function api_saveBackupSettings(payload) {
  return withSheetLock_(function() {
    var autoEnabled = payload && payload.AUTO_ENABLED ? String(payload.AUTO_ENABLED).toUpperCase() : 'TRUE';
    var triggerHour = parseInt(payload && payload.TRIGGER_HOUR ? payload.TRIGGER_HOUR : 20, 10);
    if (isNaN(triggerHour) || triggerHour < 0 || triggerHour > 23) triggerHour = 20;

    saveSystemConfigMap_({
      'AUTO_ENABLED': autoEnabled,
      'TRIGGER_HOUR': String(triggerHour),
      'ADMIN_EMAIL': payload.ADMIN_EMAIL || 'spirit6785@gmail.com',
      'RETENTION_DAYS': payload.RETENTION_DAYS || '30',
      'TELEGRAM_BOT_TOKEN': payload.TELEGRAM_BOT_TOKEN || '',
      'TELEGRAM_CHAT_ID': payload.TELEGRAM_CHAT_ID || ''
    }, payload.CreatedBy || 'Admin');

    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function(t) {
      if (t.getHandlerFunction() === 'runAutomatedDailyBackupAndReport') {
        ScriptApp.deleteTrigger(t);
      }
    });

    if (autoEnabled === 'TRUE') {
      ScriptApp.newTrigger('runAutomatedDailyBackupAndReport')
        .timeBased()
        .everyDays(1)
        .atHour(triggerHour)
        .create();
    }

    writeLog('SAVE_BACKUP_CFG', 'Auto=' + autoEnabled + ' | Hour=' + triggerHour + ':00 | Email=' + payload.ADMIN_EMAIL, 'SUCCESS');
    return { Status: 'Saved', AutoEnabled: autoEnabled === 'TRUE', TriggerHour: triggerHour };
  });
}

function api_runManualBackupNow(payload) {
  return withSheetLock_(function() {
    var bkp = executeDatabaseBackup_('MANUAL (กดสั่งเอง)', payload && payload.CreatedBy ? payload.CreatedBy : 'Admin');
    var sendMailToo = payload && payload.sendReport === true;
    var mailRes = { EmailStatus: 'ไม่ได้สั่งส่งอีเมล (สำรองเฉพาะไฟล์)' };
    if (sendMailToo) {
      mailRes = sendDailyExecutiveReport_(bkp);
    } else if (bkp.BackupRow) {
      var bkpSheet = getOrCreateSheet('tb_BackupLogs', ['BackupID', 'BackupDate', 'TriggerType', 'FileName', 'FileUrl', 'PurgedCount', 'EmailStatus', 'CreatedBy']);
      bkpSheet.getRange(bkp.BackupRow, 7).setValue('สำรองไฟล์อย่างเดียว');
    }
    writeLog('MANUAL_BACKUP', bkp.FileName, 'SUCCESS');
    return { backup: bkp, report: mailRes };
  });
}

function api_sendExecutiveReportNow(payload) {
  var res = sendDailyExecutiveReport_(null);
  writeLog('SEND_EXEC_REPORT_NOW', res.EmailStatus + ' โดย ' + (payload && payload.CreatedBy ? payload.CreatedBy : 'Admin'), 'SUCCESS');
  return res;
}