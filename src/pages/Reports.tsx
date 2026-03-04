import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, BarChart3, List, Layers, FileSpreadsheet, X, ChevronDown, ChevronRight, Filter, AlertCircle, Bell, ExternalLink, Edit2, Check, Link as LinkIcon, Search, Trash2 } from 'lucide-react';
import { fetchFinancialReport } from '../utils/api';
import { exportToExcel } from '../utils/excel';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

const KEY_TRANSLATIONS: Record<string, string> = {
  rrd_id: "Номер строки", rr_dt: "Дата операции", create_dt: "Дата формирования", doc_type_name: "Тип документа",
  supplier_oper_name: "Обоснование для оплаты", shk_id: "Штрих-код", nm_id: "Артикул WB", sa_name: "Артикул продавца",
  subject_name: "Предмет", brand_name: "Бренд", ts_name: "Размер", barcode: "Баркод", quantity: "Количество",
  retail_price: "Цена розничная", retail_amount: "Сумма продаж", ppvz_for_pay: "К перечислению продавцу",
  delivery_rub: "Стоимость логистики", penalty: "Штрафы", deduction: "Удержания", acceptance: "Платная приемка",
  rebill_logistic_cost: "Сумма сторнирования", retail_price_withdisc_rub: "Цена розничная со скидкой",
  sale_percent: "Согласованная скидка", commission_percent: "Процент комиссии", office_name: "Склад",
  order_dt: "Дата заказа", sale_dt: "Дата продажи", delivery_amount: "Количество доставок",
  return_amount: "Количество возвратов", gi_box_type_name: "Тип коробов", product_discount_for_report: "Продуктовый дисконт",
  supplier_promo: "Промокод", ppvz_spp_prc: "СПП", ppvz_kvw_prc_base: "Базовый кВВ", ppvz_kvw_prc: "Итоговый кВВ",
  sup_rating_prc_up: "Надбавка за рейтинг", is_kgvp_v2: "КГТ", ppvz_sales_commission: "Вознаграждение с продаж",
  ppvz_reward: "Возмещение за ПВЗ", acquiring_fee: "Эквайринг (сумма)", acquiring_percent: "Эквайринг (%)",
  acquiring_bank: "Банк-эквайер", ppvz_vw: "Вознаграждение WB", ppvz_vw_nds: "НДС с WB", ppvz_office_name: "Офис доставки",
  ppvz_office_id: "Номер офиса", ppvz_supplier_name: "Партнер", ppvz_inn: "ИНН партнера", declaration_number: "Номер ТД",
  bonus_type_name: "Обоснование штрафов", sticker_id: "Аналитический код", site_country: "Страна продажи",
  srv_dbs: "Cервис DBS", additional_payment: "Доплаты", storage_fee: "Стоимость хранения", assembly_id: "Номер сборки",
  kiz: "Код маркировки", srid: "Srid (Уникальный ID заказа)", report_type: "Тип отчета", is_legal_entity: "Юр. лицо",
  trbx_id: "Номер заказа", installment_cofinancing_amount: "Софинансирование рассрочки",
  wibes_wb_discount_percent: "Скидка лояльности", cashback_amount: "Кешбэк", cashback_discount: "Скидка за кешбэк",
  order_uid: "Уникальный ID (UID)", realizationreport_id: "ID отчета", date_from: "Начало периода", date_to: "Конец периода",
};

const ITEMS_PER_LOAD = 50;

const getPriceForDate = (nmId: number, targetDate: string, prices: any[]) => {
  if (!nmId || !targetDate) return 0;
  const itemPrices = prices.filter(p => p.nmId === nmId);
  if (itemPrices.length === 0) return 0;
  const sorted = [...itemPrices].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  for (const p of sorted) {
    const start = p.startDate || '0000-00-00';
    const end = p.endDate || '9999-12-31';
    if (start <= targetDate && end >= targetDate) return p.price;
  }
  return sorted[0]?.price || 0; 
};

