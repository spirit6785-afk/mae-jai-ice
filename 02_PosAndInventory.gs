/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 02: POS & COLD-ROOM INVENTORY (02_PosAndInventory.gs)
 * Version: 5.7 (Clean Modular Architecture - Single Source of Truth Stock Engine)
 * ⚠️ วิธีติดตั้ง: สร้างไฟล์สคริปต์ชื่อ "02_PosAndInventory" ใน GAS แล้ววางโค้ดนี้ทั้งหมด
 * ============================================================================
 */

// ==========================================
// 🧮 1. MASTER COLD-ROOM STOCK ENGINE (Single Source of Truth)
// ==========================================
function computeMasterStockBalances_(startDateStr, endDateStr) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var sDate = startDateStr || todayStr;
  var eDate = endDateStr || sDate;

  var prodHeaders = ['ProductID', 'ProductName', 'DefaultPrice', 'Unit', 'Status', 'CreatedAt'];
  var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
  var dspHeaders = ['DispatchID', 'DispatchDate', 'RouteID', 'RouteName', 'VehicleID', 'DriverName', 'StartMileage', 'EndMileage', 'LoadedQty', 'SoldQty', 'ReturnedQty', 'LossQty', 'CashSales', 'TransferSales', 'CreditSales', 'FuelExpense', 'OtherExpense', 'ExpectedCash', 'ActualCash', 'CashDiff', 'Status', 'Note', 'LoadDetails'];
  var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
  var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];

  var prodSheet = getOrCreateSheet('tb_Products', prodHeaders);
  if (prodSheet.getLastRow() <= 1) {
    var nowInit = new Date();
    prodSheet.getRange(2, 1, 4, 6).setValues([
      ['P-0001', 'น้ำแข็งหลอดใหญ่', 35, 'กระสอบ', 'Active', nowInit],
      ['P-0002', 'น้ำแข็งหลอดเล็ก', 35, 'กระสอบ', 'Active', nowInit],
      ['P-0003', 'น้ำแข็งบด', 30, 'กระสอบ', 'Active', nowInit],
      ['P-0004', 'น้ำแข็งซอง', 50, 'ซอง', 'Active', nowInit]
    ]);
  }

  var products = getSheetDataAsObjects('tb_Products', prodHeaders).filter(function(p) {
    return String(p.Status || '').trim() !== 'Inactive';
  });
  var invLogs = getSheetDataAsObjects('tb_InventoryLogs', invHeaders);
  var dispatches = getSheetDataAsObjects('tb_RouteDispatches', dspHeaders);
  var sales = getSheetDataAsObjects('tb_Sales', salesHeaders);
  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', detailHeaders);

  var stockMap = {};
  var simpleBalanceMap = {};
  var productOrder = [];

  products.forEach(function(p) {
    var pid = String(p.ProductID || '').trim();
    if (!pid) return;
    productOrder.push(pid);
    stockMap[pid] = {
      ProductID: pid,
      ProductName: p.ProductName,
      DefaultPrice: parseFloat(p.DefaultPrice) || 0,
      Unit: p.Unit || 'กระสอบ',
      Balance: 0,
      TotalIn: 0,
      TotalOut: 0,
      TodayProduced: 0,
      PeriodIn: 0,
      PeriodOut: 0,
      OnTruckQty: 0
    };
    simpleBalanceMap[pid] = 0;
  });

  var periodProduction = 0;
  var periodCrushedOut = 0;
  var periodCrushedIn = 0;
  var periodDispatch = 0;
  var periodFrontSale = 0;
  var periodAuditDiff = 0;
  var filteredLogs = [];

  invLogs.forEach(function(log) {
    var pid = String(log.ProductID || '').trim();
    if (!pid) return;

    var qIn = parseFloat(log.QtyIn) || 0;
    var qOut = parseFloat(log.QtyOut) || 0;
    var act = String(log.ActionType || '').trim();
    var noteStr = String(log.Note || '');
    var isCancelledRow = (noteStr.indexOf('[ยกเลิกแล้ว]') !== -1);
    var isRefundRow = (act.indexOf('คืนสต๊อก') !== -1);
    var logDay = String(log.LogDate || '').slice(0, 10);

    if (!stockMap[pid]) {
      productOrder.push(pid);
      stockMap[pid] = {
        ProductID: pid,
        ProductName: log.ProductName || pid,
        DefaultPrice: 0,
        Unit: 'กระสอบ',
        Balance: 0,
        TotalIn: 0,
        TotalOut: 0,
        TodayProduced: 0,
        PeriodIn: 0,
        PeriodOut: 0,
        OnTruckQty: 0
      };
      simpleBalanceMap[pid] = 0;
    }

    // 1. คำนวณยอดคงเหลือจริงในห้องเย็น (Balance = QtyIn - QtyOut ทุกแถวตามหลักบัญชีคู่)
    stockMap[pid].Balance += (qIn - qOut);
    stockMap[pid].TotalIn += qIn;
    stockMap[pid].TotalOut += qOut;
    simpleBalanceMap[pid] = stockMap[pid].Balance;

    // 2. เก็บสถิติเฉพาะในช่วงวันที่เลือก (sDate ถึง eDate)
    if (logDay >= sDate && logDay <= eDate) {
      filteredLogs.push(log);
      if (!isCancelledRow && !isRefundRow) {
        stockMap[pid].PeriodIn += qIn;
        stockMap[pid].PeriodOut += qOut;

        if (act === 'ผลิตเข้าคลัง') {
          stockMap[pid].TodayProduced += qIn;
          periodProduction += qIn;
        } else if (act === 'เบิกไปบด') {
          periodCrushedOut += qOut;
        } else if (act === 'รับเข้าจากบด') {
          periodCrushedIn += qIn;
        } else if (act.indexOf('เบิกขึ้นรถ') !== -1 || act.indexOf('เบิกเพิ่ม') !== -1) {
          periodDispatch += qOut;
        } else if (act === 'ขายหน้าลาน') {
          periodFrontSale += qOut;
        } else if (act.indexOf('ตรวจนับสต๊อก') !== -1 || act.indexOf('ปรับ') !== -1) {
          periodAuditDiff += (qIn - qOut);
        }
      }
    }
  });

  // 3. คำนวณจำนวนน้ำแข็งที่กำลังวิ่งอยู่บนรถสายส่งขณะนี้ (OnTruckQty)
  var activeDispatches = dispatches.filter(function(d) { return String(d.Status || '').trim() === 'กำลังวิ่งส่ง'; });
  var totalOnTruckQty = 0;

  if (activeDispatches.length > 0) {
    var soldByRouteAndProd = {};
    var validSaleRouteMap = {};
    sales.forEach(function(s) {
      if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') return;
      if (String(s.SaleID || '').indexOf('AR-') === 0) return;
      var sDay = String(s.SaleDate || '').slice(0, 10);
      validSaleRouteMap[s.SaleID] = { day: sDay, routeId: String(s.RouteID || '').trim() };
    });

    saleDetails.forEach(function(det) {
      var sInfo = validSaleRouteMap[det.SaleID];
      if (!sInfo) return;
      var pid = String(det.ProductID || '').trim();
      if (!isStockProductId_(pid)) return;
      var key = sInfo.day + '|' + sInfo.routeId + '|' + pid;
      soldByRouteAndProd[key] = (soldByRouteAndProd[key] || 0) + (parseFloat(det.Quantity) || 0);
    });

    activeDispatches.forEach(function(dsp) {
      var dspDay = String(dsp.DispatchDate || '').slice(0, 10);
      var rId = String(dsp.RouteID || '').trim();
      var rName = String(dsp.RouteName || '').trim();
      var loadedArr = [];
      try { loadedArr = JSON.parse(dsp.LoadDetails || '[]'); } catch (e) { loadedArr = []; }

      loadedArr.forEach(function(ld) {
        var pid = String(ld.id || '').trim();
        var lQty = parseFloat(ld.qty) || 0;
        var sQty = (soldByRouteAndProd[dspDay + '|' + rId + '|' + pid] || 0) + (rName !== rId ? (soldByRouteAndProd[dspDay + '|' + rName + '|' + pid] || 0) : 0);
        var rem = Math.max(0, lQty - sQty);
        if (stockMap[pid]) {
          stockMap[pid].OnTruckQty += rem;
          totalOnTruckQty += rem;
        }
      });
    });
  }

  // 4. ดึงยอดผลิตหน้าเครื่องจากใบตรวจเครื่องจักร (tb_MachineLogs) ในช่วงวันที่เลือกมาเปรียบเทียบ
  var machineYieldTotal = 0;
  try {
    var macLogs = getSheetDataAsObjects('tb_MachineLogs', ['LogID', 'LogDate', 'MachineID', 'MachineName', 'ShiftName', 'HighPressure', 'LowPressure', 'Amperage', 'OilLevel', 'IceYieldBags', 'MachineStatus', 'MaintenanceCost', 'InspectorName', 'RefExpID', 'Note']);
    macLogs.forEach(function(ml) {
      var mDay = String(ml.LogDate || '').slice(0, 10);
      if (mDay >= sDate && mDay <= eDate) {
        machineYieldTotal += (parseFloat(ml.IceYieldBags) || 0);
      }
    });
  } catch (e) {}

  var balancesList = productOrder.map(function(pid) { return stockMap[pid]; });
  var totalColdRoomUnits = balancesList.reduce(function(acc, b) { return acc + (b.Balance || 0); }, 0);

  return {
    filters: { startDate: sDate, endDate: eDate },
    summary: {
      totalColdRoomUnits: totalColdRoomUnits,
      todayProduction: periodProduction,
      machineYieldTotal: machineYieldTotal,
      periodCrushedOut: periodCrushedOut,
      periodCrushedIn: periodCrushedIn,
      todayDispatch: periodDispatch + periodFrontSale,
      routeDispatchQty: periodDispatch,
      frontSaleQty: periodFrontSale,
      onTruckQty: totalOnTruckQty,
      activeTruckCount: activeDispatches.length,
      todayTransfer: periodAuditDiff
    },
    balances: balancesList,
    simpleStockMap: simpleBalanceMap,
    products: products,
    recentLogs: filteredLogs.reverse()
  };
}

