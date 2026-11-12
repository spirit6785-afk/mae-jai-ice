/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - FILE 04: CREDIT (AR) & BUCKET MANAGEMENT (04_CreditAndBuckets.gs)
 * Version: 5.7 (Clean Modular Architecture - AR Aging, Partial Payment & Bucket ROI)
 * ⚠️ วิธีติดตั้ง: สร้างไฟล์สคริปต์ชื่อ "04_CreditAndBuckets" ใน GAS แล้ววางโค้ดนี้ทั้งหมด
 * ============================================================================
 */

// ==========================================
// 💳 1. CREDIT & AR COLLECTION ENGINE (ระบบลูกหนี้การค้า, อายุหนี้ & แบ่งจ่ายบางส่วน)
// ==========================================
function api_getCreditDashboard() {
  var sales = getSheetDataAsObjects('tb_Sales', ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy']);
  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal']);
  var customers = api_getCustomers();
  var routes = getSheetDataAsObjects('tb_Routes', ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt']);
  var payments = getSheetDataAsObjects('tb_Payments', ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note']);

  var routeMap = { 'หน้าลาน': '🏠 หน้าลาน (หน้าร้าน)' };
  routes.forEach(function(r) {
    if (r.RouteID) routeMap[String(r.RouteID).trim()] = r.RouteName;
    if (r.RouteName) routeMap[String(r.RouteName).trim()] = r.RouteName;
  });

  var custMap = {};
  var nameToCustId = {};
  customers.forEach(function(c) {
    var cid = String(c.CustomerID).trim();
    custMap[cid] = {
      CustomerID: cid,
      CustomerName: c.CustomerName,
      Phone: c.Phone || '',
      RouteID: c.RouteID || 'หน้าลาน',
      RouteName: routeMap[c.RouteID] || c.RouteID || 'หน้าลาน',
      CreditLimit: parseFloat(c.CreditLimit) || 0
    };
    if (c.CustomerName) {
      nameToCustId[String(c.CustomerName).trim().toLowerCase()] = cid;
    }
  });

  var itemSummaryBySale = {};
  saleDetails.forEach(function(d) {
    if (!itemSummaryBySale[d.SaleID]) itemSummaryBySale[d.SaleID] = [];
    itemSummaryBySale[d.SaleID].push(d.ProductName + (parseFloat(d.Quantity) > 1 ? ' x' + d.Quantity : ''));
  });

  var todayStr = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var tParts = todayStr.split('-');
  var todayMidnight = new Date(parseInt(tParts[0], 10), parseInt(tParts[1], 10) - 1, parseInt(tParts[2], 10)).getTime();

  var debtByCust = {};
  var totalOutstanding = 0;
  var totalUnpaidBills = 0;
  var overLimitCount = 0;
  var agingStats = { normal0to7: 0, warn8to15: 0, late16to30: 0, critOver30: 0, critOver30Amt: 0 };

  sales.forEach(function(s) {
    var pType = String(s.PaymentType || '');
    var isCredit = (pType.indexOf('เครดิต') !== -1 || pType.indexOf('บิลเชื่อ') !== -1 || pType.indexOf('ค้างชำระ') !== -1 || pType.indexOf('ยอดยกมา') !== -1);
    var isUnpaid = (s.PaymentStatus === 'Unpaid' || s.PaymentStatus === 'ค้างชำระ');

    if (isCredit && isUnpaid) {
      var rawCid = String(s.CustomerID || 'WALK-IN').trim();
      var rawCName = String(s.CustomerName || 'ลูกค้าขาจรทั่วไป').trim();

      if ((rawCid === 'WALK-IN' || !custMap[rawCid]) && nameToCustId[rawCName.toLowerCase()]) {
        rawCid = nameToCustId[rawCName.toLowerCase()];
      }

      var isWalkIn = (rawCid === 'WALK-IN' || rawCid === '' || !custMap[rawCid]);
      var stdWalkInName = isWalkIn ? normalizeWalkInName_(rawCName) : rawCName;
      var debtKey = isWalkIn ? ('WALK-IN::' + stdWalkInName) : rawCid;

      var cInfo = (!isWalkIn && custMap[rawCid]) ? custMap[rawCid] : {
        CustomerID: debtKey,
        CustomerName: '🚶 ' + stdWalkInName,
        Phone: '',
        RouteID: s.RouteID || 'หน้าลาน',
        RouteName: routeMap[s.RouteID] || s.RouteID || 'หน้าลาน',
        CreditLimit: 0
      };

      if (!debtByCust[debtKey]) {
        debtByCust[debtKey] = {
          CustomerID: debtKey,
          RawCustomerID: rawCid,
          CustomerName: cInfo.CustomerName,
          Phone: cInfo.Phone,
          RouteID: cInfo.RouteID,
          RouteName: cInfo.RouteName,
          CreditLimit: cInfo.CreditLimit,
          IsWalkIn: isWalkIn,
          TotalDebt: 0,
          MaxOverdueDays: 0,
          OldestBillDate: '',
          AgingTier: 'NORMAL',
          Bills: []
        };
      }

      var amt = parseFloat(s.TotalAmount) || 0;
      var sDateStr = String(s.SaleDate || '').slice(0, 10);
      var billDays = 0;
      if (sDateStr) {
        var dp = sDateStr.split('-');
        if (dp.length === 3) {
          var bTime = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10)).getTime();
          if (!isNaN(bTime)) billDays = Math.max(0, Math.round((todayMidnight - bTime) / (1000 * 60 * 60 * 24)));
        }
      }

      s.OverdueDays = billDays;
      s.ItemSummary = (itemSummaryBySale[s.SaleID] || []).join(', ') || 'บิลค้างชำระ';

      var entry = debtByCust[debtKey];
      entry.TotalDebt += amt;
      if (billDays >= entry.MaxOverdueDays) {
        entry.MaxOverdueDays = billDays;
      }
      if (!entry.OldestBillDate || (sDateStr && sDateStr < entry.OldestBillDate)) {
        entry.OldestBillDate = sDateStr;
      }
      entry.Bills.push(s);

      totalOutstanding += amt;
      totalUnpaidBills++;
    }
  });

  var debtList = Object.keys(debtByCust).map(function(k) {
    var d = debtByCust[k];
    if (d.CreditLimit > 0 && d.TotalDebt > d.CreditLimit) overLimitCount++;

    if (d.MaxOverdueDays > 30) {
      d.AgingTier = 'CRIT';
      agingStats.critOver30++;
      agingStats.critOver30Amt += d.TotalDebt;
    } else if (d.MaxOverdueDays >= 16) {
      d.AgingTier = 'LATE';
      agingStats.late16to30++;
    } else if (d.MaxOverdueDays >= 8) {
      d.AgingTier = 'WARN';
      agingStats.warn8to15++;
    } else {
      d.AgingTier = 'NORMAL';
      agingStats.normal0to7++;
    }

    d.Bills.sort(function(a, b) {
      return String(a.SaleDate || '').localeCompare(String(b.SaleDate || ''));
    });
    return d;
  }).sort(function(a, b) {
    if (b.TotalDebt !== a.TotalDebt) return b.TotalDebt - a.TotalDebt;
    return b.MaxOverdueDays - a.MaxOverdueDays;
  });

  return {
    summary: {
      totalOutstanding: totalOutstanding,
      debtorCount: debtList.length,
      totalUnpaidBills: totalUnpaidBills,
      overLimitCount: overLimitCount,
      agingStats: agingStats
    },
    debtList: debtList,
    customers: customers,
    routes: routes,
    recentPayments: payments.reverse().slice(0, 40)
  };
}

function api_savePayment(payload) {
  return withSheetLock_(function() {
    var saleIds = payload.SaleIDs || [];
    if (!Array.isArray(saleIds) || saleIds.length === 0) {
      throw new Error('กรุณาติ๊กเลือกบิลที่ต้องการรับชำระอย่างน้อย 1 บิล');
    }

    var amountPaid = parseFloat(payload.AmountPaid) || 0;
    if (amountPaid <= 0) {
      throw new Error('กรุณาระบุยอดเงินที่รับชำระให้มากกว่า 0 บาท');
    }

    var createdBy = String(payload.CreatedBy || 'Admin');
    if (createdBy.indexOf('คนขับ:') === 0 && typeof assertRouteShiftActive_ === 'function') {
      var drvName = createdBy.replace('คนขับ:', '').trim();
      assertRouteShiftActive_('', drvName);
    }

    var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
    var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
    var salesSheet = getOrCreateSheet('tb_Sales', salesHeaders);
    var detailSheet = getOrCreateSheet('tb_SalesDetails', detailHeaders);
    var sData = salesSheet.getDataRange().getValues();

    var targetSet = {};
    saleIds.forEach(function(id) { targetSet[String(id).trim()] = true; });

    var clearedCount = 0;
    var sumSelectedBillsAmt = 0;
    var sampleCustId = '';
    var sampleCustName = '';
    var sampleRouteId = 'หน้าลาน';

    for (var i = 1; i < sData.length; i++) {
      var sid = String(sData[i][0]).trim();
      if (targetSet[sid]) {
        var bStatus = String(sData[i][7] || '');
        if (bStatus !== 'Paid' && bStatus !== 'Cancelled' && bStatus !== 'ยกเลิก') {
          sumSelectedBillsAmt += (parseFloat(sData[i][5]) || 0);
          sampleCustId = String(sData[i][2] || 'WALK-IN').trim();
          sampleCustName = String(sData[i][3] || '').trim();
          sampleRouteId = String(sData[i][4] || 'หน้าลาน').trim();
          salesSheet.getRange(i + 1, 8).setValue('Paid');
          clearedCount++;
        }
      }
    }

    if (clearedCount === 0) {
      throw new Error('บิลที่เลือกถูกรับชำระหรือยกเลิกไปแล้วค่ะ');
    }

    var now = new Date();
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var rawCid = String(payload.CustomerID || sampleCustId || 'WALK-IN').trim();
    var cleanCid = rawCid.indexOf('WALK-IN::') === 0 ? 'WALK-IN' : rawCid;
    var cleanCName = String(payload.CustomerName || sampleCustName || '').replace(/🚶/g, '').trim() || 'ลูกค้า';

    // กรณีลูกค้าแบ่งจ่ายบางส่วน (Partial Payment) สร้างบิลหนี้คงเหลืออัตโนมัติ
    var remainingBalance = sumSelectedBillsAmt - amountPaid;
    var balanceSaleId = '';
    if (remainingBalance > 0) {
      balanceSaleId = generateId(salesSheet, 'AR-' + datePrefix, 4);
      var balSummary = 'ยอดค้างคงเหลือจากการแบ่งจ่ายบิล (' + saleIds.join(', ') + ' ยอดเต็ม ฿' + sumSelectedBillsAmt + ' จ่ายแล้ว ฿' + amountPaid + ')';

      salesSheet.appendRow([
        balanceSaleId,
        now,
        cleanCid,
        cleanCName,
        sampleRouteId,
        remainingBalance,
        'เครดิต (ยอดค้างแบ่งจ่าย)',
        'Unpaid',
        createdBy
      ]);

      detailSheet.appendRow([
        balanceSaleId + '-1',
        balanceSaleId,
        'AR-MANUAL',
        balSummary,
        1,
        remainingBalance,
        remainingBalance
      ]);
    }

    var payHeaders = ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note'];
    var paySheet = getOrCreateSheet('tb_Payments', payHeaders);
    var payId = generateId(paySheet, 'PAY-' + datePrefix, 4);

    var payNote = String(payload.Note || '').trim();
    if (remainingBalance > 0) {
      payNote = (payNote ? payNote + ' | ' : '') + 'แบ่งจ่ายบางส่วน (ตั้งหนี้คงเหลือ ฿' + remainingBalance + ' ในบิล ' + balanceSaleId + ')';
    }

    paySheet.appendRow([
      payId,
      now,
      cleanCid,
      cleanCName,
      saleIds.join(', '),
      amountPaid,
      payload.PaymentMethod || 'เงินสด',
      createdBy,
      payNote
    ]);

    SpreadsheetApp.flush();
    writeLog('SAVE_PAYMENT', payId + ' รับชำระหนี้ ' + cleanCName + ' ฿' + amountPaid + (remainingBalance > 0 ? ' (เหลือค้าง ฿' + remainingBalance + ' -> ' + balanceSaleId + ')' : ''), 'SUCCESS');
    return {
      PaymentID: payId,
      PaymentDate: Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd HH:mm'),
      CustomerName: cleanCName,
      RefSaleIDs: saleIds.join(', '),
      PaymentMethod: payload.PaymentMethod || 'เงินสด',
      ClearedBills: clearedCount,
      AmountPaid: amountPaid,
      RemainingBalance: Math.max(0, remainingBalance),
      BalanceSaleID: balanceSaleId,
      CreatedBy: createdBy
    };
  });
}

function api_cancelPayment(payload) {
  return withSheetLock_(function() {
    var payId = payload && payload.PaymentID ? String(payload.PaymentID).trim() : '';
    if (!payId) throw new Error('ไม่พบรหัสใบรับชำระหนี้ที่ต้องการยกเลิก');

    var payHeaders = ['PaymentID', 'PaymentDate', 'CustomerID', 'CustomerName', 'RefSaleIDs', 'AmountPaid', 'PaymentMethod', 'CreatedBy', 'Note'];
    var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
    var paySheet = getOrCreateSheet('tb_Payments', payHeaders);
    var salesSheet = getOrCreateSheet('tb_Sales', salesHeaders);

    var pData = paySheet.getDataRange().getValues();
    var foundPayRow = -1;
    var refIdsStr = '';
    var oldNote = '';
    var custName = '';
    var amtPaid = 0;

    for (var i = 1; i < pData.length; i++) {
      if (String(pData[i][0]).trim() === payId) {
        oldNote = String(pData[i][8] || '');
        foundPayRow = i + 1;
        custName = String(pData[i][3] || '');
        refIdsStr = String(pData[i][4] || '');
        amtPaid = parseFloat(pData[i][5]) || 0;
        break;
      }
    }
    if (foundPayRow === -1) throw new Error('ไม่พบรหัสใบรับชำระ: ' + payId);

    paySheet.deleteRow(foundPayRow);

    var refSet = {};
    refIdsStr.split(',').forEach(function(id) {
      var clean = String(id).trim();
      if (clean) refSet[clean] = true;
    });

    var balMatch = oldNote.match(/AR-\d{8}-\d+/);
    var balSaleIdToCancel = balMatch ? balMatch[0] : '';

    var sData = salesSheet.getDataRange().getValues();
    for (var j = 1; j < sData.length; j++) {
      var sid = String(sData[j][0]).trim();
      if (refSet[sid]) {
        salesSheet.getRange(j + 1, 8).setValue('Unpaid');
      } else if (balSaleIdToCancel && sid === balSaleIdToCancel) {
        salesSheet.getRange(j + 1, 8).setValue('Cancelled');
      }
    }

    SpreadsheetApp.flush();
    writeLog('CANCEL_PAYMENT', payId + ' (' + custName + ' ฿' + amtPaid + ') ดึงบิลกลับมาค้างชำระ: ' + refIdsStr, 'WARNING');
    return { PaymentID: payId, ReopenedBills: refIdsStr };
  });
}

function api_addManualCreditBill(payload) {
  return withSheetLock_(function() {
    var rawInput = payload && (payload.CustomerInput || payload.CustomerName || payload.CustomerID) ? String(payload.CustomerInput || payload.CustomerName || payload.CustomerID).trim() : '';
    var amt = parseFloat(payload.Amount) || 0;
    if (!rawInput) throw new Error('กรุณาเลือกร้านค้า หรือ พิมพ์ชื่อร้านลูกหนี้');
    if (amt <= 0) throw new Error('กรุณาระบุจำนวนเงินค้างชำระให้มากกว่า 0 บาท');

    var routeId = payload.RouteID ? String(payload.RouteID).trim() : 'หน้าลาน';
    var custId = '';
    var custName = '';

    if (rawInput.indexOf(' : ') !== -1) {
      var parts = rawInput.split(' : ');
      custId = parts[0].trim();
      custName = parts.slice(1).join(' : ').trim();
    } else {
      var allCusts = api_getCustomers();
      var found = allCusts.find(function(c) {
        return String(c.CustomerID).trim().toLowerCase() === rawInput.toLowerCase() ||
               String(c.CustomerName).trim().toLowerCase() === rawInput.toLowerCase();
      });

      if (found) {
        custId = found.CustomerID;
        custName = found.CustomerName;
        if (!payload.RouteID && found.RouteID) routeId = found.RouteID;
      } else if (/^ขาจร/i.test(rawInput)) {
        custId = 'WALK-IN';
        custName = normalizeWalkInName_(rawInput);
      } else {
        var custHeaders = ['CustomerID', 'CustomerName', 'Phone', 'CustomerType', 'RouteID', 'CreditLimit', 'Status', 'CreatedAt'];
        var custSheet = getOrCreateSheet('tb_Customers', custHeaders);
        custId = generateId(custSheet, 'C', 4);
        custName = rawInput;
        custSheet.appendRow([custId, custName, '', 'ร้านประจำ', routeId, 0, 'Active', new Date()]);
      }
    }

    var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
    var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
    var salesSheet = getOrCreateSheet('tb_Sales', salesHeaders);
    var detailSheet = getOrCreateSheet('tb_SalesDetails', detailHeaders);

    var now = new Date();
    var dateStr = payload.SaleDate || payload.BillDate || '';
    var billDate = dateStr ? new Date(dateStr + 'T08:00:00') : now;
    if (isNaN(billDate.getTime())) billDate = now;

    var datePrefix = Utilities.formatDate(billDate, 'GMT+7', 'yyyyMMdd');
    var saleId = generateId(salesSheet, 'AR-' + datePrefix, 4);
    var summaryText = String(payload.Description || payload.ItemSummary || payload.Note || 'ยอดหนี้คงค้างยกมา').trim();

    salesSheet.appendRow([
      saleId,
      billDate,
      custId,
      custName,
      routeId,
      amt,
      'เครดิต (ยอดยกมา)',
      'Unpaid',
      payload.CreatedBy || 'Admin'
    ]);

    detailSheet.appendRow([
      saleId + '-1',
      saleId,
      'AR-MANUAL',
      summaryText,
      1,
      amt,
      amt
    ]);

    SpreadsheetApp.flush();
    writeLog('MANUAL_DEBT', saleId + ' ตั้งหนี้ยกมา ' + custName + ' (' + custId + ') ฿' + amt, 'SUCCESS');
    return { SaleID: saleId, CustomerID: custId, CustomerName: custName };
  });
}

function api_saveManualDebt(payload) {
  return api_addManualCreditBill(payload);
}

// ==========================================
// 🪣 2. SMART BUCKET TRACKING, ROI RADAR & MASTER REGISTRY
// ==========================================
function normalizeBucketsData_(rawBuckets) {
  return (rawBuckets || []).filter(function(b) {
    return String(b.Status || '').trim().toLowerCase() !== 'inactive';
  }).map(function(b) {
    var st = String(b.CurrentStatus || '').trim();
    var stLower = st.toLowerCase();
    var loc = String(b.CurrentLocation || '').trim();
    var isFactoryLoc = (!loc || loc === 'โรงงานแม่ใจ' || loc === 'โรงงานน้ำแข็งแม่ใจ' || loc === 'ในคลัง' || loc === '-');

    if (st === 'ถูกยืม' || stLower === 'borrowed' || stLower === 'out' || (!isFactoryLoc && st !== 'ส่งซ่อม' && st !== 'ชำรุด')) {
      b.CurrentStatus = 'ถูกยืม';
    } else if (st === 'ส่งซ่อม' || st === 'ชำรุด' || stLower === 'maintenance') {
      b.CurrentStatus = 'ส่งซ่อม';
    } else {
      b.CurrentStatus = 'ในคลัง';
      if (!loc) b.CurrentLocation = 'โรงงานแม่ใจ';
    }

    var bType = String(b.BucketType || '').trim();
    var lType = String(b.LoanType || bType || '').trim();
    b.BucketType = (bType.indexOf('งาน') !== -1 || bType.indexOf('อีเวนต์') !== -1 || bType.indexOf('ชั่วคราว') !== -1) ? 'ถังยืมงาน' : 'ถังยืมร้าน';
    b.LoanType = (lType.indexOf('งาน') !== -1 || lType.indexOf('อีเวนต์') !== -1 || lType.indexOf('ชั่วคราว') !== -1) ? 'ถังยืมงาน' : 'ถังยืมร้าน';
    return b;
  });
}

function api_getBucketDashboard() {
  var bucketHeaders = ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate'];
  var logHeaders = ['LogID', 'LogDate', 'ActionType', 'BucketType', 'CustomerID', 'CustomerName', 'SerialNumbers', 'TotalQty', 'Note', 'CreatedBy'];
  var salesHeaders = ['SaleID', 'SaleDate', 'CustomerID', 'CustomerName', 'RouteID', 'TotalAmount', 'PaymentType', 'PaymentStatus', 'CreatedBy'];
  var detailHeaders = ['DetailID', 'SaleID', 'ProductID', 'ProductName', 'Quantity', 'UnitPrice', 'SubTotal'];
  var routeHeaders = ['RouteID', 'RouteName', 'Description', 'Status', 'CreatedAt'];
  var empHeaders = ['EmpID', 'EmpName', 'Phone', 'Position', 'PIN', 'Status', 'CreatedAt'];

  var bSheet = getOrCreateSheet('tb_Buckets', bucketHeaders);
  if (bSheet.getLastRow() <= 1) {
    var nowInit = new Date();
    bSheet.getRange(2, 1, 6, 11).setValues([
      ['B-0001', '6023', '200L', 'ถังยืมร้าน', 'ในคลัง', 'โรงงานแม่ใจ', 'สภาพดี', 'Active', nowInit, '', ''],
      ['B-0002', '6601', '200L', 'ถังยืมร้าน', 'ถูกยืม', 'ตั๊กน้ำปั่น', '', 'Active', nowInit, 'ถังยืมร้าน', nowInit],
      ['B-0003', '6813', '200L', 'ถังยืมร้าน', 'ถูกยืม', 'ตั๊กน้ำปั่น', '', 'Active', nowInit, 'ถังยืมร้าน', nowInit],
      ['B-0004', '6608', '200L', 'ถังยืมร้าน', 'ถูกยืม', 'ครัวฮิมหนอง', '', 'Active', nowInit, 'ถังยืมร้าน', nowInit],
      ['B-0005', '6713', '300L', 'ถังยืมงาน', 'ในคลัง', 'โรงงานแม่ใจ', '', 'Active', nowInit, '', ''],
      ['B-0006', '6817', '450L', 'ถังยืมร้าน', 'ในคลัง', 'โรงงานแม่ใจ', '', 'Active', nowInit, '', '']
    ]);
  }
  getOrCreateSheet('tb_BucketLogs', logHeaders);

  var cleanBuckets = normalizeBucketsData_(getSheetDataAsObjects('tb_Buckets', bucketHeaders));
  var customers = api_getCustomers();
  var routes = getSheetDataAsObjects('tb_Routes', routeHeaders).filter(function(r) { return r.Status !== 'Inactive'; });
  var employees = getSheetDataAsObjects('tb_Employees', empHeaders).filter(function(e) { return e.Status !== 'Inactive'; });
  var sales = getSheetDataAsObjects('tb_Sales', salesHeaders);
  var saleDetails = getSheetDataAsObjects('tb_SalesDetails', detailHeaders);

  var routeNameMap = { 'หน้าลาน': '🏠 หน้าลาน (หน้าร้าน)' };
  routes.forEach(function(r) {
    if (r.RouteID) routeNameMap[String(r.RouteID).trim()] = r.RouteName;
    if (r.RouteName) routeNameMap[String(r.RouteName).trim()] = r.RouteName;
  });

  var custByNameMap = {};
  var custByIdMap = {};
  customers.forEach(function(c) {
    var cNameKey = String(c.CustomerName || '').trim().toLowerCase();
    var cIdKey = String(c.CustomerID || '').trim();
    var rName = routeNameMap[c.RouteID] || c.RouteID || 'หน้าลาน';
    var info = {
      CustomerID: cIdKey,
      CustomerName: c.CustomerName,
      Phone: c.Phone || '',
      RouteID: c.RouteID || 'หน้าลาน',
      RouteName: rName
    };
    if (cNameKey) custByNameMap[cNameKey] = info;
    if (cIdKey) custByIdMap[cIdKey] = info;
  });

  var qtyBySaleId = {};
  saleDetails.forEach(function(d) {
    if (isStockProductId_(d.ProductID)) {
      qtyBySaleId[d.SaleID] = (qtyBySaleId[d.SaleID] || 0) + (parseFloat(d.Quantity) || 0);
    }
  });

  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');
  var tParts = todayStr.split('-');
  var todayMidnight = new Date(parseInt(tParts[0], 10), parseInt(tParts[1], 10) - 1, parseInt(tParts[2], 10)).getTime();
  var cutoff30DaysStr = Utilities.formatDate(new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)), 'GMT+7', 'yyyy-MM-dd');

  var holderSalesStatMap = {};
  sales.forEach(function(s) {
    var st = String(s.PaymentStatus || '').trim().toLowerCase();
    if (st === 'cancelled' || st === 'ยกเลิก') return;
    if (String(s.SaleID || '').indexOf('AR-') === 0) return;

    var sDateStr = String(s.SaleDate || '').slice(0, 10);
    if (!sDateStr) return;

    var cid = String(s.CustomerID || '').trim();
    var cName = String(s.CustomerName || '').replace(/🚶/g, '').replace(/^ขาจร\s*:\s*/i, '').trim();
    if (custByIdMap[cid]) cName = custByIdMap[cid].CustomerName;

    var nameKey = cName.toLowerCase();
    if (!nameKey) return;

    if (!holderSalesStatMap[nameKey]) {
      holderSalesStatMap[nameKey] = { lastSaleDate: '', last30DaysQty: 0, last30DaysAmt: 0 };
    }
    if (sDateStr >= holderSalesStatMap[nameKey].lastSaleDate) {
      holderSalesStatMap[nameKey].lastSaleDate = sDateStr;
    }
    if (sDateStr >= cutoff30DaysStr) {
      holderSalesStatMap[nameKey].last30DaysQty += (qtyBySaleId[s.SaleID] || 0);
      holderSalesStatMap[nameKey].last30DaysAmt += (parseFloat(s.TotalAmount) || 0);
    }
  });

  cleanBuckets.forEach(function(b) {
    var holderRaw = String(b.CurrentLocation || '').trim();
    var holderKey = holderRaw.toLowerCase();
    var cInfo = custByNameMap[holderKey] || null;
    var sStat = holderSalesStatMap[holderKey] || null;

    b.HolderCustomerID = cInfo ? cInfo.CustomerID : '';
    b.HolderPhone = cInfo ? cInfo.Phone : '';
    b.HolderRouteID = cInfo ? cInfo.RouteID : 'งานนอก/ทั่วไป';
    b.HolderRouteName = cInfo ? cInfo.RouteName : '🎪 งานนอก / ขาจร';
    b.LastSaleDate = sStat ? sStat.lastSaleDate : '';
    b.Last30DaysQty = sStat ? sStat.last30DaysQty : 0;
    b.DaysSinceLastSale = null;

    if (sStat && sStat.lastSaleDate) {
      var dp = sStat.lastSaleDate.split('-');
      if (dp.length === 3) {
        var lastTime = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10)).getTime();
        b.DaysSinceLastSale = Math.max(0, Math.round((todayMidnight - lastTime) / (1000 * 60 * 60 * 24)));
      }
    }

    var borrowDays = 0;
    if (b.BorrowDate) {
      var bDateStr = String(b.BorrowDate).slice(0, 10);
      var bp = bDateStr.split('-');
      if (bp.length === 3) {
        var bTime = new Date(parseInt(bp[0], 10), parseInt(bp[1], 10) - 1, parseInt(bp[2], 10)).getTime();
        if (!isNaN(bTime)) borrowDays = Math.max(0, Math.round((todayMidnight - bTime) / (1000 * 60 * 60 * 24)));
      }
    }
    b.BorrowDays = borrowDays;
  });

  return {
    allBuckets: cleanBuckets,
    customers: customers,
    routes: routes,
    employees: employees,
    recentLogs: getSheetDataAsObjects('tb_BucketLogs', logHeaders).reverse().slice(0, 50)
  };
}

