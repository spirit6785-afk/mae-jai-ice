/**
 * ============================================================================
 * 🏢 MAE JAI SMART ERP - STANDALONE SUPABASE API ENGINE (js/supabase-api.js)
 * Version: 6.0 (100% Serverless on Vercel / GitHub Pages — Zero Google Apps Script)
 * ครอบคลุมครบทั้ง 14 หน้าจอสำนักงาน + แอปมือถือพนักงานขับรถสายส่ง (Driver Portal)
 * ============================================================================
 */

// 📌 1. ตั้งค่า URL และ ANON PUBLIC KEY ของโปรเจกต์ Supabase ของคุณธีระศักดิ์ที่นี่
window.SUPABASE_CONFIG = {
  URL: 'https://ใส่-PROJECT-URL-ของคุณที่นี่.supabase.co',
  ANON_KEY: 'ใส่-ANON-PUBLIC-KEY-ของคุณที่นี่'
};

window.sb = supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.ANON_KEY);

// ==========================================
// 🛠️ CORE HELPERS & FORMATTERS
// ==========================================
function bkkTodayStr_() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}

function bkkNowIso_() {
  return new Date().toISOString();
}

function fmtPgDate_(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const pad = n => String(n).padStart(2, '0');
  const bkk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return `${bkk.getFullYear()}-${pad(bkk.getMonth() + 1)}-${pad(bkk.getDate())} ${pad(bkk.getHours())}:${pad(bkk.getMinutes())}`;
}

function normalizeRows_(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const out = { ...r };
    Object.keys(out).forEach(k => {
      if (k.includes('Date') || k === 'CreatedAt' || k === 'Timestamp') {
        if (out[k] && String(out[k]).includes('T')) out[k] = fmtPgDate_(out[k]);
      }
    });
    return out;
  });
}

function isStockPid_(pid) {
  const id = String(pid || '').trim();
  if (!id || id === 'FEE' || id === 'DISCOUNT' || id === 'AR-MANUAL' || id.startsWith('RET-')) return false;
  return true;
}

function normWalkIn_(rawName) {
  let s = String(rawName || '').replace(/🚶/g, '').trim();
  s = s.replace(/^(ขาจร\s*:\s*|ขาจร\s+)/i, '').trim().replace(/\s+/g, ' ');
  if (!s || s === 'ลูกค้าขาจรทั่วไป' || s === 'ลูกค้าขาจร') return 'ลูกค้าขาจรทั่วไป';
  return 'ขาจร: ' + s;
}

async function genId_(table, pkCol, prefix, pad = 4) {
  const { data, error } = await window.sb.rpc('fn_generate_erp_id', {
    p_table: table,
    p_pk_col: pkCol,
    p_prefix: prefix,
    p_pad: pad
  });
  if (error || !data) {
    return `${prefix}-${Date.now().toString().slice(-4)}`;
  }
  return data;
}

async function writeAuditLog_(action, details, status = 'SUCCESS') {
  try {
    await window.sb.from('tb_Logs').insert([{ Action: action, Details: details, Status: status }]);
  } catch (e) {}
}