// ==========================================
// 🛒 2. SMART POS & SALES ENGINE (ขายหน้าลาน & สายส่ง)
// ==========================================
function api_getInitialPOSData() {
  var routeSheet = getOrCreateSheet('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']);
  if (routeSheet.getLastRow() <= 1) {
    var nowRt = new Date();
    routeSheet.getRange(2, 1, 2, 5).setValues([
      ['RT-0001', 'สายส่ง A (แม่ใจ-เจริญราษฎร์)', 'วิ่งโซนตลาดและรอบนอก', 'Active', nowRt],
      ['RT-0002', 'สายส่ง B (ศรีถ้อย-ป่าแฝก)', 'วิ่งโซนเหนือ', 'Active', nowRt]
    ]);
  }

  // ดึงสต๊อกและสินค้าจากศูนย์กลาง computeMasterStockBalances_ เพื่อให้ตรงกันทุกหน้า 100%
  var masterStock = computeMasterStockBalances_();
  var products = masterStock.products;
  var stockMap = masterStock.simpleStockMap;

  var customers = api_getCustomers();
  var specialPrices = getSheetDataAsObjects('tb_SpecialPrices', ['SpPriceID', 'CustomerID', 'ProductID', 'SpecialPrice', 'Status', 'CreatedAt']).filter(function(s) { return s.Status !== 'Inactive'; });
  var routes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']).filter(function(r) { return r.Status !== 'Inactive'; });
  var promoMap = getCustomerPromoMap_();

  var prodUnitMap = {};
  products.forEach(function(p) {
    prodUnitMap[p.ProductID] = p.Unit || 'กระสอบ';
  });

  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var allSales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var allDetails = getSheetDataAsObjects('tb_SalesDetails', ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal']);

  var factorySaleIds = {};
  var rawFactorySales = [];

  for (var i = 0; i < allSales.length; i++) {
    var s = allSales[i];
    var isToday = String(s.SaleDate || '').indexOf(todayStr) === 0;
    var isManualAr = String(s.SaleID || '').indexOf('AR-') === 0;
    if (!isToday || isManualAr) continue;

    var rId = String(s.RouteID || '').trim();
    var isFactorySale = (rId === '' || rId === 'หน้าลาน' || rId === 'หน้าร้าน' || rId === 'หน้าโรง' || rId === 'หน้าโรงงาน' || rId === 'WALK-IN');

    if (isFactorySale) {
      rawFactorySales.push(s);
      factorySaleIds[s.SaleID] = true;
    }
  }

  var summaryBySaleId = {};
  var detailsBySaleId = {};
  for (var j = 0; j < allDetails.length; j++) {
    var d = allDetails[j];
    if (!factorySaleIds[d.SaleID]) continue;
    if (!summaryBySaleId[d.SaleID]) summaryBySaleId[d.SaleID] = [];
    summaryBySaleId[d.SaleID].push(d.ProductName + ' x' + d.Quantity);
    if (!detailsBySaleId[d.SaleID]) detailsBySaleId[d.SaleID] = [];
    detailsBySaleId[d.SaleID].push(d);
  }

  var todaySales = [];
  var prodSummaryMap = {};

  products.forEach(function(p, idx) {
    prodSummaryMap[p.ProductID] = {
      id: p.ProductID,
      name: p.ProductName,
      category: 'สินค้าหลัก (ตัดสต๊อก)',
      unit: p.Unit || 'กระสอบ',
      qty: 0,
      amount: 0,
      order: idx + 1
    };
  });

  rawFactorySales.forEach(function(s) {
    s.ItemSummary = (summaryBySaleId[s.SaleID] || []).join(', ');
    s.Items = detailsBySaleId[s.SaleID] || [];
    todaySales.push(s);

    if (s.PaymentStatus !== 'Cancelled' && s.PaymentStatus !== 'ยกเลิก') {
      (detailsBySaleId[s.SaleID] || []).forEach(function(det) {
        var pid = String(det.ProductID || '').trim();
        var pname = String(det.ProductName || pid);
        var q = parseFloat(det.Quantity) || 0;
        var amt = parseFloat(det.SubTotal);
        if (isNaN(amt)) amt = q * (parseFloat(det.UnitPrice) || 0);

        var key = pid || pname;
        if (!prodSummaryMap[key]) {
          var cat = 'สินค้าหลัก (ตัดสต๊อก)';
          var u = prodUnitMap[pid] || 'กระสอบ';
          var ord = 50;
          if (pid.indexOf('RET-') === 0) {
            cat = 'ขายปลีก (ไม่ตัดสต๊อก)';
            u = 'รายการ';
            ord = 80;
          } else if (pid === 'FEE') {
            cat = 'ค่าธรรมเนียม/กระสอบ';
            u = 'รายการ';
            ord = 90;
          } else if (pid === 'DISCOUNT') {
            cat = 'หักส่วนลดท้ายบิล';
            u = 'รายการ';
            ord = 99;
          }
          prodSummaryMap[key] = { id: pid, name: pname, category: cat, unit: u, qty: 0, amount: 0, order: ord };
        }
        prodSummaryMap[key].qty += q;
        prodSummaryMap[key].amount += amt;
      });
    }
  });

  var productSummary = Object.keys(prodSummaryMap).map(function(k) {
    return prodSummaryMap[k];
  }).filter(function(item) {
    return item.qty > 0 || item.amount !== 0;
  }).sort(function(a, b) {
    return a.order - b.order;
  });

  return {
    products: products,
    customers: customers,
    specialPrices: specialPrices,
    promoMap: promoMap,
    routes: routes,
    stockMap: stockMap,
    todaySales: todaySales.reverse(),
    productSummary: productSummary
  };
}