function api_saveBucketTransaction(payload) {
  return withSheetLock_(function() {
    var mode = payload && payload.mode ? String(payload.mode).toUpperCase().trim() : 'OUT';
    var serials = payload.Serials || [];
    if (!Array.isArray(serials) || serials.length === 0) {
      throw new Error('กรุณาติ๊กเลือกรหัสถัง (Serial Number) อย่างน้อย 1 ใบค่ะ');
    }
    if ((mode === 'OUT' || mode === 'TRANSFER') && (!payload.CustomerName || String(payload.CustomerName).trim() === '')) {
      throw new Error('กรุณาระบุชื่อร้านค้า หรือ ชื่องานอีเวนต์ผู้ยืมถังค่ะ');
    }

    var bucketHeaders = ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate'];
    var bSheet = getOrCreateSheet('tb_Buckets', bucketHeaders);
    var lastRow = bSheet.getLastRow();
    if (lastRow <= 1) throw new Error('ไม่พบข้อมูลถังในระบบ');

    var range = bSheet.getRange(2, 1, lastRow - 1, 11);
    var data = range.getValues();
    var now = new Date();
    var serialSet = {};
    serials.forEach(function(s) { serialSet[String(s).trim()] = true; });

    var updatedCount = 0;
    var holderName = String(payload.CustomerName || '').trim();
    var loanType = payload.LoanType || 'ถังยืมร้าน';
    var returnCondition = String(payload.ReturnCondition || 'ในคลัง').trim();
    var contactNote = String(payload.Note || '').trim();
    var driverOrStaff = String(payload.DriverName || payload.CreatedBy || 'Admin').trim();
    var fullNote = (driverOrStaff ? '[ผู้ทำรายการ: ' + driverOrStaff + '] ' : '') + contactNote;

    var previousHolders = [];

    for (var i = 0; i < data.length; i++) {
      var sn = String(data[i][1]).trim();
      if (serialSet[sn]) {
        if (mode === 'OUT' || mode === 'TRANSFER') {
          if (mode === 'TRANSFER' && data[i][5] && previousHolders.indexOf(String(data[i][5])) === -1) {
            previousHolders.push(String(data[i][5]));
          }
          data[i][3] = loanType;
          data[i][4] = 'ถูกยืม';
          data[i][5] = holderName;
          data[i][6] = fullNote;
          data[i][9] = loanType;
          data[i][10] = now;
        } else {
          if (!holderName && data[i][5]) holderName = String(data[i][5]);
          if (returnCondition === 'ส่งซ่อม') {
            data[i][4] = 'ส่งซ่อม';
            data[i][5] = 'โรงงานแม่ใจ (รอซ่อม)';
            data[i][6] = fullNote || 'รับคืนสภาพชำรุด/รอซ่อม';
          } else {
            data[i][4] = 'ในคลัง';
            data[i][5] = 'โรงงานแม่ใจ';
            data[i][6] = contactNote ? contactNote : 'สภาพดี';
          }
          data[i][9] = '';
          data[i][10] = '';
        }
        updatedCount++;
      }
    }

    if (updatedCount === 0) throw new Error('ไม่พบรหัสถังที่เลือกในฐานข้อมูล');
    range.setValues(data);

    var logHeaders = ['LogID', 'LogDate', 'ActionType', 'BucketType', 'CustomerID', 'CustomerName', 'SerialNumbers', 'TotalQty', 'Note', 'CreatedBy'];
    var logSheet = getOrCreateSheet('tb_BucketLogs', logHeaders);
    var datePrefix = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
    var logId = generateId(logSheet, 'BKL-' + datePrefix, 4);

    var actionLabel = mode === 'OUT' ? 'ยืมถังออก'
      : (mode === 'TRANSFER' ? 'โอนย้ายถัง (' + (previousHolders.join(',') || 'เดิม') + ' ➔ ' + holderName + ')'
      : (returnCondition === 'ส่งซ่อม' ? 'รับคืนถังชำรุด (ส่งซ่อม)' : 'คืนเข้าคลัง'));

    logSheet.appendRow([
      logId,
      now,
      actionLabel,
      loanType,
      payload.CustomerID || (loanType === 'ถังยืมงาน' ? 'EVENT' : 'SHOP'),
      holderName || 'รับคืนหน้าลาน',
      serials.join(', '),
      updatedCount,
      fullNote,
      driverOrStaff
    ]);

    SpreadsheetApp.flush();
    writeLog('BUCKET_' + mode, logId + ' | ' + actionLabel + ' | ' + holderName + ' (' + serials.join(',') + ')', 'SUCCESS');
    return {
      LogID: logId,
      LogDate: Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd HH:mm'),
      ActionType: actionLabel,
      BucketType: loanType,
      CustomerName: holderName || 'รับคืนหน้าลาน',
      SerialNumbers: serials.join(', '),
      TotalQty: updatedCount,
      Note: fullNote,
      CreatedBy: driverOrStaff
    };
  });
}