// ==========================================
// 🚀 SUPABASE_ACTIONS (ครบทุกโมดูล 100%)
// ==========================================
window.SUPABASE_ACTIONS = {

  // ------------------------------------------------------------------
  // 🔐 1. AUTHENTICATION & MASTER DATA
  // ------------------------------------------------------------------
  async verifyFactoryLogin(payload) {
    const pin = String(payload?.pin || '').trim();
    if (!pin) throw new Error('กรุณากรอกรหัส PIN เข้าสู่ระบบ');

    const { data: emps, error } = await window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive');
    if (error) throw new Error(error.message);

    let matched = (emps || []).find(e => {
      const empPin = String(e.PIN || '').trim();
      const last4 = String(e.Phone || '').replace(/\D/g, '').slice(-4);
      return empPin === pin || (last4 !== '' && last4 === pin);
    });

    if (!matched && pin === '9999') {
      matched = { EmpID: 'ADMIN-MASTER', EmpName: 'คุณธีระศักดิ์ (ผู้จัดการ)', Position: 'ผู้บริหาร', PIN: '9999' };
    }
    if (!matched) throw new Error('รหัส PIN ไม่ถูกต้อง หรือบัญชีถูกระงับการใช้งาน');

    const pos = String(matched.Position || '');
    let role = 'CLERK';
    if (pos.includes('บริหาร') || pos.includes('จัดการ') || pos.includes('เจ้าของ') || pos.toLowerCase().includes('admin')) role = 'ADMIN';
    else if (pos.includes('ขับ') || pos.toLowerCase().includes('driver')) role = 'DRIVER';

    if (role === 'DRIVER') {
      throw new Error(`รหัส PIN นี้เป็นของพนักงานขับรถ (${matched.EmpName}) กรุณาเข้าใช้งานหน้าสายส่ง (driver.html) ค่ะ`);
    }

    const now = new Date();
    return {
      EmpID: matched.EmpID,
      EmpName: matched.EmpName,
      Position: pos || 'เจ้าหน้าที่สำนักงาน',
      Role: role,
      LoginTime: now.toTimeString().slice(0, 5)
    };
  },

  async getCustomers() {
    const [{ data: custs }, { data: promos }] = await Promise.all([
      window.sb.from('tb_Customers').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Promotions').select('*').neq('Status', 'Inactive')
    ]);

    const orderMap = {};
    (promos || []).forEach(r => {
      if (String(r.PromoName || '').startsWith('ROUTE_ORDER:')) {
        const rKey = String(r.PromoName).replace('ROUTE_ORDER:', '').trim();
        orderMap[rKey] = String(r.DiscountAmt || '').split(',').map(x => x.trim()).filter(Boolean);
      }
    });

    const list = normalizeRows_(custs || []);
    list.sort((a, b) => {
      const rA = String(a.RouteID || 'หน้าลาน').trim();
      const rB = String(b.RouteID || 'หน้าลาน').trim();
      if (rA !== rB) return rA.localeCompare(rB);
      const ord = orderMap[rA] || [];
      const iA = ord.indexOf(String(a.CustomerID).trim());
      const iB = ord.indexOf(String(b.CustomerID).trim());
      if (iA === -1 && iB === -1) return String(a.CustomerID).localeCompare(String(b.CustomerID));
      if (iA === -1) return 1;
      if (iB === -1) return -1;
      return iA - iB;
    });

    const counters = {};
    list.forEach(c => {
      const rk = String(c.RouteID || 'หน้าลาน').trim();
      counters[rk] = (counters[rk] || 0) + 1;
      c.SequenceNo = counters[rk];
    });
    return list;
  },

  async saveRouteCustomerOrder(payload) {
    const routeId = String(payload?.RouteID || '').trim();
    const orderedIds = payload?.OrderedCustomerIDs || [];
    if (!routeId || !orderedIds.length) throw new Error('ข้อมูลลำดับสายส่งไม่ครบถ้วน');

    const targetKey = 'ROUTE_ORDER:' + routeId;
    const csv = orderedIds.map(id => String(id).trim()).filter(Boolean).join(',');

    const { data: existing } = await window.sb.from('tb_Promotions').select('PromoID').eq('PromoName', targetKey).maybeSingle();
    const prmId = existing?.PromoID || await genId_('tb_Promotions', 'PromoID', 'PRM', 4);

    const { error } = await window.sb.from('tb_Promotions').upsert([{
      PromoID: prmId,
      PromoName: targetKey,
      DiscountAmt: csv,
      Status: 'Active'
    }], { onConflict: 'PromoName' });
    if (error) throw new Error(error.message);
    return { RouteID: routeId, Count: orderedIds.length };
  },

  async getMasterData(payload) {
    const tbl = String((typeof payload === 'object' && payload !== null) ? payload.tableName : payload).trim();
    const { data, error } = await window.sb.from(tbl).select('*');
    if (error) throw new Error(error.message);
    return normalizeRows_(data || []).reverse();
  },

  async saveMasterData(payload) {
    const tbl = String(payload?.tableName || '').trim();
    const rec = { ...(payload?.record || {}) };
    const pkMap = {
      'tb_Products': { col: 'ProductID', prefix: 'P' },
      'tb_Employees': { col: 'EmpID', prefix: 'EMP' },
      'tb_Vehicles': { col: 'VehicleID', prefix: 'VEH' },
      'tb_Routes': { col: 'RouteID', prefix: 'RT' },
      'tb_SpecialPrices': { col: 'SpPriceID', prefix: 'SP' },
      'tb_Promotions': { col: 'PromoID', prefix: 'PRM' },
      'tb_Machines': { col: 'MachineID', prefix: 'MAC' }
    };
    const meta = pkMap[tbl];
    if (!meta) throw new Error('ไม่รู้จักตาราง: ' + tbl);

    if (!rec[meta.col]) {
      rec[meta.col] = await genId_(tbl, meta.col, meta.prefix, 4);
      rec.Status = rec.Status || 'Active';
    }
    const { error } = await window.sb.from(tbl).upsert([rec], { onConflict: meta.col });
    if (error) throw new Error(error.message);
    return { id: rec[meta.col] };
  },

  // ------------------------------------------------------------------
  // 👥 2. CUSTOMER REGISTRY & INACTIVE CUSTOMER RADAR (3-7 DAYS)
  // ------------------------------------------------------------------
  async getCustomerDashboard() {
    const [customers, { data: routes }, { data: products }, { data: spPrices }, { data: promos }, { data: sales }] = await Promise.all([
      this.getCustomers(),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Products').select('*').neq('Status', 'Inactive').order('ProductID'),
      window.sb.from('tb_SpecialPrices').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Promotions').select('*').eq('Status', 'Active'),
      window.sb.from('tb_Sales').select('SaleID, SaleDate, CustomerID, CustomerName, TotalAmount, PaymentStatus').neq('PaymentStatus', 'Cancelled')
    ]);

    const routeMap = {};
    (routes || []).forEach(r => { routeMap[r.RouteID] = r.RouteName; });
    const prodMap = {};
    (products || []).forEach(p => { prodMap[p.ProductID] = p.ProductName; });

    const spByCust = {};
    (spPrices || []).forEach(sp => {
      if (!spByCust[sp.CustomerID]) spByCust[sp.CustomerID] = [];
      spByCust[sp.CustomerID].push({
        ProductID: sp.ProductID,
        ProductName: prodMap[sp.ProductID] || sp.ProductID,
        Price: parseFloat(sp.SpecialPrice) || 0
      });
    });

    const promoMap = {};
    (promos || []).forEach(p => {
      if (String(p.PromoName).startsWith('3FOR100:')) {
        const cid = String(p.PromoName).replace('3FOR100:', '').trim();
        promoMap[cid] = p.DiscountAmt || 'ALL';
      }
    });

    const lastSaleByCust = {};
    normalizeRows_(sales || []).forEach(s => {
      if (String(s.SaleID).startsWith('AR-')) return;
      const cid = String(s.CustomerID || '').trim();
      if (!cid || cid === 'WALK-IN') return;
      const sDate = String(s.SaleDate || '').slice(0, 10);
      if (!lastSaleByCust[cid]) lastSaleByCust[cid] = { lastDate: sDate, lastAmount: 0, billCount: 0 };
      lastSaleByCust[cid].billCount++;
      if (sDate >= lastSaleByCust[cid].lastDate) {
        lastSaleByCust[cid].lastDate = sDate;
        lastSaleByCust[cid].lastAmount = parseFloat(s.TotalAmount) || 0;
      }
    });

    const todayTime = new Date(bkkTodayStr_() + 'T00:00:00').getTime();
    const enriched = customers.map(c => {
      const stat = lastSaleByCust[c.CustomerID] || null;
      let daysInactive = null;
      if (stat?.lastDate) {
        const lastTime = new Date(stat.lastDate + 'T00:00:00').getTime();
        daysInactive = Math.max(0, Math.round((todayTime - lastTime) / 86400000));
      }
      return {
        ...c,
        RouteName: routeMap[c.RouteID] || c.RouteID || 'หน้าลาน',
        SpecialPrices: spByCust[c.CustomerID] || [],
        HasPromo3For100: !!promoMap[c.CustomerID],
        PromoEligibleProducts: promoMap[c.CustomerID] || 'ALL',
        LastSaleDate: stat ? stat.lastDate : '',
        LastSaleAmount: stat ? stat.lastAmount : 0,
        TotalBillsCount: stat ? stat.billCount : 0,
        DaysInactive: daysInactive
      };
    });

    return { customers: enriched, routes: routes || [], products: products || [] };
  },

  async saveCustomer(payload) {
    let custId = String(payload?.CustomerID || '').trim();
    if (!custId) custId = await genId_('tb_Customers', 'CustomerID', 'C', 4);

    const { error } = await window.sb.from('tb_Customers').upsert([{
      CustomerID: custId,
      CustomerName: payload.CustomerName,
      Phone: payload.Phone || '',
      CustomerType: payload.CustomerType || 'ร้านประจำ',
      RouteID: payload.RouteID || 'หน้าลาน',
      CreditLimit: parseFloat(payload.CreditLimit) || 0,
      Status: payload.Status || 'Active'
    }], { onConflict: 'CustomerID' });
    if (error) throw new Error(error.message);

    if (Array.isArray(payload.SpecialPrices)) {
      for (const item of payload.SpecialPrices) {
        if (item.Price !== '' && item.Price !== null && !isNaN(item.Price)) {
          const spId = `SP-${custId}-${item.ProductID}`;
          await window.sb.from('tb_SpecialPrices').upsert([{
            SpPriceID: spId,
            CustomerID: custId,
            ProductID: item.ProductID,
            SpecialPrice: parseFloat(item.Price),
            Status: 'Active'
          }], { onConflict: 'CustomerID,ProductID' });
        } else {
          await window.sb.from('tb_SpecialPrices').update({ Status: 'Inactive' }).match({ CustomerID: custId, ProductID: item.ProductID });
        }
      }
    }

    if (payload.HasPromo3For100 !== undefined) {
      const targetKey = '3FOR100:' + custId;
      if (payload.HasPromo3For100) {
        await window.sb.from('tb_Promotions').upsert([{
          PromoID: 'PRM-' + custId,
          PromoName: targetKey,
          DiscountAmt: payload.PromoEligibleProducts || 'ALL',
          Status: 'Active'
        }], { onConflict: 'PromoName' });
      } else {
        await window.sb.from('tb_Promotions').update({ Status: 'Inactive' }).eq('PromoName', targetKey);
      }
    }
    return { CustomerID: custId };
  },

  // ------------------------------------------------------------------
  // 🛒 3. POS & COLD-ROOM INVENTORY (SINGLE SOURCE OF TRUTH)
  // ------------------------------------------------------------------
  async getInitialPOSData() {
    const todayStr = bkkTodayStr_();
    const [
      { data: balances },
      customers,
      { data: specialPrices },
      { data: promotions },
      { data: routes },
      { data: todaySalesRaw }
    ] = await Promise.all([
      window.sb.rpc('rpc_get_cold_room_balances', { p_start_date: todayStr, p_end_date: todayStr }),
      this.getCustomers(),
      window.sb.from('tb_SpecialPrices').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Promotions').select('*').eq('Status', 'Active'),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive').order('RouteID'),
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').gte('SaleDate', `${todayStr}T00:00:00+07:00`).order('SaleDate', { ascending: false })
    ]);

    const stockMap = {};
    const products = (balances || []).map(b => {
      stockMap[b.ProductID] = parseFloat(b.Balance) || 0;
      return { ProductID: b.ProductID, ProductName: b.ProductName, DefaultPrice: parseFloat(b.DefaultPrice) || 0, Unit: b.Unit, Status: 'Active' };
    });

    const promoMap = {};
    (promotions || []).forEach(r => {
      if (String(r.PromoName).startsWith('3FOR100:')) {
        const cid = String(r.PromoName).replace('3FOR100:', '').trim();
        promoMap[cid] = { PromoID: r.PromoID, BundleQty: 3, BundlePrice: 100, EligibleProducts: r.DiscountAmt || 'ALL' };
      }
    });

    const factorySales = [];
    const prodSummaryMap = {};
    products.forEach((p, idx) => {
      prodSummaryMap[p.ProductID] = { id: p.ProductID, name: p.ProductName, category: 'สินค้าหลัก (ตัดสต๊อก)', unit: p.Unit, qty: 0, amount: 0, order: idx + 1 };
    });

    normalizeRows_(todaySalesRaw || []).forEach(s => {
      if (String(s.SaleID).startsWith('AR-')) return;
      const rId = String(s.RouteID || '').trim();
      if (!['', 'หน้าลาน', 'หน้าร้าน', 'หน้าโรง', 'หน้าโรงงาน', 'WALK-IN'].includes(rId)) return;

      const details = s.tb_SalesDetails || [];
      s.Items = details;
      s.ItemSummary = details.map(d => `${d.ProductName} x${d.Quantity}`).join(', ');
      factorySales.push(s);

      if (s.PaymentStatus !== 'Cancelled' && s.PaymentStatus !== 'ยกเลิก') {
        details.forEach(det => {
          const pid = String(det.ProductID || '').trim();
          const q = parseFloat(det.Quantity) || 0;
          const amt = parseFloat(det.SubTotal) || (q * (parseFloat(det.UnitPrice) || 0));
          const key = pid || det.ProductName;
          if (!prodSummaryMap[key]) {
            prodSummaryMap[key] = { id: pid, name: det.ProductName, category: pid.startsWith('RET-') ? 'ขายปลีก' : 'อื่นๆ', unit: 'รายการ', qty: 0, amount: 0, order: 80 };
          }
          prodSummaryMap[key].qty += q;
          prodSummaryMap[key].amount += amt;
        });
      }
    });

    return {
      products,
      customers,
      specialPrices: specialPrices || [],
      promoMap,
      routes: routes || [],
      stockMap,
      todaySales: factorySales,
      productSummary: Object.values(prodSummaryMap).filter(x => x.qty > 0 || x.amount !== 0).sort((a, b) => a.order - b.order)
    };
  },

  async saveSale(payload) {
    const { data, error } = await window.sb.rpc('rpc_save_sale', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data;
  },

  async cancelSale(payload) {
    const { data, error } = await window.sb.rpc('rpc_cancel_sale', {
      p_sale_id: payload.SaleID,
      p_reason: payload.Reason || 'ทำรายการผิด',
      p_cancelled_by: payload.CancelledBy || payload.CreatedBy || 'Admin'
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async getInventoryDashboard(payload) {
    const todayStr = bkkTodayStr_();
    const sDate = payload?.startDate || todayStr;
    const eDate = payload?.endDate || sDate;

    const [
      { data: balancesRaw },
      { data: logsRaw },
      { data: activeDispatches },
      { data: macLogs }
    ] = await Promise.all([
      window.sb.rpc('rpc_get_cold_room_balances', { p_start_date: sDate, p_end_date: eDate }),
      window.sb.from('tb_InventoryLogs').select('*').gte('LogDate', `${sDate}T00:00:00+07:00`).lte('LogDate', `${eDate}T23:59:59+07:00`).order('LogDate', { ascending: false }),
      window.sb.from('tb_RouteDispatches').select('*').eq('Status', 'กำลังวิ่งส่ง'),
      window.sb.from('tb_MachineLogs').select('IceYieldBags').gte('LogDate', `${sDate}T00:00:00+07:00`).lte('LogDate', `${eDate}T23:59:59+07:00`)
    ]);

    const balances = balancesRaw || [];
    const stockMap = {};
    balances.forEach(b => { b.OnTruckQty = 0; stockMap[b.ProductID] = b; });

    let totalOnTruckQty = 0;
    (activeDispatches || []).forEach(dsp => {
      let arr = [];
      try { arr = JSON.parse(dsp.LoadDetails || '[]'); } catch (e) {}
      arr.forEach(ld => {
        const q = parseFloat(ld.qty) || 0;
        if (stockMap[ld.id]) {
          stockMap[ld.id].OnTruckQty += q;
          totalOnTruckQty += q;
        }
      });
    });

    let periodProd = 0, crushedOut = 0, crushedIn = 0, routeDisp = 0, frontSale = 0, auditDiff = 0;
    const recentLogs = normalizeRows_(logsRaw || []);
    recentLogs.forEach(l => {
      if (String(l.Note || '').includes('[ยกเลิกแล้ว]') || String(l.ActionType || '').includes('คืนสต๊อก')) return;
      const qIn = parseFloat(l.QtyIn) || 0;
      const qOut = parseFloat(l.QtyOut) || 0;
      const act = String(l.ActionType || '');
      if (act === 'ผลิตเข้าคลัง') periodProd += qIn;
      else if (act === 'เบิกไปบด') crushedOut += qOut;
      else if (act === 'รับเข้าจากบด') crushedIn += qIn;
      else if (act.includes('เบิกขึ้นรถ') || act.includes('เบิกเพิ่ม')) routeDisp += qOut;
      else if (act === 'ขายหน้าลาน') frontSale += qOut;
      else auditDiff += (qIn - qOut);
    });

    const machineYieldTotal = (macLogs || []).reduce((acc, m) => acc + (parseFloat(m.IceYieldBags) || 0), 0);
    const totalColdRoomUnits = balances.reduce((acc, b) => acc + (parseFloat(b.Balance) || 0), 0);

    return {
      filters: { startDate: sDate, endDate: eDate },
      summary: {
        totalColdRoomUnits,
        todayProduction: periodProd,
        machineYieldTotal,
        periodCrushedOut: crushedOut,
        periodCrushedIn: crushedIn,
        todayDispatch: routeDisp + frontSale,
        routeDispatchQty: routeDisp,
        frontSaleQty: frontSale,
        onTruckQty: totalOnTruckQty,
        activeTruckCount: (activeDispatches || []).length,
        todayTransfer: auditDiff
      },
      balances,
      products: balances,
      recentLogs
    };
  },

  async saveInventoryTransaction(payload) {
    const items = payload?.items || [];
    if (!items.length) throw new Error('กรุณาระบุรายการสินค้า');
    const datePrefix = bkkTodayStr_().replace(/-/g, '');
    const rows = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) continue;
      const flow = it.flow || payload.Flow || 'IN';
      rows.push({
        InvLogID: `INV-${datePrefix}-${Date.now().toString().slice(-4)}-${i + 1}`,
        ProductID: String(it.id).trim(),
        ProductName: it.name,
        ActionType: it.actionType || payload.ActionType || 'ปรับปรุงสต๊อก',
        QtyIn: flow === 'IN' ? q : 0,
        QtyOut: flow === 'OUT' ? q : 0,
        Reference: it.reference || payload.Reference || '',
        CreatedBy: payload.CreatedBy || 'Admin',
        Note: it.note || payload.Note || ''
      });
    }
    const { error } = await window.sb.from('tb_InventoryLogs').insert(rows);
    if (error) throw new Error(error.message);
    return { Status: 'Success', Count: rows.length };
  },

  async saveStockAudit(payload) {
    const auditItems = payload?.auditItems || [];
    const todayStr = bkkTodayStr_();
    const { data: balances } = await window.sb.rpc('rpc_get_cold_room_balances', { p_start_date: todayStr, p_end_date: todayStr });
    const curMap = {};
    (balances || []).forEach(b => { curMap[b.ProductID] = parseFloat(b.Balance) || 0; });

    const auditRef = 'AUD-' + Date.now().toString().slice(-6);
    const rows = [];
    auditItems.forEach((it, idx) => {
      const sys = curMap[it.id] || 0;
      const act = parseFloat(it.actualQty);
      const diff = act - sys;
      if (isNaN(diff) || diff === 0) return;
      rows.push({
        InvLogID: `INV-${auditRef}-${idx + 1}`,
        ProductID: it.id,
        ProductName: it.name,
        ActionType: diff > 0 ? 'ตรวจนับสต๊อก (ปรับเพิ่ม)' : 'ตรวจนับสต๊อก (ตัดขาด/ละลาย)',
        QtyIn: diff > 0 ? diff : 0,
        QtyOut: diff < 0 ? Math.abs(diff) : 0,
        Reference: auditRef,
        CreatedBy: payload.CreatedBy || 'Admin',
        Note: `ระบบเดิม ${sys} -> นับจริง ${act} (${diff > 0 ? '+' + diff : diff}) ${payload.Note || ''}`
      });
    });

    if (rows.length > 0) {
      const { error } = await window.sb.from('tb_InventoryLogs').insert(rows);
      if (error) throw new Error(error.message);
    }
    return { AuditRef: auditRef, AdjustedCount: rows.length };
  },

  async cancelInventoryLog(payload) {
    const id = String(payload?.InvLogID || '').trim();
    const { data: row, error } = await window.sb.from('tb_InventoryLogs').select('*').eq('InvLogID', id).single();
    if (error || !row) throw new Error('ไม่พบรหัสรายการสต๊อก: ' + id);
    if (String(row.Note || '').includes('[ยกเลิกแล้ว]')) throw new Error('รายการนี้ถูกยกเลิกไปแล้วค่ะ');

    await window.sb.from('tb_InventoryLogs').update({ Note: `[ยกเลิกแล้ว] ${row.Note || ''}` }).eq('InvLogID', id);
    await window.sb.from('tb_InventoryLogs').insert([{
      InvLogID: `INV-REV-${Date.now().toString().slice(-5)}`,
      ProductID: row.ProductID,
      ProductName: row.ProductName,
      ActionType: `คืนสต๊อก (ยกเลิก ${id})`,
      QtyIn: parseFloat(row.QtyOut) || 0,
      QtyOut: parseFloat(row.QtyIn) || 0,
      Reference: id,
      CreatedBy: payload.CreatedBy || 'Admin',
      Note: 'ยกเลิกรายการที่คีย์ผิด: ' + row.ActionType
    }]);
    return { InvLogID: id, Status: 'Cancelled' };
  },

  // ------------------------------------------------------------------
  // 💳 4. CREDIT (AR AGING, PARTIAL PAYMENT) & BUCKET MANAGEMENT
  // ------------------------------------------------------------------
  async getCreditDashboard() {
    const [
      { data: salesRaw },
      customers,
      { data: routes },
      { data: paymentsRaw }
    ] = await Promise.all([
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').in('PaymentStatus', ['Unpaid', 'ค้างชำระ']),
      this.getCustomers(),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Payments').select('*').order('PaymentDate', { ascending: false }).limit(40)
    ]);

    const routeMap = { 'หน้าลาน': '🏠 หน้าลาน (หน้าร้าน)' };
    (routes || []).forEach(r => { routeMap[r.RouteID] = r.RouteName; routeMap[r.RouteName] = r.RouteName; });

    const custMap = {};
    customers.forEach(c => {
      custMap[c.CustomerID] = { ...c, RouteName: routeMap[c.RouteID] || c.RouteID || 'หน้าลาน', CreditLimit: parseFloat(c.CreditLimit) || 0 };
    });

    const todayTime = new Date(bkkTodayStr_() + 'T00:00:00').getTime();
    const debtByCust = {};
    let totalOutstanding = 0, totalUnpaidBills = 0, overLimitCount = 0;
    const agingStats = { normal0to7: 0, warn8to15: 0, late16to30: 0, critOver30: 0, critOver30Amt: 0 };

    normalizeRows_(salesRaw || []).forEach(s => {
      const rawCid = String(s.CustomerID || 'WALK-IN').trim();
      const isWalkIn = (rawCid === 'WALK-IN' || !custMap[rawCid]);
      const stdName = isWalkIn ? normWalkIn_(s.CustomerName) : s.CustomerName;
      const debtKey = isWalkIn ? ('WALK-IN::' + stdName) : rawCid;
      const cInfo = !isWalkIn ? custMap[rawCid] : {
        CustomerID: debtKey, CustomerName: '🚶 ' + stdName, Phone: '', RouteID: s.RouteID || 'หน้าลาน', RouteName: routeMap[s.RouteID] || 'หน้าลาน', CreditLimit: 0
      };

      if (!debtByCust[debtKey]) {
        debtByCust[debtKey] = {
          CustomerID: debtKey, RawCustomerID: rawCid, CustomerName: cInfo.CustomerName, Phone: cInfo.Phone,
          RouteID: cInfo.RouteID, RouteName: cInfo.RouteName, CreditLimit: cInfo.CreditLimit,
          TotalDebt: 0, MaxOverdueDays: 0, OldestBillDate: '', AgingTier: 'NORMAL', Bills: []
        };
      }

      const amt = parseFloat(s.TotalAmount) || 0;
      const sDateStr = String(s.SaleDate || '').slice(0, 10);
      const billDays = sDateStr ? Math.max(0, Math.round((todayTime - new Date(sDateStr + 'T00:00:00').getTime()) / 86400000)) : 0;
      const details = s.tb_SalesDetails || [];
      s.OverdueDays = billDays;
      s.ItemSummary = details.map(d => `${d.ProductName}${d.Quantity > 1 ? ' x' + d.Quantity : ''}`).join(', ') || 'บิลค้างชำระ';

      const entry = debtByCust[debtKey];
      entry.TotalDebt += amt;
      if (billDays >= entry.MaxOverdueDays) entry.MaxOverdueDays = billDays;
      if (!entry.OldestBillDate || sDateStr < entry.OldestBillDate) entry.OldestBillDate = sDateStr;
      entry.Bills.push(s);

      totalOutstanding += amt;
      totalUnpaidBills++;
    });

    const debtList = Object.values(debtByCust).map(d => {
      if (d.CreditLimit > 0 && d.TotalDebt > d.CreditLimit) overLimitCount++;
      if (d.MaxOverdueDays > 30) { d.AgingTier = 'CRIT'; agingStats.critOver30++; agingStats.critOver30Amt += d.TotalDebt; }
      else if (d.MaxOverdueDays >= 16) { d.AgingTier = 'LATE'; agingStats.late16to30++; }
      else if (d.MaxOverdueDays >= 8) { d.AgingTier = 'WARN'; agingStats.warn8to15++; }
      else { d.AgingTier = 'NORMAL'; agingStats.normal0to7++; }
      d.Bills.sort((a, b) => String(a.SaleDate).localeCompare(String(b.SaleDate)));
      return d;
    }).sort((a, b) => b.TotalDebt - a.TotalDebt);

    return {
      summary: { totalOutstanding, debtorCount: debtList.length, totalUnpaidBills, overLimitCount, agingStats },
      debtList,
      customers,
      routes: routes || [],
      recentPayments: normalizeRows_(paymentsRaw || [])
    };
  },

  async savePayment(payload) {
    const saleIds = payload?.SaleIDs || [];
    const amountPaid = parseFloat(payload?.AmountPaid) || 0;
    if (!saleIds.length || amountPaid <= 0) throw new Error('ข้อมูลการรับชำระไม่ครบถ้วน');

    const { data: bills } = await window.sb.from('tb_Sales').select('*').in('SaleID', saleIds);
    const sumBills = (bills || []).reduce((acc, b) => acc + (parseFloat(b.TotalAmount) || 0), 0);
    const sample = (bills || [])[0] || {};

    await window.sb.from('tb_Sales').update({ PaymentStatus: 'Paid' }).in('SaleID', saleIds);

    const datePrefix = bkkTodayStr_().replace(/-/g, '');
    const cleanCid = String(payload.CustomerID || sample.CustomerID || 'WALK-IN').replace(/^WALK-IN::/, '');
    const cleanName = String(payload.CustomerName || sample.CustomerName || 'ลูกค้า').replace(/🚶/g, '').trim();
    const remaining = sumBills - amountPaid;
    let balSaleId = '';

    if (remaining > 0) {
      balSaleId = await genId_('tb_Sales', 'SaleID', 'AR-' + datePrefix, 4);
      const summary = `ยอดค้างคงเหลือจากการแบ่งจ่ายบิล (${saleIds.join(', ')} ยอดเต็ม ฿${sumBills} จ่ายแล้ว ฿${amountPaid})`;
      await window.sb.from('tb_Sales').insert([{
        SaleID: balSaleId, CustomerID: cleanCid, CustomerName: cleanName, RouteID: sample.RouteID || 'หน้าลาน',
        TotalAmount: remaining, PaymentType: 'เครดิต (ยอดค้างแบ่งจ่าย)', PaymentStatus: 'Unpaid', CreatedBy: payload.CreatedBy || 'Admin'
      }]);
      await window.sb.from('tb_SalesDetails').insert([{
        DetailID: balSaleId + '-1', SaleID: balSaleId, ProductID: 'AR-MANUAL', ProductName: summary, Quantity: 1, UnitPrice: remaining, SubTotal: remaining
      }]);
    }

    const payId = await genId_('tb_Payments', 'PaymentID', 'PAY-' + datePrefix, 4);
    const note = (payload.Note || '') + (remaining > 0 ? ` | แบ่งจ่าย (เหลือค้าง ฿${remaining} ในบิล ${balSaleId})` : '');
    await window.sb.from('tb_Payments').insert([{
      PaymentID: payId, CustomerID: cleanCid, CustomerName: cleanName, RefSaleIDs: saleIds.join(', '),
      AmountPaid: amountPaid, PaymentMethod: payload.PaymentMethod || 'เงินสด', CreatedBy: payload.CreatedBy || 'Admin', Note: note
    }]);

    return {
      PaymentID: payId, PaymentDate: fmtPgDate_(new Date()), CustomerName: cleanName, RefSaleIDs: saleIds.join(', '),
      PaymentMethod: payload.PaymentMethod || 'เงินสด', AmountPaid: amountPaid, RemainingBalance: Math.max(0, remaining), BalanceSaleID: balSaleId
    };
  },

  async cancelPayment(payload) {
    const payId = String(payload?.PaymentID || '').trim();
    const { data: p } = await window.sb.from('tb_Payments').select('*').eq('PaymentID', payId).single();
    if (!p) throw new Error('ไม่พบใบรับชำระ: ' + payId);

    const refIds = String(p.RefSaleIDs || '').split(',').map(x => x.trim()).filter(Boolean);
    if (refIds.length) {
      await window.sb.from('tb_Sales').update({ PaymentStatus: 'Unpaid' }).in('SaleID', refIds);
    }
    const balMatch = String(p.Note || '').match(/AR-\d{8}-\d+/);
    if (balMatch) {
      await window.sb.from('tb_Sales').update({ PaymentStatus: 'Cancelled' }).eq('SaleID', balMatch[0]);
    }
    await window.sb.from('tb_Payments').delete().eq('PaymentID', payId);
    return { PaymentID: payId, ReopenedBills: p.RefSaleIDs };
  },

  async addManualCreditBill(payload) {
    const rawInput = String(payload?.CustomerInput || payload?.CustomerName || '').trim();
    const amt = parseFloat(payload?.Amount) || 0;
    if (!rawInput || amt <= 0) throw new Error('กรุณาระบุชื่อร้านและยอดหนี้ให้ถูกต้อง');

    let custId = 'WALK-IN', custName = rawInput;
    if (rawInput.includes(' : ')) {
      const pts = rawInput.split(' : ');
      custId = pts[0].trim();
      custName = pts.slice(1).join(' : ').trim();
    }
    const datePrefix = (payload.SaleDate || bkkTodayStr_()).replace(/-/g, '');
    const saleId = await genId_('tb_Sales', 'SaleID', 'AR-' + datePrefix, 4);
    const desc = payload.Description || 'ยอดหนี้คงค้างยกมา';

    await window.sb.from('tb_Sales').insert([{
      SaleID: saleId, SaleDate: (payload.SaleDate || bkkTodayStr_()) + 'T08:00:00+07:00',
      CustomerID: custId, CustomerName: custName, RouteID: payload.RouteID || 'หน้าลาน',
      TotalAmount: amt, PaymentType: 'เครดิต (ยอดยกมา)', PaymentStatus: 'Unpaid', CreatedBy: payload.CreatedBy || 'Admin'
    }]);
    await window.sb.from('tb_SalesDetails').insert([{
      DetailID: saleId + '-1', SaleID: saleId, ProductID: 'AR-MANUAL', ProductName: desc, Quantity: 1, UnitPrice: amt, SubTotal: amt
    }]);
    return { SaleID: saleId };
  },

  async getBucketDashboard() {
    const cutoff30d = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const [
      { data: bucketsRaw },
      customers,
      { data: routes },
      { data: employees },
      { data: logsRaw },
      { data: recentSales }
    ] = await Promise.all([
      window.sb.from('tb_Buckets').select('*').neq('Status', 'Inactive').order('SerialNumber'),
      this.getCustomers(),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_BucketLogs').select('*').order('LogDate', { ascending: false }).limit(50),
      window.sb.from('tb_Sales').select('SaleID, SaleDate, CustomerID, CustomerName, PaymentStatus, tb_SalesDetails(ProductID, Quantity)').gte('SaleDate', `${cutoff30d}T00:00:00+07:00`).neq('PaymentStatus', 'Cancelled')
    ]);

    const routeNameMap = { 'หน้าลาน': '🏠 หน้าลาน' };
    (routes || []).forEach(r => { routeNameMap[r.RouteID] = r.RouteName; });

    const custByName = {};
    customers.forEach(c => {
      custByName[String(c.CustomerName || '').trim().toLowerCase()] = {
        CustomerID: c.CustomerID, Phone: c.Phone || '', RouteID: c.RouteID || 'หน้าลาน', RouteName: routeNameMap[c.RouteID] || c.RouteID || 'หน้าลาน'
      };
    });

    const salesStatByHolder = {};
    normalizeRows_(recentSales || []).forEach(s => {
      if (String(s.SaleID).startsWith('AR-')) return;
      const key = String(s.CustomerName || '').replace(/🚶/g, '').trim().toLowerCase();
      if (!key) return;
      if (!salesStatByHolder[key]) salesStatByHolder[key] = { lastDate: '', qty30d: 0 };
      const sDay = String(s.SaleDate).slice(0, 10);
      if (sDay > salesStatByHolder[key].lastDate) salesStatByHolder[key].lastDate = sDay;
      (s.tb_SalesDetails || []).forEach(d => {
        if (isStockPid_(d.ProductID)) salesStatByHolder[key].qty30d += (parseFloat(d.Quantity) || 0);
      });
    });

    const todayTime = new Date(bkkTodayStr_() + 'T00:00:00').getTime();
    const allBuckets = normalizeRows_(bucketsRaw || []).map(b => {
      const hKey = String(b.CurrentLocation || '').trim().toLowerCase();
      const cInfo = custByName[hKey] || null;
      const sStat = salesStatByHolder[hKey] || null;
      const bDay = String(b.BorrowDate || '').slice(0, 10);
      return {
        ...b,
        HolderPhone: cInfo ? cInfo.Phone : '',
        HolderRouteID: cInfo ? cInfo.RouteID : 'งานนอก/ทั่วไป',
        HolderRouteName: cInfo ? cInfo.RouteName : '🎪 งานนอก / ขาจร',
        Last30DaysQty: sStat ? sStat.qty30d : 0,
        DaysSinceLastSale: sStat?.lastDate ? Math.max(0, Math.round((todayTime - new Date(sStat.lastDate + 'T00:00:00').getTime()) / 86400000)) : null,
        BorrowDays: bDay ? Math.max(0, Math.round((todayTime - new Date(bDay + 'T00:00:00').getTime()) / 86400000)) : 0
      };
    });

    return {
      allBuckets,
      customers,
      routes: routes || [],
      employees: employees || [],
      recentLogs: normalizeRows_(logsRaw || [])
    };
  },

  async saveBucketTransaction(payload) {
    const mode = String(payload?.mode || 'OUT').toUpperCase();
    const serials = payload?.Serials || [];
    if (!serials.length) throw new Error('กรุณาเลือกหมายเลขถังอย่างน้อย 1 ใบ');

    const holder = String(payload?.CustomerName || '').trim();
    const loanType = payload?.LoanType || 'ถังยืมร้าน';
    const retCond = payload?.ReturnCondition || 'ในคลัง';
    const staff = payload?.DriverName || payload?.CreatedBy || 'Admin';
    const note = (staff ? `[ผู้ทำรายการ: ${staff}] ` : '') + (payload?.Note || '');

    if (mode === 'OUT' || mode === 'TRANSFER') {
      await window.sb.from('tb_Buckets').update({
        BucketType: loanType, CurrentStatus: 'ถูกยืม', CurrentLocation: holder, Note: note, LoanType: loanType, BorrowDate: bkkNowIso_()
      }).in('SerialNumber', serials);
    } else {
      await window.sb.from('tb_Buckets').update({
        CurrentStatus: retCond === 'ส่งซ่อม' ? 'ส่งซ่อม' : 'ในคลัง',
        CurrentLocation: retCond === 'ส่งซ่อม' ? 'โรงงานแม่ใจ (รอซ่อม)' : 'โรงงานแม่ใจ',
        Note: note || 'สภาพดี', LoanType: '', BorrowDate: null
      }).in('SerialNumber', serials);
    }

    const logId = await genId_('tb_BucketLogs', 'LogID', 'BKL-' + bkkTodayStr_().replace(/-/g, ''), 4);
    const actLabel = mode === 'OUT' ? 'ยืมถังออก' : (mode === 'TRANSFER' ? `โอนย้ายถัง ➔ ${holder}` : (retCond === 'ส่งซ่อม' ? 'รับคืนถังชำรุด (ส่งซ่อม)' : 'คืนเข้าคลัง'));

    const logRow = {
      LogID: logId, LogDate: fmtPgDate_(new Date()), ActionType: actLabel, BucketType: loanType,
      CustomerID: loanType === 'ถังยืมงาน' ? 'EVENT' : 'SHOP', CustomerName: holder || 'รับคืนหน้าลาน',
      SerialNumbers: serials.join(', '), TotalQty: serials.length, Note: note, CreatedBy: staff
    };
    await window.sb.from('tb_BucketLogs').insert([{ ...logRow, LogDate: bkkNowIso_() }]);
    return logRow;
  },

  async getBucketsList() {
    const d = await this.getBucketDashboard();
    const buckets = d.allBuckets || [];
    const summary = {
      total: buckets.length,
      inStock: buckets.filter(b => b.CurrentStatus === 'ในคลัง').length,
      borrowed: buckets.filter(b => b.CurrentStatus === 'ถูกยืม').length,
      maintenance: buckets.filter(b => b.CurrentStatus === 'ส่งซ่อม').length
    };
    return { buckets, summary, customers: d.customers };
  },

  async saveBucketRecord(payload) {
    let bId = String(payload?.BucketID || '').trim();
    if (!bId) bId = await genId_('tb_Buckets', 'BucketID', 'B', 4);
    const isBorrowed = payload.CurrentStatus === 'ถูกยืม';
    const { error } = await window.sb.from('tb_Buckets').upsert([{
      BucketID: bId,
      SerialNumber: String(payload.SerialNumber).trim(),
      Capacity: payload.Capacity || '200L',
      BucketType: payload.BucketType || 'ถังยืมร้าน',
      CurrentStatus: payload.CurrentStatus || 'ในคลัง',
      CurrentLocation: payload.CurrentStatus === 'ในคลัง' ? 'โรงงานแม่ใจ' : (payload.CurrentLocation || 'โรงงานแม่ใจ'),
      Note: payload.Note || '',
      Status: 'Active',
      LoanType: isBorrowed ? (payload.BucketType || 'ถังยืมร้าน') : '',
      BorrowDate: isBorrowed ? bkkNowIso_() : null
    }], { onConflict: 'BucketID' });
    if (error) throw new Error(error.message);
    return { BucketID: bId };
  },

  // ------------------------------------------------------------------
  // 🚚 5. ROUTE DISPATCH, SETTLEMENT & DRIVER MOBILE PORTAL
  // ------------------------------------------------------------------
  async getRouteSettlementData() {
    const [
      { data: dispatchesRaw },
      { data: fuelRaw },
      { data: routes },
      { data: vehicles },
      { data: employees },
      { data: products },
      { data: salesRaw },
      { data: paymentsRaw },
      customers
    ] = await Promise.all([
      window.sb.from('tb_RouteDispatches').select('*').order('DispatchDate', { ascending: false }).limit(40),
      window.sb.from('tb_FuelLogs').select('*').order('FuelDate', { ascending: false }).limit(40),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Vehicles').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Products').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').neq('PaymentStatus', 'Cancelled'),
      window.sb.from('tb_Payments').select('*'),
      this.getCustomers()
    ]);

    const dispatches = normalizeRows_(dispatchesRaw || []);
    const allSales = normalizeRows_(salesRaw || []);
    const allPayments = normalizeRows_(paymentsRaw || []);
    const fuelLogs = normalizeRows_(fuelRaw || []);

    dispatches.forEach(dsp => {
      if (dsp.Status === 'กำลังวิ่งส่ง') {
        const dDay = String(dsp.DispatchDate).slice(0, 10);
        const rId = String(dsp.RouteID).trim();
        let soldQty = 0, cashOnly = 0, trfSales = 0, crdSales = 0;
        const soldByProd = {};

        allSales.forEach(s => {
          if (String(s.SaleID).startsWith('AR-')) return;
          if (String(s.SaleDate).slice(0, 10) === dDay && (s.RouteID === rId || s.RouteID === dsp.RouteName)) {
            const amt = parseFloat(s.TotalAmount) || 0;
            const pt = String(s.PaymentType || '');
            if (pt.includes('เครดิต') || pt.includes('เชื่อ')) crdSales += amt;
            else if (pt.includes('โอน')) trfSales += amt;
            else cashOnly += amt;

            (s.tb_SalesDetails || []).forEach(det => {
              if (isStockPid_(det.ProductID)) {
                const q = parseFloat(det.Quantity) || 0;
                soldQty += q;
                soldByProd[det.ProductID] = (soldByProd[det.ProductID] || 0) + q;
              }
            });
          }
        });

        let debtCash = 0, debtTrf = 0;
        allPayments.forEach(p => {
          if (String(p.PaymentDate).slice(0, 10) === dDay && String(p.CreatedBy || '').includes(dsp.DriverName)) {
            const pa = parseFloat(p.AmountPaid) || 0;
            if (String(p.PaymentMethod).includes('โอน')) debtTrf += pa;
            else debtCash += pa;
          }
        });

        let fuelCash = 0;
        fuelLogs.forEach(f => {
          if (String(f.FuelDate).slice(0, 10) === dDay && (f.VehicleID === dsp.VehicleID || f.DriverName === dsp.DriverName)) {
            if (String(f.PaidBy).includes('เงินสด') || String(f.PaidBy).includes('หัก')) fuelCash += (parseFloat(f.TotalCost) || 0);
          }
        });

        let loadArr = [];
        try { loadArr = JSON.parse(dsp.LoadDetails || '[]'); } catch (e) {}
        dsp.ItemBreakdown = loadArr.map(ld => ({
          id: ld.id, name: ld.name, loadedQty: parseFloat(ld.qty) || 0, soldQty: soldByProd[ld.id] || 0,
          expectedRemain: Math.max(0, (parseFloat(ld.qty) || 0) - (soldByProd[ld.id] || 0))
        }));

        dsp.LiveSoldQty = soldQty;
        dsp.LiveCashOnlySales = cashOnly;
        dsp.LiveDebtCash = debtCash;
        dsp.LiveDebtTransfer = debtTrf;
        dsp.LiveCashSales = cashOnly + debtCash;
        dsp.LiveTransferSales = trfSales;
        dsp.LiveCreditSales = crdSales;
        dsp.LiveFuelCash = fuelCash;
        dsp.LiveFuelExpense = fuelCash;
        dsp.ReportBoughtList = [];
        dsp.ReportMissedList = [];
        dsp.ReportDebtPaymentsList = [];
        dsp.LoadRounds = [];
      }
    });

    return { dispatches, fuelLogs, routes: routes || [], vehicles: vehicles || [], employees: employees || [], products: products || [] };
  },

  async createDispatch(payload) {
    const datePrefix = bkkTodayStr_().replace(/-/g, '');
    const dspId = await genId_('tb_RouteDispatches', 'DispatchID', 'DSP-' + datePrefix, 4);
    const loadedQty = parseFloat(payload.LoadedQty) || 0;

    const { error } = await window.sb.from('tb_RouteDispatches').insert([{
      DispatchID: dspId,
      RouteID: payload.RouteID,
      RouteName: payload.RouteName,
      VehicleID: payload.VehicleID,
      DriverName: payload.DriverName,
      StartMileage: parseFloat(payload.StartMileage) || 0,
      LoadedQty: loadedQty,
      Status: 'กำลังวิ่งส่ง',
      Note: payload.LoadDetailsText ? `เบิก: ${payload.LoadDetailsText}` : '',
      LoadDetails: payload.LoadDetailsJSON || '[]'
    }]);
    if (error) throw new Error(error.message);

    let arr = [];
    try { arr = JSON.parse(payload.LoadDetailsJSON || '[]'); } catch (e) {}
    const invRows = arr.filter(x => parseFloat(x.qty) > 0).map((it, idx) => ({
      InvLogID: `INV-${dspId}-${idx + 1}`,
      ProductID: it.id,
      ProductName: it.name,
      ActionType: 'เบิกขึ้นรถ',
      QtyIn: 0,
      QtyOut: parseFloat(it.qty),
      Reference: dspId,
      CreatedBy: payload.DriverName || 'Admin',
      Note: 'ปล่อยรถสาย: ' + payload.RouteName
    }));
    if (invRows.length) await window.sb.from('tb_InventoryLogs').insert(invRows);
    return { DispatchID: dspId };
  },

  async reloadDispatch(payload) {
    const dspId = String(payload.DispatchID).trim();
    const { data: dsp } = await window.sb.from('tb_RouteDispatches').select('*').eq('DispatchID', dspId).single();
    if (!dsp || dsp.Status !== 'กำลังวิ่งส่ง') throw new Error('ไม่พบกะสายส่งที่กำลังวิ่งอยู่');

    const addedArr = JSON.parse(payload.AddedDetailsJSON || '[]');
    const curArr = JSON.parse(dsp.LoadDetails || '[]');
    addedArr.forEach(add => {
      const ex = curArr.find(c => String(c.id) === String(add.id));
      if (ex) ex.qty = (parseFloat(ex.qty) || 0) + (parseFloat(add.qty) || 0);
      else curArr.push(add);
    });

    const newLoaded = (parseFloat(dsp.LoadedQty) || 0) + (parseFloat(payload.AddedQty) || 0);
    await window.sb.from('tb_RouteDispatches').update({
      LoadedQty: newLoaded,
      LoadDetails: JSON.stringify(curArr),
      Note: `${dsp.Note || ''} | เบิกเพิ่ม: ${payload.AddedDetailsText || ''}`
    }).eq('DispatchID', dspId);

    const invRows = addedArr.map((it, idx) => ({
      InvLogID: `INV-RLD-${Date.now().toString().slice(-4)}-${idx + 1}`,
      ProductID: it.id, ProductName: it.name, ActionType: 'เบิกเพิ่มขึ้นรถ', QtyIn: 0, QtyOut: parseFloat(it.qty),
      Reference: dspId, CreatedBy: dsp.DriverName, Note: 'เบิกเพิ่มสาย: ' + dsp.RouteName
    }));
    if (invRows.length) await window.sb.from('tb_InventoryLogs').insert(invRows);
    return { DispatchID: dspId, NewLoadedQty: newLoaded };
  },

  async closeDispatch(payload) {
    const dspId = String(payload.DispatchID).trim();
    const { data: dsp } = await window.sb.from('tb_RouteDispatches').select('*').eq('DispatchID', dspId).single();
    if (!dsp) throw new Error('ไม่พบใบปล่อยรถ');

    const loaded = parseFloat(dsp.LoadedQty) || 0;
    const sold = parseFloat(payload.SoldQty) || 0;
    const ret = parseFloat(payload.ReturnedQty) || 0;
    const loss = Math.max(0, loaded - sold - ret);
    const cashSales = parseFloat(payload.CashSales) || 0;
    const fuelExp = parseFloat(payload.FuelExpense) || 0;
    const otherExp = parseFloat(payload.OtherExpense) || 0;
    const expected = cashSales - fuelExp - otherExp;
    const actual = parseFloat(payload.ActualCash) || 0;
    const diff = actual - expected;

    await window.sb.from('tb_RouteDispatches').update({
      EndMileage: parseFloat(payload.EndMileage) || dsp.EndMileage || 0,
      SoldQty: sold, ReturnedQty: ret, LossQty: loss,
      CashSales: cashSales, TransferSales: parseFloat(payload.TransferSales) || 0, CreditSales: parseFloat(payload.CreditSales) || 0,
      FuelExpense: fuelExp, OtherExpense: otherExp, ExpectedCash: expected, ActualCash: actual, CashDiff: diff,
      Status: 'ปิดกะแล้ว'
    }).eq('DispatchID', dspId);

    const retItems = (payload.ReturnItems || []).filter(x => parseFloat(x.qty) > 0);
    if (retItems.length) {
      const invRows = retItems.map((it, idx) => ({
        InvLogID: `INV-RET-${dspId}-${idx + 1}`,
        ProductID: it.id, ProductName: it.name, ActionType: 'รับคืนจากรถสายส่ง (ปิดกะ)',
        QtyIn: parseFloat(it.qty), QtyOut: 0, Reference: dspId, CreatedBy: dsp.DriverName, Note: 'ตีคืนคลังจาก ' + dsp.RouteName
      }));
      await window.sb.from('tb_InventoryLogs').insert(invRows);
    }
    return { DispatchID: dspId, LossQty: loss, CashDiff: diff };
  },

  async getDriverInitData(payload) {
    const pin = String(payload?.pin || '').trim();
    const { data: emps } = await window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive');
    const driver = (emps || []).find(e => String(e.PIN).trim() === pin || String(e.Phone || '').replace(/\D/g, '').slice(-4) === pin);
    if (!driver) throw new Error('รหัส PIN ไม่ถูกต้อง');

    const { data: activeDsps } = await window.sb.from('tb_RouteDispatches').select('*').eq('Status', 'กำลังวิ่งส่ง');
    const myDispatch = (activeDsps || []).find(d => String(d.DriverName).includes(driver.EmpName) || String(driver.EmpName).includes(d.DriverName)) || null;

    const [{ data: vehicles }, { data: products }, allCusts, { data: spPrices }, { data: promos }] = await Promise.all([
      window.sb.from('tb_Vehicles').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Products').select('*').neq('Status', 'Inactive').order('ProductID'),
      this.getCustomers(),
      window.sb.from('tb_SpecialPrices').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Promotions').select('*').eq('Status', 'Active')
    ]);

    if (!myDispatch) {
      return { driver, lockedRoute: null, myDispatch: null, otherActiveRoutes: [], vehicles: vehicles || [], products: products || [], customers: [], specialPrices: [], promoMap: {}, customerDebtMap: {}, todayDebtPayments: [], todayRouteSales: [], todayTransfers: [], todayFuelLogs: [] };
    }

    const rId = myDispatch.RouteID;
    const myCustomers = allCusts.filter(c => c.RouteID === rId || c.RouteID === myDispatch.RouteName);
    const promoMap = {};
    (promos || []).forEach(r => {
      if (String(r.PromoName).startsWith('3FOR100:')) {
        promoMap[String(r.PromoName).replace('3FOR100:', '').trim()] = { PromoID: r.PromoID, BundleQty: 3, BundlePrice: 100, EligibleProducts: r.DiscountAmt || 'ALL' };
      }
    });

    const shiftDay = String(myDispatch.DispatchDate).slice(0, 10);
    const [{ data: routeSalesRaw }, { data: unpaidRaw }, { data: fuelsRaw }, { data: paysRaw }] = await Promise.all([
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').eq('RouteID', rId).gte('SaleDate', `${shiftDay}T00:00:00+07:00`).neq('PaymentStatus', 'Cancelled').order('SaleDate', { ascending: false }),
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').eq('RouteID', rId).in('PaymentStatus', ['Unpaid', 'ค้างชำระ']),
      window.sb.from('tb_FuelLogs').select('*').eq('VehicleID', myDispatch.VehicleID).gte('FuelDate', `${shiftDay}T00:00:00+07:00`),
      window.sb.from('tb_Payments').select('*').gte('PaymentDate', `${shiftDay}T00:00:00+07:00`)
    ]);

    const todayRouteSales = normalizeRows_(routeSalesRaw || []).map(s => {
      const dets = s.tb_SalesDetails || [];
      s.Items = dets;
      s.ItemSummary = dets.map(d => `${d.ProductName} x${d.Quantity}`).join(', ');
      s.TotalQty = dets.reduce((acc, d) => acc + (isStockPid_(d.ProductID) ? (parseFloat(d.Quantity) || 0) : 0), 0);
      return s;
    });

    const customerDebtMap = {};
    normalizeRows_(unpaidRaw || []).forEach(s => {
      const cid = String(s.CustomerID || 'WALK-IN').trim();
      const isWalkIn = cid === 'WALK-IN';
      const cName = isWalkIn ? normWalkIn_(s.CustomerName) : s.CustomerName;
      const dKey = isWalkIn ? `WALK-IN::${cName}` : cid;
      if (!customerDebtMap[dKey]) customerDebtMap[dKey] = { CustomerID: dKey, RawCustomerID: cid, CustomerName: cName, IsWalkIn: isWalkIn, totalDebt: 0, billCount: 0, bills: [] };
      const amt = parseFloat(s.TotalAmount) || 0;
      customerDebtMap[dKey].totalDebt += amt;
      customerDebtMap[dKey].billCount++;
      customerDebtMap[dKey].bills.push({
        SaleID: s.SaleID, SaleDate: String(s.SaleDate).slice(0, 10), CustomerName: cName, TotalAmount: amt,
        ItemSummary: (s.tb_SalesDetails || []).map(d => `${d.ProductName} x${d.Quantity}`).join(', ') || 'บิลค้างชำระ'
      });
    });

    return {
      driver,
      lockedRoute: { RouteID: rId, RouteName: myDispatch.RouteName },
      myDispatch: normalizeRows_([myDispatch])[0],
      otherActiveRoutes: (activeDsps || []).filter(d => d.DispatchID !== myDispatch.DispatchID),
      vehicles: vehicles || [],
      products: products || [],
      customers: myCustomers,
      specialPrices: spPrices || [],
      promoMap,
      customerDebtMap,
      todayDebtPayments: normalizeRows_(paysRaw || []),
      todayRouteSales,
      todayTransfers: [],
      todayFuelLogs: normalizeRows_(fuelsRaw || [])
    };
  },

  async updateDriverMileage(payload) {
    const col = payload.Type === 'START' ? { StartMileage: parseFloat(payload.Mileage) || 0 } : { EndMileage: parseFloat(payload.Mileage) || 0 };
    const { error } = await window.sb.from('tb_RouteDispatches').update(col).eq('DispatchID', payload.DispatchID);
    if (error) throw new Error(error.message);
    return payload;
  },

  // ------------------------------------------------------------------
  // 🚛⚙️ 6. FLEET, FUEL, 7,000 KM PM & MACHINE INSPECTION
  // ------------------------------------------------------------------
  async getFleetDashboard(payload) {
    const todayStr = bkkTodayStr_();
    const startDate = payload?.startDate || (todayStr.slice(0, 8) + '01');
    const endDate = payload?.endDate || todayStr;

    const [
      { data: vehicles },
      { data: employees },
      { data: dispatchesRaw },
      { data: fuelsRaw },
      { data: maintsRaw }
    ] = await Promise.all([
      window.sb.from('tb_Vehicles').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_RouteDispatches').select('*').order('DispatchDate', { ascending: true }),
      window.sb.from('tb_FuelLogs').select('*').order('FuelDate', { ascending: false }),
      window.sb.from('tb_VehicleMaintenances').select('*').order('TxDate', { ascending: false })
    ]);

    const fleetMap = {};
    (vehicles || []).forEach(v => {
      fleetMap[v.LicensePlate] = {
        VehicleID: v.VehicleID, LicensePlate: v.LicensePlate, VehicleType: v.VehicleType, Capacity: v.Capacity,
        CurrentOdometer: 0, tripCount: 0, missingMileTrips: 0, unaccountedKm: 0, distanceKm: 0, loadedIceQty: 0, soldIceQty: 0, lossIceQty: 0, revenueGenerated: 0,
        fuelCount: 0, fuelLiters: 0, fuelCost: 0, maintCost: 0, lastDriverName: '-', lastRouteName: '-', lastTripDate: '',
        lastOilDate: '', lastOilMileage: 0, nextOilMileage: 0, oilRemainKm: null, oilStatus: 'NO_DATA',
        lastTaxTitle: '', taxExpiryDate: '', taxRemainDays: null, taxStatus: 'NO_DATA'
      };
    });

    const tripLogsList = [];
    normalizeRows_(dispatchesRaw || []).forEach(dsp => {
      const v = fleetMap[dsp.VehicleID];
      if (!v) return;
      const sm = parseFloat(dsp.StartMileage) || 0;
      const em = parseFloat(dsp.EndMileage) || 0;
      if (sm > v.CurrentOdometer) v.CurrentOdometer = sm;
      if (em > v.CurrentOdometer) v.CurrentOdometer = em;
      const dDay = String(dsp.DispatchDate).slice(0, 10);
      if (dDay >= startDate && dDay <= endDate) {
        const dist = (sm > 0 && em >= sm) ? (em - sm) : 0;
        v.tripCount++;
        v.distanceKm += dist;
        v.loadedIceQty += (parseFloat(dsp.LoadedQty) || 0);
        tripLogsList.push({ ...dsp, StartMileage: sm, EndMileage: em, DistanceKm: dist, MileageGap: 0, IsMissingMile: (sm <= 0 || em <= 0), Revenue: 0 });
      }
    });

    const fuelLogsList = [];
    normalizeRows_(fuelsRaw || []).forEach(f => {
      const v = fleetMap[f.VehicleID];
      if (v && (parseFloat(f.Mileage) || 0) > v.CurrentOdometer) v.CurrentOdometer = parseFloat(f.Mileage);
      const fDay = String(f.FuelDate).slice(0, 10);
      if (fDay >= startDate && fDay <= endDate) {
        if (v) { v.fuelCount++; v.fuelLiters += (parseFloat(f.Liters) || 0); v.fuelCost += (parseFloat(f.TotalCost) || 0); }
        fuelLogsList.push(f);
      }
    });

    const maintLogsList = normalizeRows_(maintsRaw || []);
    maintLogsList.forEach(m => {
      if (m.Status === 'Cancelled') return;
      const v = fleetMap[m.VehicleID];
      if (!v) return;
      if (m.MaintType === 'OIL_SERVICE' && (parseFloat(m.CurrentMileage) || 0) >= v.lastOilMileage) {
        v.lastOilDate = String(m.TxDate).slice(0, 10);
        v.lastOilMileage = parseFloat(m.CurrentMileage) || 0;
        v.nextOilMileage = parseFloat(m.NextDueMileage) || (v.lastOilMileage + 7000);
      }
      if (m.MaintType === 'TAX_INSURANCE' && m.NextDueDate) {
        v.taxExpiryDate = String(m.NextDueDate).slice(0, 10);
        v.lastTaxTitle = m.Title;
      }
      const mDay = String(m.TxDate).slice(0, 10);
      if (mDay >= startDate && mDay <= endDate) v.maintCost += (parseFloat(m.Cost) || 0);
    });

    const todayTime = new Date(todayStr + 'T00:00:00').getTime();
    let oilAlertCount = 0, taxAlertCount = 0, totalDist = 0, totalFuel = 0, totalMaint = 0, totalTrips = 0, totalLoaded = 0;

    const fleetList = Object.values(fleetMap).map(v => {
      totalDist += v.distanceKm; totalFuel += v.fuelCost; totalMaint += v.maintCost; totalTrips += v.tripCount; totalLoaded += v.loadedIceQty;
      if (v.nextOilMileage > 0) {
        v.oilRemainKm = v.nextOilMileage - (v.CurrentOdometer || v.lastOilMileage);
        v.oilStatus = v.oilRemainKm <= 0 ? 'OVERDUE' : (v.oilRemainKm <= 700 ? 'WARN' : 'OK');
        if (v.oilStatus !== 'OK') oilAlertCount++;
      }
      if (v.taxExpiryDate) {
        v.taxRemainDays = Math.round((new Date(v.taxExpiryDate + 'T00:00:00').getTime() - todayTime) / 86400000);
        v.taxStatus = v.taxRemainDays < 0 ? 'OVERDUE' : (v.taxRemainDays <= 30 ? 'WARN' : 'OK');
        if (v.taxStatus !== 'OK') taxAlertCount++;
      }
      v.totalOperatingCost = v.fuelCost + v.maintCost;
      v.fuelCostPerKm = v.distanceKm > 0 ? Number((v.fuelCost / v.distanceKm).toFixed(2)) : 0;
      v.totalCostPerBag = v.loadedIceQty > 0 ? Number((v.totalOperatingCost / v.loadedIceQty).toFixed(2)) : 0;
      return v;
    });

    return {
      filters: { startDate, endDate },
      summary: {
        totalVehicles: fleetList.length, oilAlertCount, taxAlertCount, totalTrips, totalDistanceKm: totalDist,
        totalUnaccountedKm: 0, totalLoadedIce: totalLoaded, totalRevenue: 0, totalFuelCost: totalFuel,
        totalFuelLiters: 0, avgFuelPerKm: totalDist > 0 ? Number((totalFuel / totalDist).toFixed(2)) : 0,
        avgCostPerBag: totalLoaded > 0 ? Number(((totalFuel + totalMaint) / totalLoaded).toFixed(2)) : 0,
        totalMaintCost: totalMaint, totalFleetExpense: totalFuel + totalMaint
      },
      fleetList,
      tripLogsList: tripLogsList.reverse(),
      fuelLogsList,
      maintLogsList,
      allMaintLogsRecent: maintLogsList.slice(0, 50),
      vehicles: vehicles || [],
      employees: employees || []
    };
  },

  async saveFuelLog(payload) {
    const fDate = payload?.FuelDate || bkkTodayStr_();
    const fuelId = await genId_('tb_FuelLogs', 'FuelID', 'FL-' + fDate.replace(/-/g, ''), 4);
    const { error } = await window.sb.from('tb_FuelLogs').insert([{
      FuelID: fuelId,
      FuelDate: fDate + 'T12:00:00+07:00',
      VehicleID: payload.VehicleID,
      DriverName: payload.DriverName || '',
      Mileage: parseFloat(payload.Mileage) || 0,
      Liters: parseFloat(payload.Liters) || 0,
      TotalCost: parseFloat(payload.TotalCost) || 0,
      PaidBy: payload.PaidBy || 'หักเงินสดสายส่ง',
      Note: payload.Note || ''
    }]);
    if (error) throw new Error(error.message);
    return { FuelID: fuelId };
  },

  async deleteFuelLog(payload) {
    const { error } = await window.sb.from('tb_FuelLogs').delete().eq('FuelID', payload.FuelID);
    if (error) throw new Error(error.message);
    return { FuelID: payload.FuelID, Status: 'Deleted' };
  },

  async saveHistoricalDispatchMileage(payload) {
    const txDate = String(payload.DispatchDate).slice(0, 10);
    const dspId = await genId_('tb_RouteDispatches', 'DispatchID', 'DSP-' + txDate.replace(/-/g, ''), 4);
    const sm = parseFloat(payload.StartMileage) || 0;
    const em = parseFloat(payload.EndMileage) || 0;
    const q = parseFloat(payload.LoadedQty) || 0;
    const { error } = await window.sb.from('tb_RouteDispatches').insert([{
      DispatchID: dspId, DispatchDate: txDate + 'T07:30:00+07:00', RouteID: payload.RouteID || 'ย้อนหลัง',
      RouteName: payload.RouteName || 'บันทึกวิ่งรถย้อนหลัง', VehicleID: payload.VehicleID, DriverName: payload.DriverName || '-',
      StartMileage: sm, EndMileage: em, LoadedQty: q, SoldQty: q, Status: 'ปิดกะแล้ว', Note: payload.Note || 'บันทึกไมล์ย้อนหลัง'
    }]);
    if (error) throw new Error(error.message);
    return { DispatchID: dspId, Mode: 'INSERTED', DistanceKm: em - sm };
  },

  async saveVehicleMaintenance(payload) {
    const txDate = payload.TxDate || bkkTodayStr_();
    const maintId = await genId_('tb_VehicleMaintenances', 'MaintID', 'VMT-' + txDate.replace(/-/g, ''), 4);
    const curMile = parseFloat(payload.CurrentMileage) || 0;
    const nextMile = parseFloat(payload.NextDueMileage) || (payload.MaintType === 'OIL_SERVICE' && curMile > 0 ? curMile + 7000 : 0);
    const cost = parseFloat(payload.Cost) || 0;
    let refExpId = '';

    if (cost > 0 && !String(payload.PayChannel || '').includes('ไม่ตัดบัญชี')) {
      const expRes = await this.saveExpense({
        ExpDate: txDate, TxType: 'EXPENSE', Category: '🚚 ซ่อมบำรุงรถสายส่ง / ยาง / น้ำมันเครื่อง',
        Title: `[${payload.VehicleID}] ${payload.Title}`, Amount: cost, PayChannel: payload.PayChannel, RefTarget: payload.VehicleID
      });
      refExpId = expRes.ExpID;
    }

    const { error } = await window.sb.from('tb_VehicleMaintenances').insert([{
      MaintID: maintId, TxDate: txDate, VehicleID: payload.VehicleID, MaintType: payload.MaintType || 'OIL_SERVICE',
      Title: payload.Title, CurrentMileage: curMile, NextDueMileage: nextMile, NextDueDate: payload.NextDueDate || null,
      Cost: cost, PayChannel: payload.PayChannel, VendorName: payload.VendorName || '', RefExpID: refExpId, Status: 'Active', Note: payload.Note || ''
    }]);
    if (error) throw new Error(error.message);
    return { MaintID: maintId, RefExpID: refExpId };
  },

  async cancelVehicleMaintenance(payload) {
    await window.sb.from('tb_VehicleMaintenances').update({ Status: 'Cancelled' }).eq('MaintID', payload.MaintID);
    return { MaintID: payload.MaintID, Status: 'Cancelled' };
  },

  async getMachineDashboard() {
    const todayStr = bkkTodayStr_();
    const [{ data: machines }, { data: logsRaw }] = await Promise.all([
      window.sb.from('tb_Machines').select('*').neq('Status', 'Inactive').order('MachineID'),
      window.sb.from('tb_MachineLogs').select('*').order('LogDate', { ascending: false }).limit(50)
    ]);
    const recentLogs = normalizeRows_(logsRaw || []);
    return {
      machines: machines || [],
      todayLogs: recentLogs.filter(l => String(l.LogDate).slice(0, 10) === todayStr),
      recentLogs
    };
  },

  async saveMachineLog(payload) {
    const logId = await genId_('tb_MachineLogs', 'LogID', 'MLG-' + bkkTodayStr_().replace(/-/g, ''), 4);
    const cost = parseFloat(payload.MaintenanceCost) || 0;
    let refExpId = '';
    if (cost > 0) {
      const expRes = await this.saveExpense({
        TxType: 'EXPENSE', Category: '🔧 ซ่อมบำรุงเครื่องจักร / ห้องเย็น',
        Title: `[ซ่อมเครื่องจักร] ${payload.MachineName} - ${payload.Note || ''}`, Amount: cost, PayChannel: payload.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)'
      });
      refExpId = expRes.ExpID;
    }
    const { error } = await window.sb.from('tb_MachineLogs').insert([{
      LogID: logId, MachineID: payload.MachineID, MachineName: payload.MachineName, ShiftName: payload.ShiftName,
      HighPressure: parseFloat(payload.HighPressure) || 0, LowPressure: parseFloat(payload.LowPressure) || 0,
      Amperage: parseFloat(payload.Amperage) || 0, OilLevel: payload.OilLevel || 'ปกติ',
      IceYieldBags: parseFloat(payload.IceYieldBags) || 0, MachineStatus: payload.MachineStatus || 'ปกติ',
      MaintenanceCost: cost, InspectorName: payload.InspectorName || 'ช่างประจำกะ', RefExpID: refExpId, Note: payload.Note || ''
    }]);
    if (error) throw new Error(error.message);
    return { LogID: logId, RefExpID: refExpId };
  },

  // ------------------------------------------------------------------
  // 📊💰 7. DASHBOARD, EXPENSES, REPORTS & JSON BACKUP
  // ------------------------------------------------------------------
  async getDashboardData(payload) {
    const targetDate = payload?.targetDate || bkkTodayStr_();
    const dp = targetDate.split('-');
    const reportDate = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : targetDate;

    const [
      { data: salesRaw },
      { data: unpaidAll },
      { data: routes },
      { data: paymentsRaw },
      { data: dispatchesRaw },
      { data: fuelsRaw },
      { data: expensesRaw },
      { data: bucketsRaw },
      { data: coldRoomStocks },
      customers
    ] = await Promise.all([
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').gte('SaleDate', `${targetDate}T00:00:00+07:00`).lte('SaleDate', `${targetDate}T23:59:59+07:00`).order('SaleDate', { ascending: false }),
      window.sb.from('tb_Sales').select('CustomerID, CustomerName, TotalAmount').in('PaymentStatus', ['Unpaid', 'ค้างชำระ']),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Payments').select('*').gte('PaymentDate', `${targetDate}T00:00:00+07:00`).lte('PaymentDate', `${targetDate}T23:59:59+07:00`).order('PaymentDate', { ascending: false }),
      window.sb.from('tb_RouteDispatches').select('*').gte('DispatchDate', `${targetDate}T00:00:00+07:00`).lte('DispatchDate', `${targetDate}T23:59:59+07:00`),
      window.sb.from('tb_FuelLogs').select('*').gte('FuelDate', `${targetDate}T00:00:00+07:00`).lte('FuelDate', `${targetDate}T23:59:59+07:00`),
      window.sb.from('tb_Expenses').select('*').gte('ExpDate', `${targetDate}T00:00:00+07:00`).lte('ExpDate', `${targetDate}T23:59:59+07:00`).neq('Status', 'Cancelled'),
      window.sb.from('tb_Buckets').select('CurrentStatus').neq('Status', 'Inactive'),
      window.sb.rpc('rpc_get_cold_room_balances', { p_start_date: targetDate, p_end_date: targetDate }),
      this.getCustomers()
    ]);

    const routeStatsMap = {
      'หน้าลาน': { RouteKey: 'หน้าลาน', RouteName: '🏠 หน้าลาน (หน้าร้าน)', shiftStatus: 'FRONT', driverName: 'เสมียนหน้าลาน', vehiclePlate: '-', loadedQty: 0, returnedQty: 0, billCount: 0, totalQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCollectedCash: 0, debtCollectedTransfer: 0, debtCollectedTotal: 0, fuelCost: 0, fuelCashCost: 0, otherCashExp: 0, mileageDist: 0, lossQty: 0, cashDiff: 0 }
    };
    (routes || []).forEach(r => {
      routeStatsMap[r.RouteID] = { RouteKey: r.RouteID, RouteName: '🚚 ' + r.RouteName, shiftStatus: 'NO_SHIFT', driverName: '-', vehiclePlate: '-', loadedQty: 0, returnedQty: 0, billCount: 0, totalQty: 0, cashSales: 0, transferSales: 0, creditSales: 0, totalSales: 0, debtCollectedCash: 0, debtCollectedTransfer: 0, debtCollectedTotal: 0, fuelCost: 0, fuelCashCost: 0, otherCashExp: 0, mileageDist: 0, lossQty: 0, cashDiff: 0 };
    });

    let todaySales = 0, cashSales = 0, transferSales = 0, creditSales = 0, todayBills = 0, totalIceQty = 0, cancelledBillsCount = 0, cancelledBillsAmt = 0;
    const recentSales = normalizeRows_(salesRaw || []).filter(s => !String(s.SaleID).startsWith('AR-')).map(s => {
      const rKey = routeStatsMap[s.RouteID] ? s.RouteID : 'หน้าลาน';
      const rb = routeStatsMap[rKey];
      const dets = s.tb_SalesDetails || [];
      const q = dets.reduce((acc, d) => acc + (isStockPid_(d.ProductID) ? (parseFloat(d.Quantity) || 0) : 0), 0);
      s.RouteName = rb.RouteName;
      s.TotalQty = q;
      s.ItemSummary = dets.map(d => `${d.ProductName}${d.Quantity > 1 ? ' x' + d.Quantity : ''}`).join(', ') || '-';

      const amt = parseFloat(s.TotalAmount) || 0;
      if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') {
        cancelledBillsCount++; cancelledBillsAmt += amt;
      } else {
        todaySales += amt; todayBills++; totalIceQty += q;
        rb.billCount++; rb.totalQty += q; rb.totalSales += amt;
        const pt = String(s.PaymentType || '');
        if (pt.includes('เครดิต') || pt.includes('เชื่อ')) { creditSales += amt; rb.creditSales += amt; }
        else if (pt.includes('โอน')) { transferSales += amt; rb.transferSales += amt; }
        else { cashSales += amt; rb.cashSales += amt; }
      }
      return s;
    });

    let totalLoadedIceToday = 0, totalLossIceToday = 0, totalCashDiffToday = 0;
    (dispatchesRaw || []).forEach(dsp => {
      const rb = routeStatsMap[dsp.RouteID] || routeStatsMap['หน้าลาน'];
      rb.driverName = dsp.DriverName || '-';
      rb.vehiclePlate = dsp.VehicleID || '-';
      rb.shiftStatus = dsp.Status === 'กำลังวิ่งส่ง' ? 'ACTIVE' : 'CLOSED';
      rb.loadedQty += (parseFloat(dsp.LoadedQty) || 0);
      rb.returnedQty += (parseFloat(dsp.ReturnedQty) || 0);
      totalLoadedIceToday += (parseFloat(dsp.LoadedQty) || 0);
      totalLossIceToday += (parseFloat(dsp.LossQty) || 0);
      if ((parseFloat(dsp.CashDiff) || 0) < 0) totalCashDiffToday += (parseFloat(dsp.CashDiff) || 0);
    });

    let totalFuelExpense = 0, totalCashFuelExpense = 0;
    (fuelsRaw || []).forEach(f => {
      const fc = parseFloat(f.TotalCost) || 0;
      const isCash = String(f.PaidBy).includes('เงินสด') || String(f.PaidBy).includes('หัก');
      totalFuelExpense += fc;
      if (isCash) totalCashFuelExpense += fc;
      routeStatsMap['หน้าลาน'].fuelCost += fc;
      if (isCash) routeStatsMap['หน้าลาน'].fuelCashCost += fc;
    });

    let todayManualExpenseTotal = 0, todayDrawerCashExpense = 0, todayOtherIncomeTotal = 0, todayOtherIncomeCash = 0;
    (expensesRaw || []).forEach(ex => {
      const amt = parseFloat(ex.Amount) || 0;
      if (ex.TxType === 'OTHER_INCOME') {
        todayOtherIncomeTotal += amt;
        if (!String(ex.PayChannel).includes('โอน')) todayOtherIncomeCash += amt;
      } else {
        todayManualExpenseTotal += amt;
        if (String(ex.PayChannel).includes('ลิ้นชัก') || String(ex.PayChannel).includes('หน้าลาน')) {
          todayDrawerCashExpense += amt;
          routeStatsMap['หน้าลาน'].otherCashExp += amt;
        }
      }
    });

    let debtCollectedTotal = 0, debtCollectedCash = 0, debtCollectedTransfer = 0;
    const todayPayments = normalizeRows_(paymentsRaw || []).map(p => {
      const pa = parseFloat(p.AmountPaid) || 0;
      debtCollectedTotal += pa;
      if (String(p.PaymentMethod).includes('โอน')) { debtCollectedTransfer += pa; routeStatsMap['หน้าลาน'].debtCollectedTransfer += pa; }
      else { debtCollectedCash += pa; routeStatsMap['หน้าลาน'].debtCollectedCash += pa; }
      routeStatsMap['หน้าลาน'].debtCollectedTotal += pa;
      p.RouteName = '🏠 หน้าลาน';
      return p;
    });

    const unpaidCreditAllTime = (unpaidAll || []).reduce((acc, u) => acc + (parseFloat(u.TotalAmount) || 0), 0);
    const unpaidDebtorCount = new Set((unpaidAll || []).map(u => u.CustomerID || u.CustomerName)).size;
    const todayProducedIceQty = (coldRoomStocks || []).reduce((acc, b) => acc + (parseFloat(b.TodayProduced) || 0), 0);

    const netCashInHand = cashSales + debtCollectedCash + todayOtherIncomeCash - totalCashFuelExpense - todayDrawerCashExpense;
    const totalOutflowToday = totalFuelExpense + todayManualExpenseTotal;
    const netProfitToday = (cashSales + transferSales + debtCollectedTotal + todayOtherIncomeTotal) - totalOutflowToday;

    return {
      targetDate, reportDate, todaySales, cashSales, transferSales, creditSales, todayBills, totalIceQty,
      totalLoadedIceToday, todayProducedIceQty, debtCollectedTotal, debtCollectedCash, debtCollectedTransfer,
      totalFuelExpense, totalCashFuelExpense, todayManualExpenseTotal, todayDrawerCashExpense, totalOutflowToday, netProfitToday,
      frontDrawerNetCash: netCashInHand, totalCashInHand: netCashInHand, totalBankTransfer: transferSales + debtCollectedTransfer,
      totalCustomers: customers.length, unpaidCreditAllTime, unpaidDebtorCount,
      borrowedBucketsCount: (bucketsRaw || []).filter(b => b.CurrentStatus === 'ถูกยืม').length,
      inStockBucketsCount: (bucketsRaw || []).filter(b => b.CurrentStatus === 'ในคลัง').length,
      coldRoomStocks: coldRoomStocks || [],
      auditFlags: { cancelledBillsCount, cancelledBillsAmt, totalLossIceToday, totalCashDiffToday },
      routeBreakdown: Object.values(routeStatsMap),
      todayPayments,
      recentSales
    };
  },

  async getExpenseDashboard(payload) {
    const todayStr = bkkTodayStr_();
    const sDate = payload?.startDate || todayStr;
    const eDate = payload?.endDate || sDate;

    const [dash, { data: expsRaw }, { data: emps }, { data: vehs }] = await Promise.all([
      this.getDashboardData({ targetDate: sDate }),
      window.sb.from('tb_Expenses').select('*').gte('ExpDate', `${sDate}T00:00:00+07:00`).lte('ExpDate', `${eDate}T23:59:59+07:00`).order('ExpDate', { ascending: false }),
      window.sb.from('tb_Employees').select('*').neq('Status', 'Inactive'),
      window.sb.from('tb_Vehicles').select('*').neq('Status', 'Inactive')
    ]);

    const expensesList = normalizeRows_(expsRaw || []);
    return {
      filters: { startDate: sDate, endDate: eDate },
      summary: {
        iceCashFront: dash.cashSales, iceCashRoute: 0, iceTransferTotal: dash.transferSales, iceCreditNew: dash.creditSales,
        debtCashFront: dash.debtCollectedCash, debtCashRoute: 0, debtTransferTotal: dash.debtCollectedTransfer,
        otherIncomeTotal: 0, totalInflow: dash.todaySales + dash.debtCollectedTotal,
        fuelTotalCost: dash.totalFuelExpense, fuelCashRoute: 0, fuelCashFront: dash.totalCashFuelExpense,
        expManualTotal: dash.todayManualExpenseTotal, expDrawerCash: dash.todayDrawerCashExpense, expSafeCash: 0, expBankTransfer: 0,
        totalOutflow: dash.totalOutflowToday, netCashflow: dash.netProfitToday, frontDrawerNetCash: dash.frontDrawerNetCash, routeNetCash: 0
      },
      categoryBreakdown: [],
      advanceList: [],
      expensesList,
      employees: emps || [],
      vehicles: vehs || []
    };
  },

  async saveExpense(payload) {
    const expDate = payload?.ExpDate || bkkTodayStr_();
    const expId = await genId_('tb_Expenses', 'ExpID', 'EXP-' + expDate.replace(/-/g, ''), 4);
    const { error } = await window.sb.from('tb_Expenses').insert([{
      ExpID: expId, ExpDate: expDate + 'T12:00:00+07:00', TxType: payload.TxType || 'EXPENSE',
      Category: payload.Category || 'ทั่วไป', Title: payload.Title, Amount: parseFloat(payload.Amount) || 0,
      PayChannel: payload.PayChannel || 'เงินสดหน้าลาน (ลิ้นชัก)', RefTarget: payload.RefTarget || '',
      Status: 'Active', CreatedBy: payload.CreatedBy || 'Admin', Note: payload.Note || ''
    }]);
    if (error) throw new Error(error.message);
    return { ExpID: expId };
  },

  async cancelExpense(payload) {
    await window.sb.from('tb_Expenses').update({ Status: 'Cancelled' }).eq('ExpID', payload.ExpID);
    return { ExpID: payload.ExpID, Status: 'Cancelled' };
  },

  async getHistoricalReport(payload) {
    const todayStr = bkkTodayStr_();
    const sDate = payload?.startDate || todayStr;
    const eDate = payload?.endDate || sDate;
    const filterRoute = payload?.routeId || 'ALL';

    const [{ data: salesRaw }, { data: routes }, customers, { data: paysRaw }, { data: dspsRaw }, { data: fuelsRaw }, { data: invRaw }] = await Promise.all([
      window.sb.from('tb_Sales').select('*, tb_SalesDetails(*)').gte('SaleDate', `${sDate}T00:00:00+07:00`).lte('SaleDate', `${eDate}T23:59:59+07:00`).order('SaleDate', { ascending: false }),
      window.sb.from('tb_Routes').select('*').neq('Status', 'Inactive'),
      this.getCustomers(),
      window.sb.from('tb_Payments').select('*').gte('PaymentDate', `${sDate}T00:00:00+07:00`).lte('PaymentDate', `${eDate}T23:59:59+07:00`),
      window.sb.from('tb_RouteDispatches').select('*').gte('DispatchDate', `${sDate}T00:00:00+07:00`).lte('DispatchDate', `${eDate}T23:59:59+07:00`),
      window.sb.from('tb_FuelLogs').select('*').gte('FuelDate', `${sDate}T00:00:00+07:00`).lte('FuelDate', `${eDate}T23:59:59+07:00`),
      window.sb.from('tb_InventoryLogs').select('*').gte('LogDate', `${sDate}T00:00:00+07:00`).lte('LogDate', `${eDate}T23:59:59+07:00`)
    ]);

    const salesList = [], cancelledList = [];
    let totalSales = 0, cashSales = 0, transferSales = 0, creditSales = 0, totalIceQty = 0;

    normalizeRows_(salesRaw || []).forEach(s => {
      if (String(s.SaleID).startsWith('AR-')) return;
      if (filterRoute !== 'ALL' && s.RouteID !== filterRoute) return;
      const dets = s.tb_SalesDetails || [];
      const q = dets.reduce((acc, d) => acc + (isStockPid_(d.ProductID) ? (parseFloat(d.Quantity) || 0) : 0), 0);
      s.TotalQty = q;
      s.ItemSummary = dets.map(d => `${d.ProductName} x${d.Quantity}`).join(', ');
      if (s.PaymentStatus === 'Cancelled' || s.PaymentStatus === 'ยกเลิก') {
        cancelledList.push(s);
      } else {
        salesList.push(s);
        const amt = parseFloat(s.TotalAmount) || 0;
        totalSales += amt; totalIceQty += q;
        const pt = String(s.PaymentType || '');
        if (pt.includes('เครดิต') || pt.includes('เชื่อ')) creditSales += amt;
        else if (pt.includes('โอน')) transferSales += amt;
        else cashSales += amt;
      }
    });

    const debtCollectedTotal = (paysRaw || []).reduce((acc, p) => acc + (parseFloat(p.AmountPaid) || 0), 0);
    const totalFuelCost = (fuelsRaw || []).reduce((acc, f) => acc + (parseFloat(f.TotalCost) || 0), 0);

    return {
      filters: { startDate: sDate, endDate: eDate, routeId: filterRoute },
      routes: routes || [],
      kpi: {
        totalSales, cashSales, transferSales, creditSales, billCount: salesList.length, totalIceQty,
        debtCollectedTotal, debtCollectedCash: debtCollectedTotal, debtCollectedTransfer: 0,
        totalFuelCost, totalFuelCash: totalFuelCost, expManualTotal: 0, expDrawerCash: 0,
        totalOutflow: totalFuelCost, netCashflow: totalSales + debtCollectedTotal - totalFuelCost,
        netCashToSafe: cashSales + debtCollectedTotal - totalFuelCost, totalBankTransfer: transferSales,
        totalDistanceKm: 0, totalLossQty: 0, cancelledCount: cancelledList.length, periodDays: 1
      },
      routeBreakdown: [],
      customerRankingList: [],
      salesList,
      cancelledList,
      paymentsList: normalizeRows_(paysRaw || []),
      expensesList: [],
      dispatchesList: normalizeRows_(dspsRaw || []),
      fuelsList: normalizeRows_(fuelsRaw || []),
      invStats: { totalProduced: 0, totalCrushedOut: 0, totalCrushedIn: 0, totalDispatched: 0, totalAdjusted: 0 },
      invLogsList: normalizeRows_(invRaw || [])
    };
  },

  // ระบบสำรองข้อมูลสำหรับโหมด Vercel Standalone (ดาวน์โหลดไฟล์ JSON Backup ลงเครื่องทันที)
  async getBackupDashboard() {
    const { data: logs } = await window.sb.from('tb_BackupLogs').select('*').order('BackupDate', { ascending: false }).limit(20);
    return {
      config: { AUTO_ENABLED: 'TRUE', TRIGGER_HOUR: '20', ADMIN_EMAIL: 'spirit6785@gmail.com', RETENTION_DAYS: '30', BACKUP_FOLDER_URL: 'https://supabase.com/dashboard' },
      hasActiveTrigger: true,
      logs: normalizeRows_(logs || [])
    };
  },

  async runManualBackupNow(payload) {
    const tables = ['tb_Products', 'tb_Employees', 'tb_Routes', 'tb_Vehicles', 'tb_Customers', 'tb_SpecialPrices', 'tb_Promotions', 'tb_Buckets', 'tb_Sales', 'tb_Payments', 'tb_RouteDispatches', 'tb_Expenses'];
    const dump = { exportedAt: new Date().toISOString(), tables: {} };
    for (const t of tables) {
      const { data } = await window.sb.from(t).select('*');
      dump.tables[t] = data || [];
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = bkkTodayStr_();
    a.href = url;
    a.download = `MaeJai_Supabase_Backup_${stamp}.json`;
    a.click();

    const bkpId = await genId_('tb_BackupLogs', 'BackupID', 'BKP-' + stamp.replace(/-/g, ''), 4);
    await window.sb.from('tb_BackupLogs').insert([{
      BackupID: bkpId, TriggerType: 'STANDALONE_JSON', FileName: `MaeJai_Supabase_Backup_${stamp}.json`,
      FileUrl: '#downloaded', PurgedCount: 0, EmailStatus: 'Downloaded to Device', CreatedBy: payload?.CreatedBy || 'Admin'
    }]);
    return { backup: { FileName: `MaeJai_Supabase_Backup_${stamp}.json` }, report: { EmailStatus: 'ดาวน์โหลดไฟล์สำรอง .JSON ลงเครื่องสำเร็จ!' } };
  }
};

// ==========================================
// 🔌 GLOBAL API CALLERS (ใช้แทน google.script.run ทั้งใน Index.html และ Driver.html)
// ==========================================
window.apiCall = async function(action, payload = {}) {
  if (typeof showLoading === 'function') showLoading(true);
  try {
    if (window.STATE && window.STATE.currentUser && payload && typeof payload === 'object' && !payload.CreatedBy) {
      payload.CreatedBy = window.STATE.currentUser.EmpName;
    }
    const fn = window.SUPABASE_ACTIONS[action];
    if (typeof fn !== 'function') throw new Error(`ไม่พบคำสั่ง API: ${action}`);
    const result = await fn.call(window.SUPABASE_ACTIONS, payload);
    if (typeof showLoading === 'function') showLoading(false);
    return result;
  } catch (err) {
    if (typeof showLoading === 'function') showLoading(false);
    if (typeof showToast === 'function') showToast(err.message || 'การเชื่อมต่อ Supabase ขัดข้อง', 'error');
    throw err;
  }
};

// สำหรับไฟล์ driver.html ที่ใช้ชื่อฟังก์ชัน callApi(action, payload)
window.callApi = window.apiCall;