function api_saveSale(payload) {
  return withSheetLock_(function() {
    var items = payload.items || [];
    if (items.length === 0) throw new Error('ไม่มีรายการสินค้าในตะกร้า');

    var rId = String(payload.RouteID || 'หน้าลาน').trim();
    var isRouteSale = (rId !== '' && rId !== 'หน้าลาน' && rId !== 'หน้าร้าน' && rId !== 'หน้าโรง' && rId !== 'หน้าโรงงาน' && rId !== 'WALK-IN');

    if (isRouteSale) {
      assertRouteShiftActive_(rId, payload.CreatedBy || '');
    }

    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
    var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
    var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];

    var salesSheet = getOrCreateSheet('tb_Sales', salesHeaders);
    var detailSheet = getOrCreateSheet('tb_SalesDetails', detailHeaders);
    var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);

    var saleId = generateId(salesSheet, 'SL-' + datePrefix, 4);
    var totalAmount = 0;
    var detailRows = [];
    var invRows = [];

    var detailLastRow = detailSheet.getLastRow();
    var invLastRow = invSheet.getLastRow();

    items.forEach(function(item, idx) {
      var qty = parseFloat(item.Quantity) || 0;
      var price = parseFloat(item.UnitPrice) || 0;
      var sub = qty * price;
      totalAmount += sub;

      var pid = String(item.ProductID || '').trim();
      var detId = 'DT-' + datePrefix + '-' + (detailLastRow + idx + 1).toString().padStart(4, '0');
      detailRows.push([
        detId,
        saleId,
        pid,
        item.ProductName,
        qty,
        price,
        sub
      ]);

      // ตัดสต๊อกคลังหลักเฉพาะสินค้าปกติที่ขายหน้าโรงงานเท่านั้น
      if (!isRouteSale && isStockProductId_(pid) && qty > 0) {
        var invId = 'INV-' + datePrefix + '-' + (invLastRow + invRows.length + 1).toString().padStart(4, '0');
        invRows.push([
          invId,
          now,
          pid,
          item.ProductName,
          'ขายหน้าลาน',
          0,
          qty,
          saleId,
          payload.CreatedBy || 'POS',
          'ลูกค้า: ' + (payload.CustomerName || 'ขาจร')
        ]);
      }
    });

    var payType = String(payload.PaymentType || 'เงินสด');
    var isCredit = (payType.indexOf('เครดิต') !== -1 || payType.indexOf('บิลเชื่อ') !== -1 || payType.indexOf('ค้างชำระ') !== -1);
    var payStatus = isCredit ? 'Unpaid' : 'Paid';

    salesSheet.appendRow([
      saleId,
      now,
      payload.CustomerID || 'WALK-IN',
      payload.CustomerName || 'ขาจร',
      rId || 'หน้าลาน',
      totalAmount,
      payType,
      payStatus,
      payload.CreatedBy || (isRouteSale ? 'Driver' : 'POS')
    ]);

    if (detailRows.length > 0) {
      detailSheet.getRange(detailLastRow + 1, 1, detailRows.length, 7).setValues(detailRows);
    }
    if (invRows.length > 0) {
      invSheet.getRange(invLastRow + 1, 1, invRows.length, 10).setValues(invRows);
    }

    SpreadsheetApp.flush();
    writeLog('SAVE_SALE', saleId + ' (฿' + totalAmount + ')', 'SUCCESS');

    return {
      SaleID: saleId,
      SaleDate: Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd HH:mm'),
      CustomerName: payload.CustomerName || 'ขาจร',
      PaymentType: payType,
      TotalAmount: totalAmount,
      CashTendered: payload.CashTendered || totalAmount,
      Change: payload.Change || 0,
      Items: items
    };
  });
}

