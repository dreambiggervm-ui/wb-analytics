import { useState, useMemo, useEffect, useRef } from 'react';
import { Download, Search, MapPin, Package, FileSpreadsheet, RefreshCw, Bell, AlertOctagon, AlertTriangle, Info, X, Clock, CheckSquare, Square, Copy, Check } from 'lucide-react';
import { exportToExcel } from '../utils/excel';

interface Warehouse { id: number; name: string; }
interface StockItem {
  id: string;
  nmId: number;
  vendorCode: string;
  title: string;
  techSize: string;
  color: string;
  barcodes: string[];
  photo: string;
  stocks: Record<number, number>;
  totalAmount: number;
}

const HIDE_ALERTS_OLDER_THAN_DAYS = 30;

const loadSavedData = <T,>(key: string, defaultVal: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultVal;
  } catch { return defaultVal; }
};

export default function Stocks() {
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => loadSavedData('wb_fbs_warehouses', []));
  const [stocksData, setStocksData] = useState<StockItem[]>(() => loadSavedData('wb_fbs_stocks_data', []));
  const [lastUpdated, setLastUpdated] = useState<string | null>(() => localStorage.getItem('wb_fbs_last_updated') || null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  
  const [isWhMenuOpen, setIsWhMenuOpen] = useState(false);
  const [selectedWhIds, setSelectedWhIds] = useState<number[]>(() => {
    const saved = loadSavedData<number[] | null>('wb_fbs_selected_whs', null);
    if (saved === null) {
      const whs = loadSavedData<Warehouse[]>('wb_fbs_warehouses', []);
      return whs.map(w => w.id);
    }
    return saved;
  });

  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsWhMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    localStorage.setItem('wb_fbs_selected_whs', JSON.stringify(selectedWhIds));
  }, [selectedWhIds]);

  const [statusHistory, setStatusHistory] = useState<Record<string, { status: string, since: number }>>(() => loadSavedData('wb_fbs_status_history', {}));

  useEffect(() => {
    if (stocksData.length === 0) return;
    const newHistory = { ...statusHistory };
    let isChanged = false;
    const now = Date.now();

    stocksData.forEach(item => {
      let currentStatus = 'ok';
      if (item.totalAmount === 0) currentStatus = 'empty';
      else if (item.totalAmount <= 5) currentStatus = 'low';

      const prev = newHistory[item.id];
      if (!prev || prev.status !== currentStatus) {
        newHistory[item.id] = { status: currentStatus, since: now };
        isChanged = true;
      }
    });

    if (isChanged) {
      setStatusHistory(newHistory);
      localStorage.setItem('wb_fbs_status_history', JSON.stringify(newHistory));
    }
  }, [stocksData]);

  const alerts = useMemo(() => {
    const list: any[] = [];
    const now = Date.now();
    const maxAgeMs = HIDE_ALERTS_OLDER_THAN_DAYS * 24 * 60 * 60 * 1000;
    
    stocksData.forEach(item => {
      const history = statusHistory[item.id];
      const since = history ? history.since : now;
      if (now - since > maxAgeMs) return; 

      const daysAgo = Math.floor((now - since) / (1000 * 60 * 60 * 24));
      const timeText = daysAgo === 0 ? 'Сегодня' : `${daysAgo} дн. назад`;

      if (item.totalAmount === 0) {
        list.push({ id: `crit_${item.id}`, type: 'critical', title: 'Полностью распродан', desc: `Закончился на всех складах.`, timeText, since, item });
      } else if (item.totalAmount <= 5) {
        list.push({ id: `warn_${item.id}`, type: 'warning', title: 'Критически малый остаток', desc: `Остаток ${item.totalAmount} шт. Скоро закончится.`, timeText, since, item });
      } else {
        const emptyWarehouses = warehouses.filter(wh => (item.stocks[wh.id] || 0) === 0);
        if (emptyWarehouses.length > 0 && emptyWarehouses.length < warehouses.length) {
          const whNames = emptyWarehouses.map(w => w.name).join(', ');
          list.push({ id: `info_${item.id}`, type: 'info', title: `Пустые склады`, desc: `Недоступен на складах: ${whNames}`, timeText, since, item });
        }
      }
    });
    
    list.sort((a, b) => b.since - a.since);
    return list;
  }, [stocksData, warehouses, statusHistory]);

  const handleSyncStocks = async () => {
    const tokenContent = import.meta.env.VITE_WB_API_KEY_CONTENT;
    const tokenMarketplace = import.meta.env.VITE_WB_API_KEY_MARKETPLACE;

    if (!tokenContent || !tokenMarketplace) return alert('ОШИБКА: В файле .env не найдены ключи CONTENT или MARKETPLACE!');

    setIsLoading(true);
    
    try {
      setSyncStatus('Сбор данных...');
      let hasMore = true;
      let updatedAt: string | undefined = undefined;
      let nmID: number | undefined = undefined;
      
      const itemGroupMap = new Map<string, StockItem>();
      const barcodeToGroupId = new Map<string, string>(); 
      const allSkus: string[] = [];

      while (hasMore) {
        const payload: any = { settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } } };
        if (updatedAt && nmID) { payload.settings.cursor.updatedAt = updatedAt; payload.settings.cursor.nmID = nmID; }

        const res = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
          method: 'POST', headers: { 'Authorization': tokenContent, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error(`Ошибка загрузки каталога.`);
        const data = await res.json();
        
        for (const card of data.cards || []) {
          // ИЗВЛЕКАЕМ ФОТО
          let photoUrl = '';
          if (card.photos && card.photos.length > 0) {
             const p = card.photos[0];
             photoUrl = p['516x688'] || p.big || p.c516x688 || p.url || (typeof p === 'string' ? p : '');
          }

          // ИЗВЛЕКАЕМ ЦВЕТ (Улучшенный поиск)
          let colorStr = '';
          if (card.characteristics) {
            const colorObj = card.characteristics.find((c: any) => {
              const n = c.name?.toLowerCase();
              return n === 'цвет' || n === 'основной цвет';
            });
            if (colorObj) {
              if (Array.isArray(colorObj.value)) {
                colorStr = colorObj.value.join(', ');
              } else {
                colorStr = String(colorObj.value || '');
              }
            }
          }

          for (const size of card.sizes || []) {
            const sizeName = size.techSize || '';
            const groupId = `${card.nmID}_${sizeName}`;
            
            if (!itemGroupMap.has(groupId)) {
              itemGroupMap.set(groupId, {
                id: groupId, nmId: card.nmID, vendorCode: card.vendorCode, title: card.title, techSize: sizeName, color: colorStr, barcodes: [], photo: photoUrl, stocks: {}, totalAmount: 0
              });
            }

            const group = itemGroupMap.get(groupId)!;
            for (const barcode of size.skus || []) {
              allSkus.push(barcode);
              if (!group.barcodes.includes(barcode)) group.barcodes.push(barcode);
              barcodeToGroupId.set(barcode, groupId); 
            }
          }
        }

        if (data.cursor && data.cursor.updatedAt && data.cursor.nmID && (data.cards || []).length === 100) {
          updatedAt = data.cursor.updatedAt; nmID = data.cursor.nmID;
        } else { hasMore = false; }
      }

      const whRes = await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses', { headers: { 'Authorization': tokenMarketplace } });
      if (!whRes.ok) throw new Error('Ошибка загрузки складов.');
      const whData = await whRes.json();
      
      const parsedWarehouses = whData || [];
      setWarehouses(parsedWarehouses);
      localStorage.setItem('wb_fbs_warehouses', JSON.stringify(parsedWarehouses));
      
      setSelectedWhIds(prev => {
        const validIds = parsedWarehouses.map((w: Warehouse) => w.id);
        if (!prev || prev.length === 0) return validIds;
        return prev.filter(id => validIds.includes(id));
      });

      const chunkArray = (arr: string[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
      const skuChunks = chunkArray(allSkus, 1000);

      for (const wh of parsedWarehouses) {
        for (const chunk of skuChunks) {
          const stockRes = await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${wh.id}`, {
            method: 'POST', headers: { 'Authorization': tokenMarketplace, 'Content-Type': 'application/json' }, body: JSON.stringify({ skus: chunk })
          });
          if (stockRes.ok) {
            const stockData = await stockRes.json();
            for (const stock of stockData.stocks || []) {
              const groupId = barcodeToGroupId.get(stock.sku);
              if (groupId) {
                const groupItem = itemGroupMap.get(groupId)!;
                groupItem.stocks[wh.id] = (groupItem.stocks[wh.id] || 0) + stock.amount;
                groupItem.totalAmount += stock.amount;
              }
            }
          }
        }
      }

      const finalStocksData = Array.from(itemGroupMap.values());
      setStocksData(finalStocksData);
      localStorage.setItem('wb_fbs_stocks_data', JSON.stringify(finalStocksData));
      
      const nowStr = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      setLastUpdated(nowStr);
      localStorage.setItem('wb_fbs_last_updated', nowStr);
      
      setSyncStatus('');
    } catch (err: any) { alert(err.message); setSyncStatus(''); } finally { setIsLoading(false); }
  };

  const toggleWarehouse = (id: number) => {
    setSelectedWhIds(prev => prev.includes(id) ? prev.filter(wId => wId !== id) : [...prev, id]);
  };

  const visibleWarehouses = useMemo(() => {
    return warehouses.filter(wh => selectedWhIds.includes(wh.id));
  }, [warehouses, selectedWhIds]);

  const filteredItems = useMemo(() => {
    let result = [...stocksData];
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.vendorCode.toLowerCase().includes(q) || 
        item.techSize.toLowerCase().includes(q) || 
        (item.color && item.color.toLowerCase().includes(q)) || 
        item.barcodes.some(b => b.includes(q))
      );
    }
    
    result.sort((a, b) => {
      const cmp = a.vendorCode.localeCompare(b.vendorCode);
      if (cmp !== 0) return cmp;
      
      const colorCmp = (a.color || '').localeCompare(b.color || '');
      if (colorCmp !== 0) return colorCmp;

      return (a.techSize || '').localeCompare(b.techSize || '', undefined, { numeric: true });
    });
    
    return result;
  }, [stocksData, searchQuery]);

  const handleExport = () => {
    const exportData = filteredItems.map(item => {
      const row: any = { 
        "Наименование": item.title, 
        "Артикул продавца": item.vendorCode, 
        "Цвет": item.color || '-',
        "Размер": item.techSize || '-', 
        "Баркоды": item.barcodes.join(', ') 
      };
      visibleWarehouses.forEach(wh => { row[wh.name] = item.stocks[wh.id] || 0; });
      const visibleTotal = visibleWarehouses.reduce((sum, wh) => sum + (item.stocks[wh.id] || 0), 0);
      row["Общее количество (Выбранные склады)"] = visibleTotal;
      return row;
    });
    exportToExcel(exportData, 'WB_FBS_Stocks');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedBarcode(text);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  return (
    <div className="p-6 w-full h-full flex flex-col bg-[#F5F5F7]">
      
      {/* ПАНЕЛЬ УПРАВЛЕНИЯ */}
      <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-shrink-0 mb-4 relative z-40">
        
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Поиск по артикулу, цвету или баркоду..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-[13px] font-medium focus:ring-1 focus:ring-blue-500 outline-none" 
          />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setIsWhMenuOpen(!isWhMenuOpen)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-bold transition-colors ${isWhMenuOpen || selectedWhIds.length < warehouses.length ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
            >
              <MapPin size={16} /> Склады ({selectedWhIds.length}/{warehouses.length})
            </button>
            {isWhMenuOpen && warehouses.length > 0 && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
                <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500 uppercase">Склады</span>
                  <button onClick={() => setSelectedWhIds(warehouses.map(w => w.id))} className="text-xs text-blue-600 hover:text-blue-800 font-semibold cursor-pointer">Выбрать все</button>
                </div>
                <div className="max-h-60 overflow-y-auto p-1.5">
                  {warehouses.map(wh => {
                    const isSelected = selectedWhIds.includes(wh.id);
                    return (
                      <div key={wh.id} onClick={() => toggleWarehouse(wh.id)} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-md cursor-pointer transition-colors">
                        {isSelected ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-gray-300" />}
                        <span className={`text-[13px] truncate ${isSelected ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>{wh.name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <button onClick={handleExport} disabled={stocksData.length === 0} className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[13px] font-bold hover:bg-green-100 transition-colors shadow-sm disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Экспорт
          </button>
          
          <button onClick={handleSyncStocks} disabled={isLoading} className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 cursor-pointer">
            {isLoading ? <><RefreshCw size={16} className="animate-spin" /> {syncStatus}</> : <><RefreshCw size={16} /> Обновить</>}
          </button>
          
          <button onClick={() => setIsAlertsOpen(true)} className="relative flex items-center justify-center w-9 h-9 bg-white border border-gray-200 text-gray-600 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer shadow-sm">
            <Bell size={18} className={alerts.length > 0 ? "animate-pulse text-blue-600" : ""} />
            {alerts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 border-2 border-white text-[9px] font-bold text-white shadow-sm">
                {alerts.length > 99 ? '99+' : alerts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ТАБЛИЦА */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden relative">
        {stocksData.length === 0 && !isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
            <Package size={40} className="text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900">Данные отсутствуют</h3>
            <p className="text-[14px] text-gray-500 mt-1">Нажмите «Обновить», чтобы получить актуальные остатки.</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 sticky left-0 bg-gray-50 z-30 shadow-[1px_0_0_0_#e5e7eb]">Товар (Фото и Артикул)</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 text-center w-28">Цвет</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 text-center w-24">Размер</th>
                  <th className="px-4 py-2.5 border-r border-gray-100">Баркоды</th>
                  {visibleWarehouses.map(wh => (
                    <th key={wh.id} className="px-4 py-2.5 text-center border-r border-gray-100">
                      <div className="max-w-[120px] whitespace-normal leading-tight mx-auto text-[10px] text-gray-500">{wh.name}</div>
                    </th>
                  ))}
                  {/* ИЗМЕНЕНО: text-center */}
                  <th className="px-4 py-2.5 text-center bg-blue-50/40 text-blue-700 shadow-[-1px_0_0_0_#dbeafe] sticky right-0 z-30 border-l border-blue-100">
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => {
                  const visibleTotal = visibleWarehouses.reduce((sum, wh) => sum + (item.stocks[wh.id] || 0), 0);
                  const showSize = item.techSize && item.techSize !== '0';
                  
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors bg-white group">
                      
                      {/* КОЛОНКА 1: ФОТО, НАЗВАНИЕ */}
                      <td className="px-4 py-2 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal min-w-[280px] max-w-[360px]">
                        <div className="flex items-center gap-3">
                          {item.photo ? (
                            <img src={item.photo} alt="product" className="w-[44px] h-[58px] object-cover rounded shadow-sm border border-gray-200 flex-shrink-0" />
                          ) : (
                            <div className="w-[44px] h-[58px] bg-gray-50 rounded flex items-center justify-center text-[9px] text-gray-400 font-medium flex-shrink-0 border border-gray-100">Нет</div>
                          )}
                          
                          <div className="flex flex-col justify-center">
                            <h3 className="text-[13px] font-bold text-[#1e3a5f] leading-tight line-clamp-2">{item.title}</h3>
                            <p className="text-[12px] text-gray-500 font-medium mt-1">Арт: {item.vendorCode}</p>
                          </div>
                        </div>
                      </td>

                      {/* КОЛОНКА 2: ЦВЕТ */}
                      <td className="px-4 py-2 border-r border-gray-100 text-center align-middle whitespace-normal max-w-[140px]">
                        {item.color ? (
                          <span className="text-[12px] font-semibold text-gray-700 leading-tight block">{item.color}</span>
                        ) : (
                          <span className="text-gray-300 font-medium">-</span>
                        )}
                      </td>

                      {/* КОЛОНКА 3: РАЗМЕР */}
                      <td className="px-4 py-2 border-r border-gray-100 text-center align-middle">
                        {showSize ? (
                          <span className="inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 bg-gray-100 border border-gray-200 text-gray-800 text-[12px] font-bold rounded shadow-sm">
                            {item.techSize}
                          </span>
                        ) : (
                          <span className="text-gray-300 font-medium">-</span>
                        )}
                      </td>

                      {/* КОЛОНКА 4: БАРКОДЫ */}
                      <td className="px-4 py-2 border-r border-gray-100 align-middle">
                        <div className="flex flex-col gap-1 w-max">
                          {item.barcodes.map(b => (
                            <div key={b} onClick={() => handleCopy(b)} className="flex items-center gap-2 group/copy cursor-pointer">
                              <span className="text-[13px] font-medium text-[#1e3a5f] tracking-wide">{b}</span>
                              {copiedBarcode === b ? (
                                <Check size={14} className="text-green-500" />
                              ) : (
                                <Copy size={14} className="text-gray-300 group-hover/copy:text-blue-500 transition-colors" />
                              )}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* СКЛАДЫ */}
                      {visibleWarehouses.map(wh => {
                        const amount = item.stocks[wh.id] || 0;
                        return (
                          <td key={wh.id} className="px-4 py-2 text-center border-r border-gray-100 align-middle">
                            {amount > 0 ? <span className="text-[14px] font-bold text-gray-800">{amount}</span> : <span className="text-gray-300 font-medium">-</span>}
                          </td>
                        );
                      })}

                      {/* ИТОГОВОЕ КОЛИЧЕСТВО (ИЗМЕНЕНО: text-center) */}
                      <td className="px-4 py-2 text-center bg-blue-50/10 shadow-[-1px_0_0_0_#eff6ff] sticky right-0 z-10 border-l border-blue-50 align-middle">
                        <div className="inline-flex items-center justify-center min-w-[48px] h-[30px] px-2 bg-white border border-gray-200 rounded-md text-[14px] font-black text-gray-800 shadow-sm">
                          {visibleTotal}
                        </div>
                      </td>

                    </tr>
                  )
                })}
                {filteredItems.length === 0 && !isLoading && <tr><td colSpan={visibleWarehouses.length + 5} className="text-center p-12 text-gray-500 font-medium">По вашему запросу ничего не найдено.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ШТОРКА УВЕДОМЛЕНИЙ */}
      {isAlertsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsAlertsOpen(false)}>
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Bell size={18} className="text-blue-600" /> Уведомления {lastUpdated && <span className="text-[11px] font-normal text-gray-400 ml-1">({lastUpdated})</span>}
              </h2>
              <button onClick={() => setIsAlertsOpen(false)} className="p-1.5 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors shadow-sm cursor-pointer">
                <X size={16} />
              </button>
            </div>
            
            <div className="bg-blue-50 text-blue-700 text-[11px] text-center py-1.5 border-b border-blue-100 font-medium">
              Скрыты оповещения старше {HIDE_ALERTS_OLDER_THAN_DAYS} дней
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50/50">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                  <Package size={40} className="text-gray-300 mb-3" />
                  <p className="font-medium text-[15px] text-gray-700">Всё отлично!</p>
                  <p className="text-[13px] mt-1">Новых проблем с остатками не найдено.</p>
                </div>
              ) : (
                alerts.map(a => (
                  <div key={a.id} className={`p-3 rounded-xl border bg-white shadow-sm flex gap-3 items-start transition-all hover:shadow-md ${a.type === 'critical' ? 'border-red-200' : a.type === 'warning' ? 'border-orange-200' : 'border-blue-200'}`}>
                    <div className={`p-2 rounded-lg flex-shrink-0 ${a.type === 'critical' ? 'bg-red-50 text-red-500' : a.type === 'warning' ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'}`}>
                      {a.type === 'critical' ? <AlertOctagon size={16} /> : a.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className={`text-[13px] font-bold ${a.type === 'critical' ? 'text-red-700' : a.type === 'warning' ? 'text-orange-700' : 'text-blue-700'}`}>{a.title}</h4>
                        <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-100 px-1 py-0.5 rounded whitespace-nowrap"><Clock size={10}/> {a.timeText}</span>
                      </div>
                      <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">{a.desc}</p>
                      
                      <div className="flex items-center gap-3 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                         {a.item.photo ? (
                          <img src={a.item.photo} className="w-6 h-8 object-cover rounded shadow-sm border border-gray-200" />
                        ) : (
                          <div className="w-6 h-8 bg-gray-200 rounded flex items-center justify-center text-[7px] text-gray-400">Нет</div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-[10px] font-mono text-gray-600 font-bold">Арт: {a.item.vendorCode}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            {a.item.color && <span className="text-[9px] font-bold text-[#5a769a]">{a.item.color}</span>}
                            {a.item.techSize && a.item.techSize !== '0' && <span className="text-[9px] font-bold text-white bg-gray-600 px-1 py-[1px] rounded">{a.item.techSize}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}