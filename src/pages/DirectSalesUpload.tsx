import { useState, useMemo, useEffect } from 'react';
import { DownloadCloud, Search, Plus, X, Check, Loader2, ListTree, RotateCcw, Store, Truck } from 'lucide-react';
import { db, MyStockItem, ManualOrder, Supplier } from '../db';
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
  uniqueKey: string;
  type: 'local' | 'supplier';
  itemId?: number;       
  supplierId?: number;   
  title: string;         
  qty: number;
  costPrice: number;     
}

export default function DirectSalesUpload() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const suppliers = useLiveQuery(() => db.suppliers.toArray()) || []; 
  
  const [sheets, setSheets] = useState<string[]>(() => JSON.parse(sessionStorage.getItem('ds_sheets') || '[]'));
  const [activeSheet, setActiveSheet] = useState<string | null>(() => sessionStorage.getItem('ds_active_sheet') || null);
  const [ordersBySheet, setOrdersBySheet] = useState<Record<string, GoogleSheetOrder[]>>(() => JSON.parse(sessionStorage.getItem('ds_orders_by_sheet') || '{}'));
  
  const [selectedItemsByOrder, setSelectedItemsByOrder] = useState<Record<string, SelectedItem[]>>(() => JSON.parse(sessionStorage.getItem('ds_selected_v3') || '{}'));
  const [processedOrders, setProcessedOrders] = useState<Record<string, number[]>>(() => JSON.parse(sessionStorage.getItem('ds_processed_map_v2') || '{}'));
  
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [activeSearchTab, setActiveSearchTab] = useState<'local' | number>('local');
  const [searchQuery, setSearchQuery] = useState('');

  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzEiX2I76i9LreUN7HthYOJmqJQeK8a5owYD-oUwILxG1aiFczr2vFBRpamJSAld3Qf/exec";
  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => { sessionStorage.setItem('ds_sheets', JSON.stringify(sheets)); }, [sheets]);
  useEffect(() => { sessionStorage.setItem('ds_active_sheet', activeSheet || ''); }, [activeSheet]);
  useEffect(() => { sessionStorage.setItem('ds_orders_by_sheet', JSON.stringify(ordersBySheet)); }, [ordersBySheet]);
  useEffect(() => { sessionStorage.setItem('ds_selected_v3', JSON.stringify(selectedItemsByOrder)); }, [selectedItemsByOrder]);
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
          if (match && match.id) {
            let cost = match.price || 0;
            if (match.receipts && match.receipts.length > 0) cost = match.receipts[match.receipts.length - 1].price;
            autoMatches[order.id] = [{ 
              uniqueKey: `local-${match.id}`, 
              type: 'local', 
              itemId: match.id, 
              title: match.title, 
              qty: 1, 
              costPrice: cost 
            }];
          } else {
            autoMatches[order.id] = [];
          }
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

  const filteredLocalStock = useMemo(() => {
    if (activeSearchTab !== 'local') return [];
    if (!searchQuery) return stockItems.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return stockItems.filter(i => i.title.toLowerCase().includes(q) || (i.article && i.article.toLowerCase().includes(q))).slice(0, 20);
  }, [stockItems, searchQuery, activeSearchTab]);

  const activeSupplierData = useMemo(() => {
    if (activeSearchTab === 'local') return [];
    const sup = suppliers.find(s => s.id === activeSearchTab);
    return sup?.cachedData || [];
  }, [activeSearchTab, suppliers]);

  const filteredSupplierStock = useMemo(() => {
    if (activeSearchTab === 'local') return [];
    const itemsOnly = activeSupplierData.filter((r: any) => r.kind === 'item');
    if (!searchQuery) return itemsOnly.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return itemsOnly.filter((r: any) => r.title.toLowerCase().includes(q)).slice(0, 20);
  }, [activeSupplierData, searchQuery, activeSearchTab]);

  const handleAddLocalItem = (orderId: string, stockItem: MyStockItem) => {
    let cost = stockItem.price || 0;
    if (stockItem.receipts && stockItem.receipts.length > 0) cost = stockItem.receipts[stockItem.receipts.length - 1].price;

    setSelectedItemsByOrder(prev => {
      const currentItems = prev[orderId] || [];
      const uniqueKey = `local-${stockItem.id}`;
      const existingItemIndex = currentItems.findIndex(i => i.uniqueKey === uniqueKey);
      
      if (existingItemIndex >= 0) {
        const newItems = [...currentItems];
        newItems[existingItemIndex].qty += 1;
        return { ...prev, [orderId]: newItems };
      } else {
        return { ...prev, [orderId]: [...currentItems, { uniqueKey, type: 'local', itemId: stockItem.id!, title: stockItem.title, qty: 1, costPrice: cost }] };
      }
    });
    setActiveSearchId(null);
    setSearchQuery('');
  };

  const handleAddSupplierItem = (orderId: string, supplierId: number, row: any) => {
    const cost = parseFloat(String(row.wholesale || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    
    setSelectedItemsByOrder(prev => {
      const currentItems = prev[orderId] || [];
      const uniqueKey = `supplier-${supplierId}-${row.title}`;
      const existingItemIndex = currentItems.findIndex(i => i.uniqueKey === uniqueKey);
      
      if (existingItemIndex >= 0) {
        const newItems = [...currentItems];
        newItems[existingItemIndex].qty += 1;
        return { ...prev, [orderId]: newItems };
      } else {
        return { ...prev, [orderId]: [...currentItems, { uniqueKey, type: 'supplier', supplierId: supplierId, title: row.title, qty: 1, costPrice: cost }] };
      }
    });
    setActiveSearchId(null);
    setSearchQuery('');
  };

  const handleUpdateQty = (orderId: string, uniqueKey: string, newQty: number) => {
    if (newQty < 1) return;
    setSelectedItemsByOrder(prev => ({
      ...prev,
      [orderId]: prev[orderId].map(i => i.uniqueKey === uniqueKey ? { ...i, qty: newQty } : i)
    }));
  };

  const handleUpdateCost = (orderId: string, uniqueKey: string, newCost: number) => {
    if (newCost < 0) return;
    setSelectedItemsByOrder(prev => ({
      ...prev,
      [orderId]: prev[orderId].map(i => i.uniqueKey === uniqueKey ? { ...i, costPrice: newCost } : i)
    }));
  };

  const handleRemoveItem = (orderId: string, uniqueKey: string) => {
    setSelectedItemsByOrder(prev => ({
      ...prev,
      [orderId]: prev[orderId].filter(i => i.uniqueKey !== uniqueKey)
    }));
  };

  const handleProcessOrder = async (orderId: string, orderData: GoogleSheetOrder) => {
    const itemsToProcess = selectedItemsByOrder[orderId];
    if (!itemsToProcess || itemsToProcess.length === 0) {
      return alert('Добавьте хотя бы один товар со склада или от поставщика для списания!');
    }

    for (const item of itemsToProcess) {
      if (item.type === 'local') {
        const stock = stockItems.find(s => s.id === item.itemId);
        if (stock && stock.quantity < item.qty) {
          if (!window.confirm(`Внимание: Локального товара "${stock.title}" не хватает на складе (Остаток: ${stock.quantity} шт, Списываем: ${item.qty} шт). Уйдет в минус. Продолжить?`)) {
            return;
          }
        }
      }
    }

    const now = new Date().toISOString();
    const totalQty = itemsToProcess.reduce((sum, item) => sum + item.qty, 0);
    const salePricePerUnit = Number(orderData.sellPrice) / totalQty;
    
    const createdManualOrderIds: number[] = [];

    await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
      for (const item of itemsToProcess) {
        
        if (item.type === 'local') {
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
        
        else if (item.type === 'supplier') {
          const supplierName = suppliers.find(s => s.id === item.supplierId)?.title || 'Поставщик';
          
          const newOrderId = await db.manualOrders.add({
            myStockItemId: 0, 
            title: `[${supplierName}] ${item.title}`,
            quantity: item.qty,
            salePrice: Number(salePricePerUnit.toFixed(2)),
            shippingType: 'Прямая продажа' as any,
            date: todayStr,
            createdAt: now
          });
          
          createdManualOrderIds.push(newOrderId as number);
        }
      }
    });

    setProcessedOrders(prev => ({ ...prev, [orderId]: createdManualOrderIds }));
  };

  const handleUndoOrder = async (orderId: string) => {
    if (!window.confirm('Отменить списание? Локальные товары вернутся на склад, а строка разблокируется.')) return;

    const manualOrderIds = processedOrders[orderId];
    if (manualOrderIds && manualOrderIds.length > 0) {
      const now = new Date().toISOString();
      
      await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
        for (const mId of manualOrderIds) {
          const mOrder = await db.manualOrders.get(mId);
          if (mOrder) {
            
            if (mOrder.myStockItemId !== 0) {
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

      {/* ГЛАВНЫЙ КОНТЕЙНЕР СКРОЛЛА */}
      <div className="flex-1 overflow-auto bg-[#f8f9fa] relative z-0">
        {/* ВНУТРЕННИЙ КОНТЕЙНЕР ДЛЯ ОТСТУПОВ (Скроллится ВМЕСТЕ с таблицей, скрывая стык) */}
        <div className="p-4">
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
            <div className="border border-[#cccccc] shadow-sm inline-block min-w-full pb-[400px] bg-white">
              
              <table className="w-full border-collapse font-sans text-[12px] text-gray-900 table-fixed min-w-[1100px]">
                {/* ЖЕСТКО ЗАФИКСИРОВАННАЯ ШАПКА */}
                <thead className="text-[#333]">
                  <tr>
                    <th className="sticky top-0 z-[200] bg-[#e8eaed] border border-[#cccccc] py-1 px-2 font-normal text-center" style={{ width: 40, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}></th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-left" style={{ width: 90, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Дата</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-left" style={{ width: 750, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Наименование</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 70, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Опт</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 80, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Продажа</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-right" style={{ width: 80, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Прибыль</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-left" style={{ boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Списание со склада (Ваш или Поставщика)</th>
                    <th className="sticky top-0 z-[200] bg-[#f3f3f3] border border-[#cccccc] py-1 px-2 font-bold text-center" style={{ width: 100, boxShadow: '0 1px 0 #cccccc, 0 -1px 0 #cccccc' }}>Статус</th>
                  </tr>
                </thead>

                <tbody>
                  {currentSheetData.map((order, index) => {
                    const items = selectedItemsByOrder[order.id] || [];
                    const isMatched = items.length > 0;
                    const isProcessed = !!processedOrders[order.id];
                    
                    let currentBuyPrice = Number(order.buyPrice); 
                    let isPriceFromSelection = false;
                    let hasSupplierItems = false;
                    let hasLocalItems = false;

                    if (items.length > 0) {
                      const totalCost = items.reduce((sum, item) => sum + (item.costPrice * item.qty), 0);
                      currentBuyPrice = totalCost;
                      isPriceFromSelection = true;
                      
                      hasLocalItems = items.some(i => i.type === 'local');
                      hasSupplierItems = items.some(i => i.type === 'supplier');
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
                          className="border border-[#cccccc] py-1 px-2 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-black" 
                          title={order.name}
                          style={{ backgroundColor: order.bgColor && order.bgColor !== '#ffffff' ? order.bgColor : undefined }}
                        >
                          {order.name}
                        </td>

                        <td className="border border-[#cccccc] py-1 px-2 text-right overflow-hidden text-ellipsis">
                          {currentBuyPrice.toFixed(2)}
                          {isPriceFromSelection && (
                            <span className={`text-[9px] block leading-none ${hasSupplierItems && !hasLocalItems ? 'text-purple-500' : hasLocalItems && !hasSupplierItems ? 'text-blue-500' : 'text-orange-500'}`}>
                              {hasSupplierItems && !hasLocalItems ? 'От Поставщ.' : hasLocalItems && !hasSupplierItems ? 'Склад (БД)' : 'Смешано'}
                            </span>
                          )}
                        </td>

                        <td className="border border-[#cccccc] py-1 px-2 text-right font-bold overflow-hidden text-ellipsis">
                          {order.sellPrice}
                        </td>

                        <td className={`border border-[#cccccc] py-1 px-2 text-right font-bold overflow-hidden text-ellipsis ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : ''}`}>
                          {profit.toFixed(2)}
                        </td>

                        <td className={`border border-[#cccccc] py-1 px-2 align-top ${activeSearchId === order.id ? 'relative z-50' : 'relative z-10'}`}>
                          <div className="flex flex-col gap-1 w-full">
                            
                            {items.map(selectedItem => (
                              <div key={selectedItem.uniqueKey} className={`flex items-center justify-between px-1.5 py-1.5 rounded border ${isProcessed ? 'bg-transparent border-transparent' : (selectedItem.type === 'local' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200')}`}>
                                <div className="flex flex-col min-w-0 flex-1 pr-2">
                                  <span className="truncate text-[11px] font-bold text-gray-800" title={selectedItem.title}>{selectedItem.title}</span>
                                  <span className="text-[9px] text-gray-500 font-medium flex items-center gap-1 mt-0.5">
                                    {selectedItem.type === 'local' ? <><Store size={10}/> Мой склад</> : <><Truck size={10}/> Поставщик: {suppliers.find(s=>s.id === selectedItem.supplierId)?.title}</>}
                                  </span>
                                </div>
                                
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  {selectedItem.type === 'supplier' ? (
                                    <div className="flex items-center gap-1" title="Оптовая цена поставщика (редактируемая)">
                                      <span className="text-[10px] font-bold text-gray-400">Опт:</span>
                                      <input 
                                        type="number" min="0" disabled={isProcessed}
                                        value={selectedItem.costPrice === 0 ? '' : selectedItem.costPrice}
                                        onChange={(e) => handleUpdateCost(order.id, selectedItem.uniqueKey, Number(e.target.value))}
                                        className="w-14 h-6 text-right px-1 text-[11px] font-bold border border-gray-300 rounded outline-none focus:border-purple-500 disabled:bg-transparent disabled:border-transparent bg-white shadow-sm"
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-[11px] font-bold text-gray-600 mr-1" title="Оптовая цена со склада">
                                      <span className="text-[9px] font-normal text-gray-400 mr-1">Опт:</span>{selectedItem.costPrice}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-bold text-gray-400">Шт:</span>
                                    <input 
                                      type="number" min="1" disabled={isProcessed}
                                      value={selectedItem.qty}
                                      onChange={(e) => handleUpdateQty(order.id, selectedItem.uniqueKey, Number(e.target.value))}
                                      className="w-10 h-6 text-center text-[11px] font-bold border border-gray-300 rounded outline-none focus:border-blue-500 disabled:bg-transparent disabled:border-transparent bg-white shadow-sm"
                                    />
                                    {!isProcessed && (
                                      <button onClick={() => handleRemoveItem(order.id, selectedItem.uniqueKey)} className="text-gray-400 hover:text-red-500 ml-1 transition-colors">
                                        <X size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}

                            {!isProcessed && (
                              <div className="relative mt-0.5">
                                <button 
                                  onClick={() => { 
                                    if(activeSearchId === order.id) {
                                      setActiveSearchId(null);
                                    } else {
                                      setActiveSearchId(order.id); 
                                      setSearchQuery(''); 
                                      setActiveSearchTab('local');
                                    }
                                  }} 
                                  className="text-[11px] text-blue-600 hover:text-blue-800 text-left px-1 w-max flex items-center gap-1 font-bold"
                                >
                                  <Plus size={12} strokeWidth={3} className={activeSearchId === order.id ? 'rotate-45 transition-transform' : 'transition-transform'}/> 
                                  {activeSearchId === order.id ? 'Закрыть поиск' : 'добавить товар для списания'}
                                </button>
                                
                                {activeSearchId === order.id && (
                                  <div className="absolute left-0 top-full mt-1 z-[100] bg-white border border-gray-300 shadow-2xl rounded-lg w-[450px] overflow-hidden">
                                    
                                    <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50 rounded-t-lg p-1.5 gap-1 select-none custom-scrollbar">
                                      <button
                                        onClick={() => setActiveSearchTab('local')}
                                        className={`px-3 py-1.5 text-[11px] font-bold rounded-md whitespace-nowrap transition-all ${activeSearchTab === 'local' ? 'bg-white shadow-sm text-blue-700 border border-gray-200' : 'text-gray-500 hover:bg-gray-200 border border-transparent'}`}
                                      >
                                        <Store size={12} className="inline-block mr-1 mb-0.5"/> Мой склад
                                      </button>
                                      {suppliers.map(sup => (
                                        <button
                                          key={sup.id}
                                          onClick={() => setActiveSearchTab(sup.id!)}
                                          className={`px-3 py-1.5 text-[11px] font-bold rounded-md whitespace-nowrap transition-all ${activeSearchTab === sup.id ? 'bg-white shadow-sm text-purple-700 border border-gray-200' : 'text-gray-500 hover:bg-gray-200 border border-transparent'}`}
                                        >
                                          <Truck size={12} className="inline-block mr-1 mb-0.5"/> {sup.title}
                                        </button>
                                      ))}
                                    </div>

                                    <div className="p-2 bg-white border-b border-gray-100">
                                      <div className="relative">
                                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                        <input 
                                          autoFocus
                                          type="text" 
                                          value={searchQuery}
                                          onChange={e => setSearchQuery(e.target.value)}
                                          placeholder={activeSearchTab === 'local' ? "Поиск по локальному складу..." : "Поиск в прайсе поставщика..."} 
                                          className="w-full h-8 pl-8 pr-10 text-[12px] border border-gray-300 focus:border-blue-500 rounded outline-none shadow-inner bg-gray-50"
                                        />
                                        <button 
                                          onClick={() => { setActiveSearchId(null); setSearchQuery(''); setActiveSearchTab('local'); }} 
                                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-800 bg-gray-200/50 hover:bg-gray-200 p-1.5 rounded-md transition-colors"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    
                                    <div className="max-h-[280px] overflow-y-auto block bg-white rounded-b-lg overscroll-none custom-scrollbar">
                                      {activeSearchTab === 'local' ? (
                                        filteredLocalStock.length > 0 ? (
                                          filteredLocalStock.map(item => (
                                            <div key={`local-${item.id}`} onClick={() => handleAddLocalItem(order.id, item)} className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-50 flex justify-between items-center transition-colors">
                                              <span className="truncate pr-2 text-[11px] font-medium text-gray-800">{item.title}</span>
                                              <span className="text-[10px] text-blue-700 whitespace-nowrap bg-blue-100 px-1.5 py-0.5 rounded font-bold">Ост: {item.quantity}</span>
                                            </div>
                                          ))
                                        ) : (
                                          <div className="px-3 py-4 text-gray-400 text-[11px] text-center">Товары не найдены на локальном складе</div>
                                        )
                                      ) : (
                                        filteredSupplierStock.length > 0 ? (
                                          filteredSupplierStock.map((item, i) => (
                                            <div key={`sup-${i}`} onClick={() => handleAddSupplierItem(order.id, activeSearchTab as number, item)} className="px-3 py-2 hover:bg-purple-50 cursor-pointer border-b border-gray-50 flex justify-between items-center transition-colors">
                                              <div className="flex flex-col overflow-hidden pr-2">
                                                <span className="truncate text-[11px] font-medium text-gray-800">{item.title}</span>
                                                <span className="text-[9px] text-gray-400">{item.category || 'Без категории'}</span>
                                              </div>
                                              <div className="flex items-center gap-2 flex-shrink-0">
                                                <span className="text-[10px] text-purple-700 whitespace-nowrap bg-purple-100 px-1.5 py-0.5 rounded font-bold">Опт: {item.wholesale || '—'}</span>
                                              </div>
                                            </div>
                                          ))
                                        ) : (
                                          <div className="px-3 py-4 text-gray-400 text-[11px] text-center">Товары не найдены в прайсе поставщика</div>
                                        )
                                      )}
                                    </div>

                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="border border-[#cccccc] py-1 px-2 text-center align-middle">
                          {isProcessed ? (
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <span className="flex items-center justify-center gap-1 text-green-700 font-bold text-[11px]">
                                <Check size={14} strokeWidth={3} /> Готово
                              </span>
                              <button 
                                onClick={() => handleUndoOrder(order.id)}
                                className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors px-2 py-0.5 rounded border border-transparent hover:border-red-200 hover:bg-red-50"
                                title="Отменить списание и разблокировать строку"
                              >
                                <RotateCcw size={10} /> отменить
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => handleProcessOrder(order.id, order)}
                              disabled={!isMatched}
                              className={`w-full py-1.5 text-[11px] font-bold rounded transition-colors ${
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
      </div>
    </PageLayout>
  );
}