function api_cancelSale(payload) {
  return withSheetLock_(function() {
    var saleId = payload && payload.SaleID ? String(payload.SaleID).trim() : '';
    var cancelReason = payload && payload.Reason ? String(payload.Reason).trim() : 'ทำรายการผิด';
    var cancelledBy = payload && payload.CancelledBy || payload.CreatedBy ? String(payload.CancelledBy || payload.CreatedBy).trim() : 'Admin';

    if (!saleId) throw new Error('ไม่พบเลขที่บิลที่ต้องการยกเลิก');

    var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
    var salesSheet = getOrCreateSheet('tb_Sales', salesHeaders);
    var sData = salesSheet.getDataRange().getValues();
    var foundRow = -1;
    var routeId = 'หน้าลาน';
    var custName = '';
    var billAmt = 0;

    for (var i = 1; i < sData.length; i++) {
      if (String(sData[i][0]) === saleId) {
        if (sData[i][7] === 'Cancelled' || sData[i][7] === 'ยกเลิก') {
          throw new Error('บิลนี้ถูกยกเลิกไปแล้วค่ะ');
        }
        foundRow = i + 1;
        custName = String(sData[i][3] || '');
        routeId = String(sData[i][4] || 'หน้าลาน').trim();
        billAmt = parseFloat(sData[i][5]) || 0;
        break;
      }
    }

    if (foundRow === -1) throw new Error('ไม่พบเลขที่บิล: ' + saleId);

    var isRouteSale = (routeId !== '' && routeId !== 'หน้าลาน' && routeId !== 'หน้าร้าน' && routeId !== 'หน้าโรง' && routeId !== 'หน้าโรงงาน' && routeId !== 'WALK-IN');
    if (isRouteSale) {
      assertRouteShiftActive_(routeId, cancelledBy);
    }

    salesSheet.getRange(foundRow, 8).setValue('Cancelled');

    if (!isRouteSale && saleId.indexOf('AR-') !== 0) {
      var details = getSheetDataAsObjects('tb_SalesDetails', ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal']);
      var invHeaders = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
      var invSheet = getOrCreateSheet('tb_InventoryLogs', invHeaders);
      var invLastRow = invSheet.getLastRow();
      var now = new Date();
      var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
      var refundRows = [];

      details.forEach(function(d) {
        var q = parseFloat(d.Quantity) || 0;
        if (String(d.SaleID) === saleId && isStockProductId_(d.ProductID) && q > 0) {
          var invId = 'INV-' + datePrefix + '-' + (invLastRow + refundRows.length + 1).toString().padStart(4, '0');
          refundRows.push([
            invId,
            now,
            d.ProductID,
            d.ProductName,
            'คืนสต๊อก (ยกเลิกบิล)',
            q,
            0,
            saleId,
            cancelledBy,
            'ยกเลิกบิล ' + saleId + ' (' + cancelReason + ')'
          ]);
        }
      });

      if (refundRows.length > 0) {
        invSheet.getRange(invLastRow + 1, 1, refundRows.length, 10).setValues(refundRows);
      }
    }

    SpreadsheetApp.flush();
    writeLog('CANCEL_SALE', saleId + ' | ร้าน: ' + custName + ' (฿' + billAmt + ') | โดย: ' + cancelledBy + ' | สาเหตุ: ' + cancelReason, 'WARNING');
    return { SaleID: saleId, Status: 'Cancelled' };
  });
}

// ==========================================
// 📦 3. INVENTORY MANAGEMENT & PHYSICAL STOCK AUDIT
// ==========================================
function api_getInventoryDashboard(payload) {
  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var sDate = (payload && payload.startDate) ? String(payload.startDate).trim() : todayStr;
  var eDate = (payload && payload.endDate) ? String(payload.endDate).trim() : todayStr;
  return computeMasterStockBalances_(sDate, eDate);
}

function api_saveInventoryTransaction(payload) {
  return withSheetLock_(function() {
    if (!payload.items || payload.items.length === 0) {
      throw new Error('กรุณาระบุจำนวนสินค้าอย่างน้อย 1 รายการ');
    }
    var headers = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_InventoryLogs', headers);
    var lastRow = sheet.getLastRow();
    var todayPrefix = 'INV-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd');
    var lastNum = 0;

    if (lastRow > 1) {
      var lastIdStr = String(sheet.getRange(lastRow, 1).getValue());
      var parts = lastIdStr.split('-');
      lastNum = parseInt(parts[parts.length - 1], 10);
      if (isNaN(lastNum)) lastNum = lastRow - 1;
    }

    var now = new Date();
    var rowsToInsert = [];

    payload.items.forEach(function(item) {
      var q = parseFloat(item.qty) || 0;
      if (q <= 0) return;

      lastNum++;
      var itemFlow = item.flow || payload.Flow || 'IN';
      var itemAction = item.actionType || payload.ActionType || 'ปรับปรุงสต๊อก';
      var itemRef = item.reference !== undefined ? item.reference : (payload.Reference || '');
      var itemNote = item.note !== undefined ? item.note : (payload.Note || '');

      var qtyIn = itemFlow === 'IN' ? q : 0;
      var qtyOut = itemFlow === 'OUT' ? q : 0;

      rowsToInsert.push([
        todayPrefix + '-' + lastNum.toString().padStart(4, '0'),
        now,
        String(item.id || '').trim(),
        item.name,
        itemAction,
        qtyIn,
        qtyOut,
        itemRef,
        payload.CreatedBy || 'Admin',
        itemNote
      ]);
    });

    if (rowsToInsert.length === 0) throw new Error('จำนวนสินค้าต้องมากกว่า 0');
    sheet.getRange(lastRow + 1, 1, rowsToInsert.length, 10).setValues(rowsToInsert);
    SpreadsheetApp.flush();
    writeLog('INVENTORY_TX', (payload.ActionType || 'MIXED') + ' (' + rowsToInsert.length + ' รายการ)', 'SUCCESS');
    return { Status: 'Success', Count: rowsToInsert.length };
  });
}

