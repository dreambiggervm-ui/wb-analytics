import { useState, useMemo, useEffect } from 'react';
import { DownloadCloud, Search, Plus, X, Check, Loader2, ListTree, RotateCcw } from 'lucide-react';
import { db, MyStockItem, ManualOrder } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar } from '../components/ui';

interface GoogleSheetOrder {
  id: string;
  sheetName: string;
  deliveryDate: string;
  name: string;
  sellPrice: number;
  buyPrice: number;
  bgColor: string;
}

interface SelectedItem {
  itemId: number;
  qty: number;
}

export default function DirectSalesUpload() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  
  const [sheets, setSheets] = useState<string[]>(() => JSON.parse(sessionStorage.getItem('ds_sheets') || '[]'));
  const [activeSheet, setActiveSheet] = useState<string | null>(() => sessionStorage.getItem('ds_active_sheet') || null);
  const [ordersBySheet, setOrdersBySheet] = useState<Record<string, GoogleSheetOrder[]>>(() => JSON.parse(sessionStorage.getItem('ds_orders_by_sheet') || '{}'));
  
  const [selectedItemsByOrder, setSelectedItemsByOrder] = useState<Record<string, SelectedItem[]>>(() => JSON.parse(sessionStorage.getItem('ds_selected') || '{}'));
  const [processedOrders, setProcessedOrders] = useState<Record<string, number[]>>(() => JSON.parse(sessionStorage.getItem('ds_processed_map_v2') || '{}'));
  
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzEiX2I76i9LreUN7HthYOJmqJQeK8a5owYD-oUwILxG1aiFczr2vFBRpamJSAld3Qf/exec";
  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => { sessionStorage.setItem('ds_sheets', JSON.stringify(sheets)); }, [sheets]);
  useEffect(() => { sessionStorage.setItem('ds_active_sheet', activeSheet || ''); }, [activeSheet]);
  useEffect(() => { sessionStorage.setItem('ds_orders_by_sheet', JSON.stringify(ordersBySheet)); }, [ordersBySheet]);
  useEffect(() => { sessionStorage.setItem('ds_selected', JSON.stringify(selectedItemsByOrder)); }, [selectedItemsByOrder]);
  useEffect(() => { sessionStorage.setItem('ds_processed_map_v2', JSON.stringify(processedOrders)); }, [processedOrders]);

  const fetchSheetsList = async () => {
    setLoadingSheets(true);
    try {
      const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=getSheets`);
      const data: string[] = await response.json();
      
      const reversedSheets = [...data].reverse();
      setSheets(reversedSheets);

      if (reversedSheets.length > 0 && !activeSheet) {
        setActiveSheet(reversedSheets[0]);
        fetchSheetData(reversedSheets[0]);
      }
    } catch (error) {
      alert('Ошибка при загрузке списка листов.');
      console.error(error);
    } finally {
      setLoadingSheets(false);
    }
  };

  const fetchSheetData = async (sheetName: string, forceSync = false) => {
    if (ordersBySheet[sheetName] && !forceSync) return;

    setLoadingData(true);
    try {
      const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=getSheetData&sheetName=${encodeURIComponent(sheetName)}`);
      const data: GoogleSheetOrder[] = await response.json();
      
      const reversedData = data.reverse(); 
      
      setOrdersBySheet(prev => ({ ...prev, [sheetName]: reversedData }));

      const autoMatches: Record<string, SelectedItem[]> = {};
      reversedData.forEach((order) => {
        if (!selectedItemsByOrder[order.id]) {
          const match = stockItems.find(p => p.title.toLowerCase().trim() === order.name.toLowerCase().trim());
          autoMatches[order.id] = match && match.id ? [{ itemId: match.id, qty: 1 }] : [];
        }
      });
      
      if (Object.keys(autoMatches).length > 0) {
        setSelectedItemsByOrder(prev => ({ ...prev, ...autoMatches }));
      }

    } catch (error) {
      alert(`Ошибка при загрузке данных листа "${sheetName}".`);
      console.error(error);
    } finally {
      setLoadingData(false);
    }
  };

  const handleTabChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sheetName = e.target.value;
    setActiveSheet(sheetName);
    fetchSheetData(sheetName);
  };

  const filteredStock = useMemo(() => {
    if (!searchQuery) return stockItems.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return stockItems.filter(i => 
      i.title.toLowerCase().includes(q) || (i.article && i.article.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [stockItems, searchQuery]);

  const handleAddItem = (orderId: string, stockItem: MyStockItem) => {
    setSelectedItemsByOrder(prev => {
      const currentItems = prev[orderId] || [];
      const existingItemIndex = currentItems.findIndex(i => i.itemId === stockItem.id);
      
      if (existingItemIndex >= 0) {
        const newItems = [...currentItems];
        newItems[existingItemIndex].qty += 1;
        return { ...prev, [orderId]: newItems };
      } else {
        return { ...prev, [orderId]: [...currentItems, { itemId: stockItem.id!, qty: 1 }] };
      }
    });
    setActiveSearchId(null);
    setSearchQuery('');
  };

  const handleUpdateQty = (orderId: string, itemId: number, newQty: number) => {
    if (newQty < 1) return;
    setSelectedItemsByOrder(prev => ({
      ...prev,
      [orderId]: prev[orderId].map(i => i.itemId === itemId ? { ...i, qty: newQty } : i)
    }));
  };

  const handleRemoveItem = (orderId: string, itemId: number) => {
    setSelectedItemsByOrder(prev => ({
      ...prev,
      [orderId]: prev[orderId].filter(i => i.itemId !== itemId)
    }));
  };

  const handleProcessOrder = async (orderId: string, orderData: GoogleSheetOrder) => {
    const itemsToProcess = selectedItemsByOrder[orderId];
    if (!itemsToProcess || itemsToProcess.length === 0) {
      return alert('Добавьте хотя бы один товар со склада для списания!');
    }

    for (const item of itemsToProcess) {
      const stock = stockItems.find(s => s.id === item.itemId);
      if (stock && stock.quantity < item.qty) {
        if (!window.confirm(`Внимание: Товара "${stock.title}" не хватает на складе (Остаток: ${stock.quantity} шт, Списываем: ${item.qty} шт). Остаток уйдет в минус. Продолжить?`)) {
          return;
        }
      }
    }

    const now = new Date().toISOString();
    const totalQty = itemsToProcess.reduce((sum, item) => sum + item.qty, 0);
    const salePricePerUnit = Number(orderData.sellPrice) / totalQty;
    
    const createdManualOrderIds: number[] = [];

    await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
      for (const item of itemsToProcess) {
        const stock = stockItems.find(s => s.id === item.itemId);
        if (!stock) continue;

        const newQty = stock.quantity - item.qty;

        const newOrderId = await db.manualOrders.add({
          myStockItemId: stock.id!,
          title: stock.title,
          quantity: item.qty,
          salePrice: Number(salePricePerUnit.toFixed(2)),
          shippingType: 'Прямая продажа' as any,
          date: todayStr,
          createdAt: now
        });
        
        createdManualOrderIds.push(newOrderId as number);
        
        await db.myWarehouse.update(stock.id!, { quantity: newQty } as any);
        
        await db.myWarehouseChanges.add({
          itemId: stock.id,
          title: stock.title,
          field: 'Остаток (Прямая продажа Excel)',
          oldValue: String(stock.quantity),
          newValue: String(newQty),
          changeDate: now
        });
      }
    });

    setProcessedOrders(prev => ({ ...prev, [orderId]: createdManualOrderIds }));
  };

  const handleUndoOrder = async (orderId: string) => {
    if (!window.confirm('Отменить списание? Товары вернутся на склад, а строка разблокируется.')) return;

    const manualOrderIds = processedOrders[orderId];
    if (manualOrderIds && manualOrderIds.length > 0) {
      const now = new Date().toISOString();
      
      await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
        for (const mId of manualOrderIds) {
          const mOrder = await db.manualOrders.get(mId);
          if (mOrder) {
            const stock = await db.myWarehouse.get(mOrder.myStockItemId);
            if (stock) {
              const restoredQty = stock.quantity + mOrder.quantity;
              await db.myWarehouse.update(stock.id!, { quantity: restoredQty } as any);
              
              await db.myWarehouseChanges.add({
                itemId: stock.id,
                title: stock.title,
                field: 'Остаток (Отмена прямой продажи)',
                oldValue: String(stock.quantity),
                newValue: String(restoredQty),
                changeDate: now
              });
            }
            await db.manualOrders.delete(mId);
          }
        }
      });
    }

    setProcessedOrders(prev => {
      const copy = { ...prev };
      delete copy[orderId];
      return copy;
    });
  };

  const currentSheetData = activeSheet ? (ordersBySheet[activeSheet] || []) : [];

  return (
    <PageLayout>
      <Toolbar>
        <h1 className="text-[16px] font-bold text-[#1e3a5f] uppercase tracking-wider">Загрузка заказов</h1>
        <div className="flex gap-3">
          {activeSheet && (
            <button
              onClick={() => fetchSheetData(activeSheet, true)}
              disabled={loadingData}
              className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
              title="Обновить данные открытого месяца"
            >
              {loadingData ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
              Синхронизировать лист
            </button>
          )}
          <button
            onClick={fetchSheetsList}
            disabled={loadingSheets}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-2 transition-colors disabled:bg-blue-300 shadow-sm"
          >
            {loadingSheets ? <Loader2 size={16} className="animate-spin" /> : <ListTree size={16} />}
            Загрузить список листов
          </button>
        </div>
      </Toolbar>

      {sheets.length > 0 && (
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 select-none w-full shadow-sm relative z-10">
          <label className="text-[13px] font-bold text-gray-700 uppercase tracking-wider">Открытый лист:</label>
          <select
            value={activeSheet || ''}
            onChange={handleTabChange}
            className="border border-gray-300 rounded-lg px-4 py-2 text-[14px] font-bold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-gray-50 min-w-[250px] shadow-sm cursor-pointer transition-all"
          >
            {sheets.map(sheet => (
              <option key={sheet} value={sheet}>{sheet}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-[#f8f9fa] p-4">
        {sheets.length === 0 ? (
          <div className="text-center text-gray-500 mt-20 text-[14px]">
            Нажмите «Загрузить список листов» для начала работы...
          </div>
        ) : loadingData && currentSheetData.length === 0 ? (
          <div className="text-center text-gray-500 mt-20 text-[14px] flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-blue-500" />
            Загрузка данных листа "{activeSheet}"...
          </div>
        ) : currentSheetData.length === 0 ? (
          <div className="text-center text-gray-500 mt-20 text-[14px]">
            В этом листе нет данных для проведения.
          </div>
        ) : (
          <div className="border border-[#cccccc] shadow-sm inline-block min-w-full pb-32 bg-white">
            
            <table className="w-full border-collapse font-sans text-[12px] text-gray-900 table-fixed min-w-[1100px]">
              
              <thead className="bg-[#f3f3f3] text-[#333] sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="border border-[#cccccc] py-1 px-2 font-normal text-center bg-[#e8eaed]" style={{ width: 40 }}></th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-left" style={{ width: 90 }}>Дата</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-left" style={{ width: 250 }}>Наименование</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 70 }}>Опт</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 80 }}>Продажа</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 80 }}>Прибыль</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-left">Списание со склада</th>
                  <th className="border border-[#cccccc] py-1 px-2 font-bold text-center" style={{ width: 100 }}>Статус</th>
                </tr>
              </thead>

              <tbody>
                {currentSheetData.map((order, index) => {
                  const items = selectedItemsByOrder[order.id] || [];
                  const isMatched = items.length > 0;
                  const isProcessed = !!processedOrders[order.id];
                  
                  // ИСПРАВЛЕННЫЙ ИМПОРТ ОПТОВОЙ ЦЕНЫ ИЗ БАЗЫ ДАННЫХ
                  let currentBuyPrice = Number(order.buyPrice); 
                  let isPriceFromDb = false;

                  if (items.length > 0) {
                    const warehouseCost = items.reduce((sum, item) => {
                      const stockItem = stockItems.find(s => s.id === item.itemId);
                      let cost = 0;
                      if (stockItem) {
                        // Берем цену из последнего поступления товара (партия)
                        if (stockItem.receipts && stockItem.receipts.length > 0) {
                          cost = stockItem.receipts[stockItem.receipts.length - 1].price;
                        } else {
                          // Если поступлений нет, берем базовую цену из карточки товара
                          cost = stockItem.price || 0;
                        }
                      }
                      return sum + (cost * item.qty);
                    }, 0);
                    
                    if (warehouseCost > 0) {
                      currentBuyPrice = warehouseCost; 
                      isPriceFromDb = true;
                    }
                  }

                  const profit = Number(order.sellPrice) - currentBuyPrice;

                  return (
                    <tr key={order.id} className={`hover:bg-gray-50 transition-colors ${isProcessed ? 'bg-green-50/30 text-gray-500' : 'bg-white'}`}>
                      
                      <td className="border border-[#cccccc] py-1 px-2 text-center text-gray-400 bg-[#f8f9fa] select-none">
                        {index + 1}
                      </td>

                      <td className="border border-[#cccccc] py-1 px-2 whitespace-nowrap overflow-hidden text-ellipsis">
                        <div className="font-bold">{new Date(order.deliveryDate).toLocaleDateString('ru-RU')}</div>
                      </td>

                      <td 
                        className={`border border-[#cccccc] py-1 px-2 font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isProcessed ? 'opacity-50' : 'text-black'}`} 
                        title={order.name}
                        style={{ backgroundColor: isProcessed ? '#e8eaed' : (order.bgColor && order.bgColor !== '#ffffff' ? order.bgColor : undefined) }}
                      >
                        {order.name}
                      </td>

                      <td className="border border-[#cccccc] py-1 px-2 text-right overflow-hidden text-ellipsis" title={isPriceFromDb ? 'Цена импортирована со склада' : 'Цена из Google Таблицы'}>
                        {currentBuyPrice.toFixed(2)}
                        {isPriceFromDb && <span className="text-[9px] text-blue-500 block leading-none">Из БД</span>}
                      </td>

                      <td className="border border-[#cccccc] py-1 px-2 text-right font-bold overflow-hidden text-ellipsis">
                        {order.sellPrice}
                      </td>

                      <td className={`border border-[#cccccc] py-1 px-2 text-right font-bold overflow-hidden text-ellipsis ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : ''}`}>
                        {profit.toFixed(2)}
                      </td>

                      <td className="border border-[#cccccc] py-1 px-2 align-top relative">
                        <div className="flex flex-col gap-1 w-full">
                          
                          {items.map(selectedItem => {
                            const stockItem = stockItems.find(s => s.id === selectedItem.itemId);
                            if (!stockItem) return null;
                            
                            return (
                              <div key={selectedItem.itemId} className={`flex items-center justify-between px-1.5 py-0.5 rounded border ${isProcessed ? 'bg-transparent border-transparent' : 'bg-blue-50 border-blue-200'}`}>
                                <span className="truncate max-w-[200px]" title={stockItem.title}>{stockItem.title}</span>
                                <div className="flex items-center gap-1 ml-2">
                                  <input 
                                    type="number" 
                                    min="1"
                                    disabled={isProcessed}
                                    value={selectedItem.qty}
                                    onChange={(e) => handleUpdateQty(order.id, selectedItem.itemId, Number(e.target.value))}
                                    className="w-10 h-5 text-center text-[11px] border border-gray-300 rounded outline-none focus:border-blue-500 disabled:bg-transparent disabled:border-transparent"
                                  />
                                  {!isProcessed && (
                                    <button onClick={() => handleRemoveItem(order.id, selectedItem.itemId)} className="text-gray-400 hover:text-red-500">
                                      <X size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}

                          {!isProcessed && (
                            activeSearchId === order.id ? (
                              <div className="relative mt-0.5 z-30">
                                <Search size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input 
                                  autoFocus
                                  type="text" 
                                  value={searchQuery}
                                  onChange={e => setSearchQuery(e.target.value)}
                                  placeholder="Поиск..." 
                                  className="w-full h-6 pl-6 pr-6 text-[11px] border border-blue-400 rounded outline-none shadow-sm"
                                />
                                <button onClick={() => { setActiveSearchId(null); setSearchQuery(''); }} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400">
                                  <X size={12} />
                                </button>
                                
                                <div className="absolute top-full left-0 w-[350px] mt-1 bg-white border border-gray-300 shadow-xl max-h-[250px] overflow-y-auto custom-scrollbar z-50">
                                  {filteredStock.length > 0 ? (
                                    filteredStock.map(item => (
                                      <div key={item.id} onClick={() => handleAddItem(order.id, item)} className="px-2 py-1.5 hover:bg-blue-50 cursor-pointer border-b border-gray-100 flex justify-between items-center">
                                        <span className="truncate pr-2">{item.title}</span>
                                        <span className="text-[10px] text-gray-500 whitespace-nowrap bg-gray-100 px-1 rounded">Ост: {item.quantity}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="px-2 py-1.5 text-gray-400 text-[11px]">Не найдено</div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => { setActiveSearchId(order.id); setSearchQuery(''); }} className="text-[11px] text-blue-600 hover:text-blue-800 text-left px-1 mt-0.5 w-max flex items-center gap-1">
                                <Plus size={10} /> добавить товар
                              </button>
                            )
                          )}
                        </div>
                      </td>

                      <td className="border border-[#cccccc] py-1 px-2 text-center align-middle">
                        {isProcessed ? (
                          <div className="flex flex-col items-center justify-center gap-1">
                            <span className="flex items-center justify-center gap-1 text-green-700 font-bold text-[11px]">
                              <Check size={14} strokeWidth={3} /> Готово
                            </span>
                            <button 
                              onClick={() => handleUndoOrder(order.id)}
                              className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                              title="Отменить списание и вернуть на склад"
                            >
                              <RotateCcw size={10} /> отменить
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleProcessOrder(order.id, order)}
                            disabled={!isMatched}
                            className={`w-full py-1 text-[11px] font-bold rounded transition-colors ${
                              isMatched ? 'bg-green-500 hover:bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            Списать
                          </button>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}