function api_getBucketsList() {
  var headers = ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate'];
  getOrCreateSheet('tb_Buckets', headers);
  var buckets = normalizeBucketsData_(getSheetDataAsObjects('tb_Buckets', headers)).reverse();
  var summary = { total: 0, inStock: 0, borrowed: 0, maintenance: 0 };

  buckets.forEach(function(b) {
    summary.total++;
    if (b.CurrentStatus === 'ในคลัง') summary.inStock++;
    else if (b.CurrentStatus === 'ถูกยืม') summary.borrowed++;
    else summary.maintenance++;
  });

  return { buckets: buckets, summary: summary, customers: api_getCustomers() };
}

function api_saveBucketRecord(payload) {
  return withSheetLock_(function() {
    var headers = ['BucketID', 'SerialNumber', 'Capacity', 'BucketType', 'CurrentStatus', 'CurrentLocation', 'Note', 'Status', 'CreatedAt', 'LoanType', 'BorrowDate'];
    var sheet = getOrCreateSheet('tb_Buckets', headers);
    var data = sheet.getDataRange().getValues();
    var now = new Date();

    if (payload.BucketID && payload.BucketID !== '') {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.BucketID)) {
          var isBorrowed = payload.CurrentStatus === 'ถูกยืม';
          var loanType = isBorrowed ? (data[i][9] || payload.BucketType) : '';
          var borrowDate = isBorrowed ? (data[i][10] || now) : '';
          var loc = payload.CurrentStatus === 'ในคลัง' ? 'โรงงานแม่ใจ' : (payload.CurrentLocation || 'ไม่ระบุ');

          sheet.getRange(i + 1, 2, 1, 6).setValues([[
            payload.SerialNumber, payload.Capacity, payload.BucketType, payload.CurrentStatus, loc, payload.Note || ''
          ]]);
          sheet.getRange(i + 1, 10, 1, 2).setValues([[loanType, borrowDate]]);
          SpreadsheetApp.flush();
          return { BucketID: payload.BucketID };
        }
      }
      throw new Error('ไม่พบข้อมูลถังรหัสนี้');
    } else {
      for (var j = 1; j < data.length; j++) {
        if (String(data[j][1]).trim() === String(payload.SerialNumber).trim() && String(data[j][7]) !== 'Inactive') {
          throw new Error('รหัสถัง (Serial) ' + payload.SerialNumber + ' มีอยู่ในระบบแล้ว');
        }
      }
      var newId = generateId(sheet, 'B', 4);
      var isNewBorrowed = payload.CurrentStatus === 'ถูกยืม';
      sheet.appendRow([
        newId,
        payload.SerialNumber,
        payload.Capacity || '200L',
        payload.BucketType || 'ถังยืมร้าน',
        payload.CurrentStatus || 'ในคลัง',
        payload.CurrentStatus === 'ในคลัง' ? 'โรงงานแม่ใจ' : (payload.CurrentLocation || 'โรงงานแม่ใจ'),
        payload.Note || '',
        'Active',
        now,
        isNewBorrowed ? (payload.BucketType || 'ถังยืมร้าน') : '',
        isNewBorrowed ? now : ''
      ]);
      SpreadsheetApp.flush();
      return { BucketID: newId };
    }
  });
}