function api_saveStockAudit(payload) {
  return withSheetLock_(function() {
    var auditList = payload && payload.auditItems ? payload.auditItems : [];
    if (!Array.isArray(auditList) || auditList.length === 0) {
      throw new Error('ไม่มีรายการสินค้าสำหรับตรวจนับสต๊อก');
    }

    var currentStock = computeMasterStockBalances_();
    var curMap = currentStock.simpleStockMap || {};
    var headers = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_InventoryLogs', headers);
    var lastRow = sheet.getLastRow();
    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var auditRef = 'AUD-' + Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd-HHmm');
    var createdBy = payload.CreatedBy || 'Admin';
    var userNote = payload.Note ? (' (' + payload.Note + ')') : '';

    var rowsToInsert = [];
    auditList.forEach(function(item) {
      var pid = String(item.id || '').trim();
      var actualQty = parseFloat(item.actualQty);
      if (!pid || isNaN(actualQty) || actualQty < 0) return;

      var sysQty = parseFloat(curMap[pid]) || 0;
      var diff = actualQty - sysQty;
      if (diff === 0) return;

      var invId = 'INV-' + datePrefix + '-' + (lastRow + rowsToInsert.length + 1).toString().padStart(4, '0');
      var qIn = diff > 0 ? diff : 0;
      var qOut = diff < 0 ? Math.abs(diff) : 0;
      var actLabel = diff > 0 ? 'ตรวจนับสต๊อก (ปรับเพิ่ม)' : 'ตรวจนับสต๊อก (ตัดขาด/ละลาย)';
      var detailNote = 'ระบบเดิม ' + sysQty + ' -> นับจริง ' + actualQty + ' (ผลต่าง ' + (diff > 0 ? '+' + diff : diff) + ')' + userNote;

      rowsToInsert.push([
        invId,
        now,
        pid,
        item.name || pid,
        actLabel,
        qIn,
        qOut,
        auditRef,
        createdBy,
        detailNote
      ]);
    });

    if (rowsToInsert.length > 0) {
      sheet.getRange(lastRow + 1, 1, rowsToInsert.length, 10).setValues(rowsToInsert);
      SpreadsheetApp.flush();
    }

    writeLog('STOCK_AUDIT', auditRef + ' ปรับยอด ' + rowsToInsert.length + ' รายการ โดย ' + createdBy, 'SUCCESS');
    return { AuditRef: auditRef, AdjustedCount: rowsToInsert.length };
  });
}