export default function Reports() {
  const navigate = useNavigate();
  const token = import.meta.env.VITE_WB_API_KEY_STATISTICS;
  
  const [activeTab, setActiveTab] = useState<1 | 2 | 3 | 4>(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedShk, setExpandedShk] = useState<number | null>(null);
  
  const [fetchDateFrom, setFetchDateFrom] = useState(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [fetchDateTo, setFetchDateTo] = useState(new Date().toISOString().split('T')[0]);

  const [globalDateStart, setGlobalDateStart] = useState('');
  const [globalDateEnd, setGlobalDateEnd] = useState('');

  const [detDisplayCount, setDetDisplayCount] = useState(ITEMS_PER_LOAD);
  const [detSearchQuery, setDetSearchQuery] = useState('');
  const [detSortField, setDetSortField] = useState<'date' | 'profit' | 'sales' | 'logistics'>('date');
  const [detSortOrder, setDetSortOrder] = useState<'desc' | 'asc'>('desc');
  const [detFilterStatus, setDetFilterStatus] = useState<string>('All');
  
  const [isMissingPricesModalOpen, setIsMissingPricesModalOpen] = useState(false);

  // Состояния сырого отчета и фильтры столбцов
  const [rawDisplayCount, setRawDisplayCount] = useState(ITEMS_PER_LOAD);
  const [rawDateStart, setRawDateStart] = useState('');
  const [rawDateEnd, setRawDateEnd] = useState('');
  const [rawSortField, setRawSortField] = useState<'date' | 'amount'>('date');
  const [rawSortOrder, setRawSortOrder] = useState<'desc' | 'asc'>('desc');
  const [rawColumnFilters, setRawColumnFilters] = useState<Record<string, string>>({});

  const savedPrices = useLiveQuery(() => db.prices.toArray()) || [];
  const savedProducts = useLiveQuery(() => db.products.toArray()) || [];
  const rawReports = useLiveQuery(() => db.rawReports.toArray()) || [];
  
  const myWarehouse = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const wbLinks = useLiveQuery(() => db.wbLinks.toArray()) || [];

  const loadNewReports = async () => {
    if (!token) return alert('API Токен (Статистика) не найден!');
    setIsLoading(true);
    try {
      const lastReport = await db.rawReports.orderBy('rr_dt').last();
      const startDate = lastReport ? lastReport.rr_dt.split('T')[0] : fetchDateFrom;
      const endDate = new Date().toISOString().split('T')[0];
      const newRows = await fetchFinancialReport(token, `${startDate}T00:00:00Z`, `${endDate}T23:59:59Z`);
      await db.rawReports.bulkPut(newRows);
      alert(`Успешно загружено и обновлено: ${newRows.length} строк`);
      setIsModalOpen(false);
    } catch (error: any) { alert(error.message); } finally { setIsLoading(false); }
  };

  const loadManualReports = async () => {
    if (!token) return alert('API Токен (Статистика) не найден!');
    setIsLoading(true);
    try {
      const newRows = await fetchFinancialReport(token, `${fetchDateFrom}T00:00:00Z`, `${fetchDateTo}T23:59:59Z`);
      await db.rawReports.bulkPut(newRows);
      alert(`Успешно загружено: ${newRows.length} строк`);
      setIsModalOpen(false);
    } catch (error: any) { alert(error.message); } finally { setIsLoading(false); }
  };

  const handleDeleteAllReports = async () => {
    if (window.confirm('Вы уверены, что хотите удалить ВСЕ загруженные отчеты? Это очистит локальную базу, но вы всегда сможете загрузить их заново из WB.')) {
      setIsLoading(true);
      try {
        await db.rawReports.clear();
        alert('Все отчеты успешно удалены.');
      } catch (error: any) {
        alert('Ошибка при удалении: ' + error.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleGoToCatalog = (nmId: number) => {
    setIsMissingPricesModalOpen(false);
    navigate('/', { state: { openEditModalNmId: nmId } });
  };

  const handleRawColumnFilterChange = (key: string, value: string) => {
    setRawColumnFilters(prev => ({ ...prev, [key]: value }));
    setRawDisplayCount(ITEMS_PER_LOAD);
  };

  // ==========================================
  // АЛГОРИТМ РАСЧЕТА С ХРОНОЛОГИЕЙ И FIFO
  // ==========================================
  const { detailedData, productAnalytics, dashboardData, filteredRawReports, missingPriceItems } = useMemo(() => {
    
    // Подготовка истории FIFO
    const nmReceiptsMap = new Map();
    wbLinks.forEach(link => {
      const myItem = myWarehouse.find(m => m.id === link.myStockItemId);
      if (myItem && myItem.receipts && myItem.receipts.length > 0) {
        const sorted = [...myItem.receipts].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({...r, used: 0}));
        nmReceiptsMap.set(link.nmId, sorted);
      }
    });

    const shkCostMap = new Map();
    
    // Сортировка продаж для FIFO
    const allSales = rawReports.filter(row => {
      const doc = (row.doc_type_name || "").toLowerCase();
      const op = (row.supplier_oper_name || "").toLowerCase();
      return doc === 'продажа' || op.includes('компенсация');
    }).sort((a, b) => {
      const dA = (a.order_dt || a.rr_dt || '').split('T')[0] || '9999-12-31';
      const dB = (b.order_dt || b.rr_dt || '').split('T')[0] || '9999-12-31';
      return dA.localeCompare(dB);
    });

    allSales.forEach(sale => {
      const nmId = sale.nm_id;
      const shk = sale.shk_id || 0;
      const date = (sale.order_dt || sale.rr_dt || '').split('T')[0];
      const qty = sale.quantity || 1;

      let unitCost = 0;
      const receipts = nmReceiptsMap.get(nmId);

      if (receipts) {
        let rem = qty;
        let costSum = 0;
        for (const r of receipts) {
          if (rem <= 0) break;
          if (r.date <= date && r.used < r.quantity) {
            const take = Math.min(r.quantity - r.used, rem);
            r.used += take;
            costSum += take * r.price;
            rem -= take;
          }
        }
        if (rem > 0) {
          costSum += rem * getPriceForDate(nmId, date, savedPrices);
        }
        unitCost = costSum / qty;
      } else {
        unitCost = getPriceForDate(nmId, date, savedPrices);
      }

      if (shk !== 0) shkCostMap.set(shk, unitCost);
      shkCostMap.set(`rrd_${sale.rrd_id}`, unitCost);
    });

    const shkMap = new Map<number, any>();
    const nmMap = new Map<number, any>();
    
    let totalSales = 0, totalLog = 0, totalOther = 0, totalCost = 0, totalTax = 0, returnsCount = 0;

    const filteredRaw = rawReports.filter(row => {
      if (!globalDateStart && !globalDateEnd) return true;
      const rowDate = (row.rr_dt || row.create_dt || '').split('T')[0];
      if (!rowDate) return false;
      if (globalDateStart && rowDate < globalDateStart) return false;
      if (globalDateEnd && rowDate > globalDateEnd) return false;
      return true;
    });

    filteredRaw.forEach(row => {
      const shk = row.shk_id || 0; 
      if (!shkMap.has(shk)) {
        shkMap.set(shk, {
          shk_id: shk, nm_id: row.nm_id || 0,
          title: row.subject_name || (shk === 0 ? 'Сводные операции' : 'Неизвестно'),
          vendorCode: row.sa_name || '',
          sale_amount: 0, return_amount: 0, logistics_amount: 0, other_expenses: 0, 
          first_date: null, original_items: [], aggregatedCost: 0
        });
      }

      const unit = shkMap.get(shk);
      unit.original_items.push(row);

      if (!unit.vendorCode && row.sa_name) unit.vendorCode = row.sa_name;
      if (unit.nm_id === 0 && row.nm_id) unit.nm_id = row.nm_id;
      if ((unit.title === 'Неизвестно' || !unit.title) && row.subject_name) unit.title = row.subject_name;

      const opDate = (row.order_dt || row.rr_dt || '').split('T')[0];
      if (opDate && (!unit.first_date || opDate < unit.first_date)) {
        unit.first_date = opDate;
      }

      const docType = (row.doc_type_name || "").toLowerCase();
      const operName = (row.supplier_oper_name || "").toLowerCase();
      const ppvz = row.ppvz_for_pay || 0;

      if (docType === 'продажа') { unit.sale_amount += ppvz; } 
      else if (docType === 'возврат') { unit.return_amount += ppvz; } 
      else if (operName.includes('компенсация')) { unit.sale_amount += ppvz; }

      unit.logistics_amount += row.delivery_rub || 0;
      unit.other_expenses += (row.penalty || 0) + (row.deduction || 0) + (row.acceptance || 0) + (row.storage_fee || 0);

      if (shk === 0 && (docType === 'продажа' || operName.includes('компенсация'))) {
        unit.aggregatedCost += (shkCostMap.get(`rrd_${row.rrd_id}`) || 0) * (row.quantity || 1);
      }
    });

    const uniqueMissingMap = new Map();

    const detailedList = Array.from(shkMap.values()).map(unit => {
      const dbProduct = savedProducts.find(p => p.nmID === unit.nm_id);
      if (dbProduct) {
        unit.title = dbProduct.title;
        if (!unit.vendorCode) unit.vendorCode = dbProduct.vendorCode;
      }

      // 1. Сортируем все операции данного ШК по дате (хронология)
      unit.original_items.sort((a: any, b: any) => new Date(a.rr_dt).getTime() - new Date(b.rr_dt).getTime());

      let finalStatus = 'В пути / Обработка';

      // 2. Идем по истории операций
      unit.original_items.forEach((op: any) => {
        const docType = (op.doc_type_name || '').toLowerCase();
        const operName = (op.supplier_oper_name || '').toLowerCase();

        // Поехала к клиенту
        if (operName.includes('к клиенту при продаже')) {
           finalStatus = 'В пути / Обработка'; 
        }
        
        // Выкуп / Компенсация
        if (docType === 'продажа' || operName.includes('компенсация')) {
           finalStatus = 'Продажа';
        }

        // Отказ / Возврат
        if (operName.includes('от клиента при отмене') || operName.includes('к клиенту при отмене') || docType === 'возврат') {
           finalStatus = 'Отмена / Возврат';
        }

        // Возвраты продавцу
        if (operName.includes('возврат брака')) {
           finalStatus = 'Возврат брака (К продавцу)';
        } else if (operName.includes('возврат кгт')) {
           finalStatus = 'Возврат КГТ продавцу (К продавцу)';
        } else if (operName.includes('приехал по мп')) {
           finalStatus = 'Возврат по МП (К продавцу)';
        } else if (operName.includes('возврат продавцу')) {
           finalStatus = 'Возвращен продавцу';
        }
      });

      // 3. Финальное присвоение статуса
      if (unit.shk_id === 0) {
        unit.status = 'Сводные расходы';
      } else {
        unit.status = finalStatus;
      }

      // Присвоение стоимости с учетом FIFO
      if (unit.shk_id !== 0) {
         unit.cost = shkCostMap.get(unit.shk_id) !== undefined ? shkCostMap.get(unit.shk_id) : getPriceForDate(unit.nm_id, unit.first_date, savedPrices);
      } else {
         unit.cost = unit.aggregatedCost || 0;
      }
      
      unit.isLinked = wbLinks.some(l => l.nmId === unit.nm_id);

      if (unit.nm_id !== 0 && unit.cost === 0 && !uniqueMissingMap.has(unit.nm_id)) {
        uniqueMissingMap.set(unit.nm_id, { nm_id: unit.nm_id, title: unit.title, vendorCode: unit.vendorCode });
      }

      const isSold = unit.status === 'Продажа';
      const costToDeduct = isSold ? unit.cost : 0;
      unit.isSold = isSold;

      unit.net_sales = unit.sale_amount - unit.return_amount;
      const taxBase = unit.net_sales - unit.logistics_amount - costToDeduct;
      unit.tax = taxBase > 0 ? taxBase * 0.2 : 0;
      unit.netProfit = unit.net_sales - unit.logistics_amount - unit.other_expenses - costToDeduct - unit.tax;

      totalSales += unit.net_sales;
      totalLog += unit.logistics_amount;
      totalOther += unit.other_expenses;
      totalCost += costToDeduct;
      totalTax += unit.tax;
      if (unit.status === 'Отмена / Возврат') returnsCount++;

      if (unit.nm_id !== 0) {
        if (!nmMap.has(unit.nm_id)) {
          nmMap.set(unit.nm_id, { nm_id: unit.nm_id, title: unit.title, vendorCode: unit.vendorCode, soldCount: 0, returnCount: 0, revenue: 0, profit: 0 });
        }
        const prodGroup = nmMap.get(unit.nm_id);
        if (isSold) prodGroup.soldCount++;
        if (unit.status.includes('Возврат') || unit.status === 'Отмена / Возврат') prodGroup.returnCount++;
        prodGroup.revenue += unit.net_sales;
        prodGroup.profit += unit.netProfit;
      }
      return unit;
    }).sort((a, b) => b.netProfit - a.netProfit);

    const productList = Array.from(nmMap.values()).sort((a, b) => b.profit - a.profit);
    const finalTotalPayout = totalSales - totalLog - totalOther;

    return {
      missingPriceItems: Array.from(uniqueMissingMap.values()),
      filteredRawReports: filteredRaw,
      detailedData: detailedList,
      productAnalytics: productList,
      dashboardData: {
        sales: totalSales, wb_payout: finalTotalPayout, profit: finalTotalPayout - totalCost - totalTax,
        logistics: totalLog, penalties: totalOther, tax: totalTax, returnsCount: returnsCount, topProducts: productList.slice(0, 10)
      }
    };
  }, [rawReports, savedPrices, savedProducts, globalDateStart, globalDateEnd, myWarehouse, wbLinks]);

  // Фильтры Вкладки 2
  const processedDetailedItems = useMemo(() => {
    let result = [...detailedData];
    if (detFilterStatus !== 'All') result = result.filter(u => u.status === detFilterStatus);
    if (detSearchQuery) {
      const q = detSearchQuery.toLowerCase();
      result = result.filter(u => String(u.shk_id).includes(q) || String(u.vendorCode).toLowerCase().includes(q) || String(u.title).toLowerCase().includes(q) || u.status.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      let valA: any, valB: any;
      if (detSortField === 'date') {
        valA = a.first_date || '0000-00-00'; valB = b.first_date || '0000-00-00';
        return detSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (detSortField === 'profit') { valA = a.netProfit; valB = b.netProfit; }
      if (detSortField === 'sales') { valA = a.net_sales; valB = b.net_sales; }
      if (detSortField === 'logistics') { valA = a.logistics_amount; valB = b.logistics_amount; }
      return detSortOrder === 'asc' ? valA - valB : valB - valA;
    });
    return result;
  }, [detailedData, detSearchQuery, detSortField, detSortOrder, detFilterStatus]);

  const detCurrentItems = processedDetailedItems.slice(0, detDisplayCount);
  const detHasMore = detDisplayCount < processedDetailedItems.length;

  // Фильтры Вкладки 4 (Сырой отчет) - с поиском по столбцам
  const processedRawItems = useMemo(() => {
    let result = [...filteredRawReports];
    
    // 1. Фильтр по периоду
    if (rawDateStart || rawDateEnd) {
      result = result.filter(item => {
        const date = (item.rr_dt || item.create_dt || '').split('T')[0];
        if (!date) return false;
        if (rawDateStart && date < rawDateStart) return false;
        if (rawDateEnd && date > rawDateEnd) return false;
        return true;
      });
    }

    // 2. Фильтры по столбцам (Excel style)
    Object.entries(rawColumnFilters).forEach(([key, searchVal]) => {
      if (!searchVal) return;
      const lowerSearch = searchVal.toLowerCase();
      result = result.filter(item => {
        const cellValue = item[key] !== null && item[key] !== undefined ? String(item[key]) : '';
        return cellValue.toLowerCase().includes(lowerSearch);
      });
    });

    // 3. Сортировка
    result.sort((a, b) => {
      let valA: any, valB: any;
      if (rawSortField === 'date') {
        valA = a.rr_dt || a.create_dt || ''; valB = b.rr_dt || b.create_dt || '';
        return rawSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else if (rawSortField === 'amount') {
        valA = a.ppvz_for_pay || 0; valB = b.ppvz_for_pay || 0;
        return rawSortOrder === 'asc' ? valA - valB : valB - valA;
      }
      return 0;
    });
    return result;
  }, [filteredRawReports, rawDateStart, rawDateEnd, rawSortField, rawSortOrder, rawColumnFilters]);

  const rawCurrentItems = processedRawItems.slice(0, rawDisplayCount);
  const rawHasMore = rawDisplayCount < processedRawItems.length;

  const toggleRow = (shk_id: number) => setExpandedShk(expandedShk === shk_id ? null : shk_id);

  return (
    <PageLayout>
      
      {/* ГЛОБАЛЬНАЯ ШАПКА */}
      <Toolbar>
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">
            Финансовая аналитика
          </h1>
          <div className="flex items-center gap-2 bg-blue-50/50 rounded-lg p-1.5 border border-blue-100">
            <span className="text-[11px] font-bold text-gray-500 uppercase px-2">Период:</span>
            <input type="date" value={globalDateStart} onChange={e => setGlobalDateStart(e.target.value)} className="bg-transparent border-none text-[13px] font-medium text-blue-900 focus:ring-0 outline-none cursor-pointer" />
            <span className="text-blue-300">—</span>
            <input type="date" value={globalDateEnd} onChange={e => setGlobalDateEnd(e.target.value)} className="bg-transparent border-none text-[13px] font-medium text-blue-900 focus:ring-0 outline-none cursor-pointer" />
            {(globalDateStart || globalDateEnd) && (<button onClick={() => {setGlobalDateStart(''); setGlobalDateEnd('');}} className="p-1 text-gray-400 hover:text-red-500 transition-colors"><X size={14} /></button>)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleDeleteAllReports} disabled={isLoading} className="!text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 transition-colors">
            <Trash2 size={16} /> Удалить все
          </Button>
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            <Download size={16} /> Загрузить из WB
          </Button>
        </div>
      </Toolbar>

      {/* Вкладки */}
      <div className="flex justify-between items-center flex-shrink-0 relative z-10">
        <div className="flex gap-2">
          {[ 
            { id: 1, name: 'Общий Дашборд', icon: <BarChart3 size={16} /> }, 
            { id: 2, name: 'Детализация по ШК', icon: <List size={16} /> }, 
            { id: 3, name: 'Аналитика товаров', icon: <Layers size={16} /> }, 
            { id: 4, name: 'Сырой отчет', icon: <FileSpreadsheet size={16} /> } 
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-bold transition-all ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200 border border-transparent'}`}>
              {tab.icon} {tab.name}
            </button>
          ))}
        </div>
        
        {missingPriceItems.length > 0 && (
          <button 
            onClick={() => setIsMissingPricesModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-colors bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer shadow-sm border border-red-200"
          >
            <Bell size={16} className="animate-bounce" />
            Без себестоимости: {missingPriceItems.length} шт.
          </button>
        )}
      </div>

      {/* КОНТЕНТ ВКЛАДОК */}
      
      {/* ВКЛАДКА 1: ДАШБОРД */}
      {activeTab === 1 && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Чистая продажа (ВБ)</p>
              <h2 className="text-2xl font-black text-gray-900 mt-1">{dashboardData.sales.toLocaleString('ru-RU')} р</h2>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-green-200 bg-gradient-to-br from-green-50 to-white">
              <p className="text-[11px] font-bold text-green-700 uppercase tracking-wider">Чистая Прибыль</p>
              <h2 className="text-2xl font-black text-green-600 mt-1">{dashboardData.profit.toLocaleString('ru-RU')} р</h2>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Налог 20%</p>
              <h2 className="text-2xl font-black text-gray-700 mt-1">{dashboardData.tax.toLocaleString('ru-RU')} р</h2>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Логистика / Прочие</p>
              <h2 className="text-xl font-black text-red-500 mt-1">-{dashboardData.logistics.toLocaleString('ru-RU')} / -{dashboardData.penalties.toLocaleString('ru-RU')}</h2>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-[16px] font-bold text-gray-900 mb-4">Топ-10 товаров по прибыли</h3>
            <div className="space-y-3">
              {dashboardData.topProducts.map((p: any, i: number) => (
                <div key={p.nm_id} className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <div className="w-8 font-bold text-gray-400 text-sm">#{i+1}</div>
                  <div className="flex-1"><p className="font-semibold text-[14px] text-gray-900 truncate max-w-md">{p.title}</p></div>
                  <div className="w-32 text-right font-bold text-[14px] text-gray-900">{p.profit.toLocaleString('ru-RU')} р</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ВКЛАДКА 2: ДЕТАЛИЗАЦИЯ ПО ШК */}
      {activeTab === 2 && (
        <TableWrapper>
          <div className="p-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4 bg-gray-50">
            <div className="flex items-center gap-3">
              <SearchInput value={detSearchQuery} onChange={(v) => { setDetSearchQuery(v); setDetDisplayCount(ITEMS_PER_LOAD); }} placeholder="Поиск по ШК, артикулу..." />
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-gray-200 shadow-sm">
                <Filter size={14} className="text-gray-400" />
                <select value={detFilterStatus} onChange={e => { setDetFilterStatus(e.target.value); setDetDisplayCount(ITEMS_PER_LOAD); }} className="bg-transparent border-none text-[13px] font-medium text-gray-700 focus:ring-0 outline-none cursor-pointer">
                  <option value="All">Все статусы</option>
                  <option value="Продажа">Продажа</option>
                  <option value="Отмена / Возврат">Отмена / Возврат</option>
                  <option value="В пути / Обработка">В пути / Обработка</option>
                  <option value="Возврат брака (К продавцу)">Возврат брака (К продавцу)</option>
                  <option value="Возврат КГТ продавцу (К продавцу)">Возврат КГТ</option>
                  <option value="Возврат по МП (К продавцу)">Возврат по МП</option>
                  <option value="Возвращен продавцу">Возвращен продавцу (Прочее)</option>
                  <option value="Сводные расходы">Сводные расходы</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select value={detSortField} onChange={e => { setDetSortField(e.target.value as any); setDetDisplayCount(ITEMS_PER_LOAD); }} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer shadow-sm">
                <option value="date">По дате заказа</option><option value="profit">По чистой прибыли</option><option value="sales">По сумме продажи</option><option value="logistics">По логистике</option>
              </select>
              <div className="flex bg-gray-200/50 rounded-lg p-1 border border-gray-200">
                <button onClick={() => { setDetSortOrder('desc'); setDetDisplayCount(ITEMS_PER_LOAD); }} className={`px-3 py-1 text-[12px] rounded-md transition-all ${detSortOrder === 'desc' ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>Убыв.</button>
                <button onClick={() => { setDetSortOrder('asc'); setDetDisplayCount(ITEMS_PER_LOAD); }} className={`px-3 py-1 text-[12px] rounded-md transition-all ${detSortOrder === 'asc' ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>Возр.</button>
              </div>
              <Button variant="success" onClick={() => exportToExcel(processedDetailedItems, 'WB_Detailed_SHK')}>Экспорт</Button>
            </div>
          </div>

          {detCurrentItems.length === 0 ? (
            <EmptyState icon={Search} title="Ничего не найдено" description="Попробуйте изменить параметры поиска или фильтры" />
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_#e5e7eb]">
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50">
                    <th className="px-4 py-3 w-10 border-b border-gray-200"></th>
                    <th className="px-4 py-3 border-b border-gray-200">Дата заказа</th>
                    <th className="px-4 py-3 border-b border-gray-200">ШК (shk_id)</th>
                    <th className="px-4 py-3 border-b border-gray-200">Артикул</th>
                    <th className="px-4 py-3 border-b border-gray-200">Статус</th>
                    <th className="px-4 py-3 text-right text-blue-800 border-b border-gray-200">Продажа</th>
                    <th className="px-4 py-3 text-right border-b border-gray-200">Логистика</th>
                    <th className="px-4 py-3 text-right border-b border-gray-200">Прочие</th>
                    <th className="px-4 py-3 text-right border-l border-b border-gray-200">Себестоимость</th>
                    <th className="px-4 py-3 text-right border-b border-gray-200">Налог</th>
                    <th className="px-4 py-3 text-right bg-blue-50/50 text-blue-800 border-b border-gray-200">Чистая Прибыль</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detCurrentItems.map((unit: any) => (
                    <Fragment key={unit.shk_id}>
                      <tr onClick={() => toggleRow(unit.shk_id)} className={`transition-colors cursor-pointer ${expandedShk === unit.shk_id ? 'bg-blue-50/30' : 'hover:bg-gray-50/80 bg-white'}`}>
                        <td className="px-4 py-3 text-gray-400">{expandedShk === unit.shk_id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td className="px-4 py-3 text-[13px] font-medium text-gray-600">{unit.first_date ? new Date(unit.first_date).toLocaleDateString('ru-RU') : '—'}</td>
                        <td className="px-4 py-3">{unit.shk_id !== 0 ? <span className="font-mono font-bold text-[12px] text-gray-700 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">{unit.shk_id}</span> : <span className="text-[12px] font-bold text-gray-400">—</span>}</td>
                        <td className="px-4 py-3 min-w-[200px]">
                          <p className="text-[13px] font-semibold text-[#1e3a5f] truncate max-w-[300px]" title={unit.vendorCode || unit.title}>
                            {unit.vendorCode || unit.title}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                            unit.status === 'Продажа' ? 'bg-green-50 text-green-700 border-green-200' : 
                            unit.status === 'Отмена / Возврат' ? 'bg-orange-50 text-orange-700 border-orange-200' : 
                            unit.status.includes('Возврат') || unit.status.includes('Возвращен') ? 'bg-red-50 text-red-700 border-red-200' : 
                            unit.status === 'В пути / Обработка' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>
                            {unit.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-[13px] text-gray-900">{unit.net_sales !== 0 ? unit.net_sales.toFixed(2) : '-'}</td>
                        <td className="px-4 py-3 text-right text-[13px] text-red-500">{unit.logistics_amount > 0 ? `-${unit.logistics_amount.toFixed(2)}` : '-'}</td>
                        <td className="px-4 py-3 text-right text-[13px] text-red-500">{unit.other_expenses > 0 ? `-${unit.other_expenses.toFixed(2)}` : '-'}</td>
                        
                        <td className="px-4 py-3 text-right border-l border-gray-100 bg-gray-50/30" onClick={(e) => e.stopPropagation()}>
                          {unit.nm_id !== 0 ? (
                            unit.cost > 0 ? (
                              <div className="group flex flex-col justify-end items-end gap-0.5 cursor-pointer" onClick={() => handleGoToCatalog(unit.nm_id)}>
                                {unit.isLinked && (
                                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1 rounded flex items-center gap-1 border border-indigo-100">
                                    <LinkIcon size={8} /> FIFO
                                  </span>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className={`text-[13px] font-bold ${!unit.isSold ? 'text-gray-400 line-through decoration-gray-400 opacity-60' : 'text-[#1e3a5f]'}`} title={!unit.isSold ? "Не вычитается (не продажа)" : "Вычтено из прибыли"}>
                                    {unit.cost.toFixed(2)}
                                  </span>
                                  <Edit2 size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => handleGoToCatalog(unit.nm_id)} className="flex items-center justify-end gap-1 ml-auto text-[11px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded hover:bg-orange-100 transition-colors cursor-pointer">
                                <AlertCircle size={12} /> Внести
                              </button>
                            )
                          ) : '-'}
                        </td>

                        <td className="px-4 py-3 text-right text-[13px] text-orange-500">{unit.tax > 0 ? `-${unit.tax.toFixed(2)}` : '-'}</td>
                        <td className={`px-4 py-3 text-right font-bold text-[13px] bg-blue-50/10 ${unit.netProfit > 0 ? 'text-green-600' : unit.netProfit < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {unit.netProfit > 0 ? '+' : ''}{unit.netProfit.toFixed(2)} р
                        </td>
                      </tr>
                      
                      {expandedShk === unit.shk_id && (
                        <tr className="bg-gray-50/80 border-b border-gray-200 shadow-inner">
                          <td colSpan={11} className="px-8 py-4">
                            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                              <h4 className="font-bold text-[#1e3a5f] mb-3 text-[13px] flex items-center gap-2"><List size={14} className="text-blue-500"/> История операций (Хронология)</h4>
                              <table className="w-full text-[12px] text-left">
                                <thead className="bg-gray-100 text-gray-500 rounded-lg uppercase tracking-wider font-bold">
                                  <tr>
                                    <th className="p-2 border-b border-gray-200">Дата операции</th><th className="p-2 border-b border-gray-200">Обоснование</th>
                                    <th className="p-2 border-b border-gray-200">Документ</th><th className="p-2 text-right border-b border-gray-200">Сумма (ВБ)</th>
                                    <th className="p-2 text-right border-b border-gray-200">Логистика</th><th className="p-2 text-right border-b border-gray-200">Прочие (Штраф/Хранение)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {unit.original_items.map((op: any, i: number) => {
                                    const otherSum = (op.penalty || 0) + (op.deduction || 0) + (op.acceptance || 0) + (op.storage_fee || 0);
                                    return (
                                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-2 font-medium text-gray-700">{new Date(op.rr_dt).toLocaleDateString('ru-RU')}</td>
                                        <td className="p-2 text-gray-600">{op.supplier_oper_name || '-'}</td>
                                        <td className="p-2 text-gray-600">{op.doc_type_name || '-'}</td>
                                        <td className="p-2 text-right font-bold text-gray-900">{op.ppvz_for_pay ? op.ppvz_for_pay.toFixed(2) : '-'}</td>
                                        <td className="p-2 text-right text-red-500">{op.delivery_rub ? `-${op.delivery_rub.toFixed(2)}` : '-'}</td>
                                        <td className="p-2 text-right text-red-500">{otherSum > 0 ? `-${otherSum.toFixed(2)}` : '-'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detHasMore && (
            <div className="p-3 flex justify-center bg-white border-t border-gray-200 flex-shrink-0">
              <Button variant="outline" onClick={() => setDetDisplayCount(prev => prev + ITEMS_PER_LOAD)}>Загрузить еще 50 строк...</Button>
            </div>
          )}
        </TableWrapper>
      )}

      {/* ВКЛАДКА 3: АНАЛИТИКА ПО ТОВАРАМ */}
      {activeTab === 3 && (
        <TableWrapper>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_#e5e7eb]">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50">
                  <th className="px-6 py-3 border-b border-gray-200">Артикул / Название</th>
                  <th className="px-6 py-3 text-center border-b border-gray-200">Продано шт.</th>
                  <th className="px-6 py-3 text-center border-b border-gray-200">Возвраты</th>
                  <th className="px-6 py-3 text-right border-b border-gray-200">Чистая Продажа</th>
                  <th className="px-6 py-3 text-right bg-blue-50/50 border-b border-gray-200">Чистая Прибыль</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {productAnalytics.length === 0 ? (
                  <tr><td colSpan={5}><EmptyState icon={Layers} title="Нет данных" description="Для выбранного периода нет аналитики по товарам" /></td></tr>
                ) : productAnalytics.map((p: any) => (
                  <tr key={p.nm_id} className="hover:bg-gray-50/80 transition-colors bg-white">
                    <td className="px-6 py-3">
                      <p className="font-semibold text-[13px] text-[#1e3a5f]">{p.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">Арт: {p.vendorCode}</p>
                    </td>
                    <td className="px-6 py-3 text-center font-bold text-[13px] text-gray-900">{p.soldCount}</td>
                    <td className="px-6 py-3 text-center font-bold text-[13px] text-orange-500">{p.returnCount}</td>
                    <td className="px-6 py-3 text-right font-medium text-[13px] text-gray-900">{p.revenue.toLocaleString('ru-RU')} р</td>
                    <td className={`px-6 py-3 text-right font-bold text-[14px] bg-blue-50/10 ${p.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{p.profit > 0 ? '+' : ''}{p.profit.toLocaleString('ru-RU')} р</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableWrapper>
      )}

      {/* ВКЛАДКА 4: СЫРОЙ ОТЧЕТ (EXCEL-ВИД С ФИЛЬТРАМИ) */}
      {activeTab === 4 && (
        <TableWrapper>
          <div className="p-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4 bg-gray-50">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                <span className="text-[12px] font-bold text-gray-500">От:</span>
                <input type="date" value={rawDateStart} onChange={e => { setRawDateStart(e.target.value); setRawDisplayCount(ITEMS_PER_LOAD); }} className="bg-transparent border-none text-[13px] text-gray-700 outline-none cursor-pointer" />
                <span className="text-gray-300">|</span>
                <span className="text-[12px] font-bold text-gray-500">До:</span>
                <input type="date" value={rawDateEnd} onChange={e => { setRawDateEnd(e.target.value); setRawDisplayCount(ITEMS_PER_LOAD); }} className="bg-transparent border-none text-[13px] text-gray-700 outline-none cursor-pointer" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select value={rawSortField} onChange={e => { setRawSortField(e.target.value as any); setRawDisplayCount(ITEMS_PER_LOAD); }} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer shadow-sm">
                <option value="date">Сортировка по дате</option><option value="amount">Сортировка по сумме</option>
              </select>
              <div className="flex bg-gray-200/50 rounded-lg p-1 border border-gray-200">
                <button onClick={() => { setRawSortOrder('desc'); setRawDisplayCount(ITEMS_PER_LOAD); }} className={`px-3 py-1 text-[12px] rounded-md transition-all ${rawSortOrder === 'desc' ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>Убыв.</button>
                <button onClick={() => { setRawSortOrder('asc'); setRawDisplayCount(ITEMS_PER_LOAD); }} className={`px-3 py-1 text-[12px] rounded-md transition-all ${rawSortOrder === 'asc' ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>Возр.</button>
              </div>
              <Button variant="success" onClick={() => exportToExcel(processedRawItems, 'WB_Raw_Report')}>Экспорт</Button>
            </div>
          </div>

          {rawCurrentItems.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="Нет данных" description="Сырой отчет пуст для выбранных параметров" />
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap text-[11px]">
                <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_#e5e7eb] bg-gray-50">
                  {/* Основные заголовки таблицы */}
                  <tr className="uppercase tracking-wider text-gray-500 font-bold">
                    {Object.entries(KEY_TRANSLATIONS).map(([key, label]) => (
                      <th key={key} className="px-4 py-2 border-r border-b border-gray-200 last:border-r-0" title={key}>{label}</th>
                    ))}
                  </tr>
                  {/* Строка с полями ввода для фильтрации каждого столбца (Excel style) */}
                  <tr className="bg-white">
                    {Object.keys(KEY_TRANSLATIONS).map((key) => (
                      <th key={`filter-${key}`} className="px-2 py-1 border-r border-b border-gray-200 last:border-r-0 font-normal">
                        <div className="relative flex items-center">
                          <Search size={10} className="absolute left-2 text-gray-400" />
                          <input 
                            type="text" 
                            className="w-full pl-6 pr-2 py-1 text-[10px] text-gray-700 bg-gray-50 border border-gray-200 rounded focus:bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-colors placeholder:text-gray-400" 
                            placeholder="Фильтр..." 
                            value={rawColumnFilters[key] || ''}
                            onChange={(e) => handleRawColumnFilterChange(key, e.target.value)}
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rawCurrentItems.map((item, idx) => (
                    <tr key={item.rrd_id || idx} className="hover:bg-blue-50/50 transition-colors bg-white">
                      {Object.keys(KEY_TRANSLATIONS).map((key) => (
                        <td key={key} className="px-4 py-2 border-r border-gray-100 last:border-r-0 text-[12px] text-gray-700">
                          {item[key] !== null && item[key] !== undefined ? String(item[key]) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rawHasMore && (
            <div className="p-3 flex justify-center bg-white border-t border-gray-200 flex-shrink-0">
              <Button variant="outline" onClick={() => setRawDisplayCount(prev => prev + ITEMS_PER_LOAD)}>Загрузить еще 50 строк...</Button>
            </div>
          )}
        </TableWrapper>
      )}

      {/* Модалка для отсутствующих цен */}
      {isMissingPricesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsMissingPricesModalOpen(false)}>
          <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between p-4 border-b border-gray-100 flex-shrink-0 bg-gray-50">
                <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle size={18} />
                    <h2 className="text-[15px] font-bold text-gray-900">Не указана себестоимость</h2>
                </div>
                <button onClick={() => setIsMissingPricesModalOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"><X size={18}/></button>
            </header>
            
            <div className="flex-grow overflow-y-auto">
              <div className="bg-orange-50 p-3 text-[12px] font-medium text-orange-800 border-b border-orange-100">
                  Внимание! Для корректного расчета прибыли необходимо внести закупочную цену для следующих товаров.
              </div>
              <div className="divide-y divide-gray-100">
                  {missingPriceItems.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                          <div className="overflow-hidden mr-4">
                              <div className="font-bold text-[13px] text-[#1e3a5f] truncate" title={item.title}>{item.title}</div>
                              <div className="text-[11px] text-gray-500 flex gap-2 mt-1">
                                  <span className="font-mono">Арт: {item.vendorCode}</span>
                                  <span>•</span>
                                  <span>NM: {item.nm_id}</span>
                              </div>
                          </div>
                          <Button variant="outline" onClick={() => handleGoToCatalog(item.nm_id)} className="flex-shrink-0 !py-1.5 !px-3 text-[12px] text-blue-600 border-blue-200 hover:bg-blue-50">
                              Внести <ExternalLink size={12} />
                          </Button>
                      </div>
                  ))}
              </div>
            </div>
            <div className="p-3 border-t border-gray-100 bg-gray-50 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Всего товаров без цены: {missingPriceItems.length}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно загрузки */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-[16px] font-bold text-[#1e3a5f]">Загрузка отчетов из WB</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-[12px] text-gray-500 mb-6 bg-blue-50/50 p-3 rounded-lg border border-blue-100">База данных автоматически проверяет дубликаты. Безопасно загружать пересекающиеся периоды.</p>

              <div className="mb-6">
                <Button variant="primary" onClick={loadNewReports} disabled={isLoading} className="w-full justify-center !py-2.5 text-[14px]">
                  {isLoading ? "Загружаем..." : "Авто-загрузка новых отчетов"}
                </Button>
              </div>

              <div className="text-center relative my-6">
                <hr className="border-gray-200" />
                <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-white px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">ИЛИ ВРУЧНУЮ</span>
              </div>

              <div>
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5 ml-1">От даты</label>
                    <input type="date" value={fetchDateFrom} onChange={(e) => setFetchDateFrom(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 px-3 text-[13px] text-gray-900 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5 ml-1">До даты</label>
                    <input type="date" value={fetchDateTo} onChange={(e) => setFetchDateTo(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 px-3 text-[13px] text-gray-900 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer" />
                  </div>
                </div>
                <Button variant="outline" onClick={loadManualReports} disabled={isLoading} className="w-full justify-center !py-2.5 text-[14px]">
                  Загрузить указанный период
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </PageLayout>
  )
}