function api_cancelInventoryLog(payload) {
  return withSheetLock_(function() {
    var invLogId = payload && payload.InvLogID ? String(payload.InvLogID).trim() : '';
    if (!invLogId) throw new Error('ไม่พบรหัสรายการสต๊อกที่ต้องการยกเลิก');

    var headers = ['InvLogID', 'LogDate', 'ProductID', 'ProductName', 'ActionType', 'QtyIn', 'QtyOut', 'Reference', 'CreatedBy', 'Note'];
    var sheet = getOrCreateSheet('tb_InventoryLogs', headers);
    var data = sheet.getDataRange().getValues();

    var foundRow = -1;
    var rowObj = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === invLogId) {
        var oldNote = String(data[i][9] || '');
        if (oldNote.indexOf('[ยกเลิกแล้ว]') !== -1) {
          throw new Error('รายการนี้ถูกยกเลิกไปแล้วค่ะ');
        }
        foundRow = i + 1;
        rowObj = {
          pid: String(data[i][2]).trim(),
          pname: String(data[i][3] || ''),
          act: String(data[i][4] || ''),
          qIn: parseFloat(data[i][5]) || 0,
          qOut: parseFloat(data[i][6]) || 0,
          ref: String(data[i][7] || ''),
          note: oldNote
        };
        break;
      }
    }

    if (foundRow === -1 || !rowObj) throw new Error('ไม่พบรหัสรายการสต๊อก: ' + invLogId);

    sheet.getRange(foundRow, 10).setValue('[ยกเลิกแล้ว] ' + rowObj.note);

    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var newInvId = generateId(sheet, 'INV-' + datePrefix, 4);
    var cancelledBy = payload.CreatedBy || 'Admin';

    sheet.appendRow([
      newInvId,
      now,
      rowObj.pid,
      rowObj.pname,
      'คืนสต๊อก (ยกเลิก ' + invLogId + ')',
      rowObj.qOut,
      rowObj.qIn,
      invLogId,
      cancelledBy,
      'ยกเลิกรายการที่คีย์ผิด: ' + rowObj.act
    ]);

    SpreadsheetApp.flush();
    writeLog('CANCEL_INV_LOG', invLogId + ' (' + rowObj.pname + ') โดย ' + cancelledBy, 'WARNING');
    return { InvLogID: invLogId, Status: 'Cancelled' };
  });
}