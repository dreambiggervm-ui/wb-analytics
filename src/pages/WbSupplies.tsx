import { useState, useMemo } from 'react';
import { RefreshCw, Package, Truck, Clock, Box, CheckCircle2, MinusCircle, ListChecks, LinkIcon, AlertTriangle } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, Button, TableWrapper, SearchInput } from '../components/ui';

const API_KEY = import.meta.env.VITE_WB_API_KEY_MARKETPLACE;

const STATUS_MAP: Record<string, { text: string, color: string }> = {
  'new': { text: 'Новое', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'confirm': { text: 'На сборке', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  'complete': { text: 'В доставке', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  'cancel': { text: 'Отменено', color: 'bg-red-50 text-red-700 border-red-200' },
  'deliver': { text: 'Доставлено', color: 'bg-green-50 text-green-700 border-green-200' },
  'receive': { text: 'Принято', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
};

// Вспомогательная функция для параллельных запросов пачками
const chunkArray = <T,>(arr: T[], size: number): T[][] => 
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

export default function WbSupplies() {
  const supplies = useLiveQuery(() => db.wbSupplies.orderBy('createdAt').reverse().toArray()) || [];
  const orders = useLiveQuery(() => db.wbOrders.toArray()) || [];
  
  // Подтягиваем данные для связей
  const myWarehouse = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const wbLinks = useLiveQuery(() => db.wbLinks.toArray()) || [];
  
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSupplyId, setSelectedSupplyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [tab, setTab] = useState<'active' | 'archive'>('active');

  // Вспомогательная функция: Найти товар на складе по связи (nmId) ИЛИ по названию
  const getMatchedWarehouseItem = (order: any) => {
    // 1. Ищем через жесткую связь
    if (order.nmId) {
      const link = wbLinks.find(l => l.nmId === order.nmId);
      if (link) {
        const found = myWarehouse.find(m => m.id === link.myStockItemId);
        if (found) return found;
      }
    }
    // 2. Ищем по совпадению названия или артикула
    return myWarehouse.find(i => 
      i.title.toLowerCase().trim() === (order.title || '').toLowerCase().trim() || 
      (i.article && i.article === order.article)
    );
  };

  // =================================================================
  // 1. УМНАЯ СИНХРОНИЗАЦИЯ С ПАГИНАЦИЕЙ (ОПТИМИЗИРОВАННАЯ)
  // =================================================================
  const handleRefresh = async () => {
    if (!API_KEY) return alert('API Ключ "Маркетплейс" не указан в файле .env');
    setIsLoading(true);

    try {
      let allOrders: any[] = [];
      let nextOrd = 0;
      const dateFrom = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60);

      // Загрузка заказов
      while (true) {
        const resOrd = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=1000&next=${nextOrd}&dateFrom=${dateFrom}`, { headers: { Authorization: API_KEY } });
        if (!resOrd.ok) break;
        const ordData = await resOrd.json();
        if (ordData.orders) allOrders.push(...ordData.orders);
        nextOrd = ordData.next;
        if (!nextOrd) break; 
      }

      // Загрузка поставок
      let allSupplies: any[] = [];
      let nextSup = 0;
      while (true) {
        const resSup = await fetch(`https://marketplace-api.wildberries.ru/api/v3/supplies?limit=1000&next=${nextSup}`, { headers: { Authorization: API_KEY } });
        if (!resSup.ok) break;
        const supData = await resSup.json();
        if (supData.supplies) allSupplies.push(...supData.supplies);
        nextSup = supData.next;
        if (!nextSup) break;
      }

      allSupplies.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const recentSupplies = allSupplies.slice(0, 40);

      // ОПТИМИЗАЦИЯ 1: Параллельная загрузка составов поставок (батчами по 10) + Map
      const orderToSupplyMap = new Map();
      const supplyBatches = chunkArray(recentSupplies, 10);
      
      for (const batch of supplyBatches) {
        await Promise.all(batch.map(async (sup) => {
          try {
            const resSupOrd = await fetch(`https://marketplace-api.wildberries.ru/api/v3/supplies/${sup.id}/orders`, { headers: { Authorization: API_KEY } });
            if (resSupOrd.ok) {
              const supOrdData = await resSupOrd.json();
              const orderIdsInSupply = supOrdData.orders || [];
              orderIdsInSupply.forEach((id: number) => orderToSupplyMap.set(id, sup.id));
            }
          } catch (e) {
            console.error(`Ошибка загрузки заказов поставки ${sup.id}`, e);
          }
        }));
      }

      // ОПТИМИЗАЦИЯ 2: Параллельная загрузка статусов заказов + Map
      const statusMap = new Map();
      const orderIds = allOrders.map(o => o.id);
      const orderChunks = chunkArray(orderIds, 1000);
      const statusBatches = chunkArray(orderChunks, 5);
      
      for (const batch of statusBatches) {
        await Promise.all(batch.map(async (chunk) => {
          try {
            const resStat = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders/status`, {
              method: 'POST',
              headers: { Authorization: API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ orders: chunk })
            });
            if (resStat.ok) {
              const statData = await resStat.json();
              const statuses = statData.orders || [];
              statuses.forEach((s: any) => statusMap.set(s.id, s.supplierStatus));
            }
          } catch (e) {
            console.error('Ошибка загрузки статусов', e);
          }
        }));
      }

      // Быстрое применение статусов и привязок к заказам (O(N) вместо O(N^2))
      allOrders.forEach(o => {
        if (orderToSupplyMap.has(o.id)) o.supplyId = orderToSupplyMap.get(o.id);
        if (statusMap.has(o.id)) o.supplierStatus = statusMap.get(o.id);
      });

      // ОПТИМИЗАЦИЯ 3: Ускорение поиска списанных товаров в локальной БД (используем Set)
      await db.transaction('rw', db.wbSupplies, db.wbOrders, async () => {
        const existingOrders = await db.wbOrders.toArray();
        const deductedOrderIds = new Set(existingOrders.filter(e => (e as any).localDeducted).map(e => e.id));
        
        allOrders.forEach(o => {
           if (deductedOrderIds.has(o.id)) { o.localDeducted = true; }
        });

        await db.wbSupplies.clear();
        await db.wbOrders.clear();
        await db.wbSupplies.bulkPut(recentSupplies);
        
        await db.wbOrders.bulkPut(allOrders.map((o: any) => ({
          id: o.id, 
          supplyId: o.supplyId, 
          article: o.article,
          nmId: o.nmId, 
          title: String(o.title || '').substring(0, 100),
          price: o.convertedPrice ? o.convertedPrice / 100 : 0,
          supplierStatus: o.supplierStatus, 
          createdAt: o.createdAt,
          localDeducted: o.localDeducted || false
        })));
      });

    } catch (err: any) { alert(`Ошибка синхронизации: ${err.message}`); } 
    finally { setIsLoading(false); }
  };

  // =================================================================
  // 2. ЕДИНИЧНОЕ СПИСАНИЕ
  // =================================================================
  const handleDeductFromWarehouse = async (order: any) => {
    const match = getMatchedWarehouseItem(order);

    if (!match) return alert(`Товар "${order.title}" не привязан и не найден на Вашем складе по названию! Перейдите в раздел "Остатки (FBS)" и привяжите его.`);
    if (match.quantity <= 0 && !window.confirm(`Остаток товара "${match.title}" на складе уже равен 0.\nВсё равно списать?`)) return;

    await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, db.wbOrders, async () => {
      const newQty = match.quantity - 1;
      await db.myWarehouse.update(match.id!, { quantity: newQty });
      await db.myWarehouseChanges.add({ itemId: match.id, title: match.title, field: 'Остаток (Отгрузка WB)', oldValue: String(match.quantity), newValue: String(newQty), changeDate: new Date().toISOString() });
      await db.wbOrders.update(order.id, { localDeducted: true } as any);
    });
  };

  // =================================================================
  // 3. МАССОВОЕ СПИСАНИЕ ВСЕЙ ПОСТАВКИ
  // =================================================================
  const handleBulkDeduct = async () => {
    if (!selectedSupplyId) return;
    
    const supplyOrders = orders.filter(o => o.supplyId === selectedSupplyId && !(o as any).localDeducted);
    
    if (supplyOrders.length === 0) {
      return alert('В этой поставке нет товаров, которые нужно списать (или все уже списаны).');
    }

    if (!window.confirm(`Вы собираетесь массово списать с Вашего склада ${supplyOrders.length} шт. товаров.\nПродолжить?`)) return;

    const updates = new Map();
    const ordersToUpdate: number[] = [];
    const notFound: string[] = [];

    // Собираем агрегированные данные
    for (const order of supplyOrders) {
      const match = getMatchedWarehouseItem(order);

      if (match) {
        if (!updates.has(match.id)) {
          updates.set(match.id, { originalQty: match.quantity, title: match.title, deductCount: 0 });
        }
        updates.get(match.id).deductCount += 1;
        ordersToUpdate.push(order.id);
      } else {
        notFound.push(order.title || order.article);
      }
    }

    if (ordersToUpdate.length === 0) {
      return alert(`Ни один из ${supplyOrders.length} товаров не найден на Вашем складе. Привяжите их в разделе "Остатки (FBS)".`);
    }

    // Применяем изменения
    await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, db.wbOrders, async () => {
      const now = new Date().toISOString();
      const logs = [];
      
      for (const [itemId, data] of updates.entries()) {
        const newQty = data.originalQty - data.deductCount;
        await db.myWarehouse.update(itemId, { quantity: newQty });
        
        logs.push({
          itemId: itemId,
          title: data.title,
          field: `Массовое списание (WB)`,
          oldValue: String(data.originalQty),
          newValue: String(newQty),
          changeDate: now
        });
      }
      
      if (logs.length > 0) await db.myWarehouseChanges.bulkAdd(logs);
      for (const orderId of ordersToUpdate) {
        await db.wbOrders.update(orderId, { localDeducted: true } as any);
      }
    });

    let msg = `Успешно списано со склада: ${ordersToUpdate.length} шт.`;
    if (notFound.length > 0) {
      const uniqueNotFound = Array.from(new Set(notFound));
      msg += `\n\nНе найдено на складе (${notFound.length} шт.):\n- ${uniqueNotFound.slice(0, 5).join('\n- ')}`;
      if (uniqueNotFound.length > 5) msg += '\n... и другие';
    }
    alert(msg);
  };

  // =================================================================
  // 4. ПОДГОТОВКА ДАННЫХ ДЛЯ ИНТЕРФЕЙСА
  // =================================================================
  
  const activeSupplies = useMemo(() => {
    return supplies.filter(s => {
      const supplyOrders = orders.filter(o => o.supplyId === s.id);
      const hasConfirm = supplyOrders.some(o => o.supplierStatus === 'confirm');
      const hasComplete = supplyOrders.some(o => o.supplierStatus === 'complete');
      return !s.done || hasConfirm || hasComplete;
    });
  }, [supplies, orders]);

  const archiveSupplies = useMemo(() => supplies.filter(s => !activeSupplies.find(a => a.id === s.id)), [supplies, activeSupplies]);
  const displayedSupplies = tab === 'active' ? activeSupplies : archiveSupplies;

  const displayOrders = useMemo(() => {
    if (!selectedSupplyId) return [];
    let res = orders.filter(o => o.supplyId === selectedSupplyId);
    
    if (searchQuery) {
      res = res.filter(o => o.article.toLowerCase().includes(searchQuery.toLowerCase()) || o.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return res.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, selectedSupplyId, searchQuery]);

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Сборка и Отгрузка (FBS)</h1>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
          <RefreshCw size={16} className={isLoading ? "animate-spin text-blue-600" : "text-blue-600"} />
          {isLoading ? 'Загрузка...' : 'Синхронизировать'}
        </Button>
      </Toolbar>

      <div className="flex flex-1 overflow-hidden gap-4 h-full">
        {/* ЛЕВАЯ КОЛОНКА: СПИСОК ПОСТАВОК */}
        <div className="w-1/3 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
          
          <div className="flex bg-gray-100 p-1.5 m-4 mb-2 rounded-xl">
            <button onClick={() => setTab('active')} className={`flex-1 py-1.5 text-[13px] font-bold rounded-lg transition-all ${tab === 'active' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              В работе ({activeSupplies.length})
            </button>
            <button onClick={() => setTab('archive')} className={`flex-1 py-1.5 text-[13px] font-bold rounded-lg transition-all ${tab === 'archive' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              Архив ({archiveSupplies.length})
            </button>
          </div>
          
          <div className="overflow-y-auto flex-1 p-4 pt-2 space-y-2">
            {displayedSupplies.length === 0 ? (
              <div className="text-center p-8 text-gray-400 text-[13px]">
                <Package size={32} className="mx-auto mb-2 opacity-50" />
                {tab === 'active' ? 'Нет активных поставок.' : 'Архив пуст.'}
              </div>
            ) : (
              displayedSupplies.map(sup => {
                const supplyOrders = orders.filter(o => o.supplyId === sup.id);
                const confirmCount = supplyOrders.filter(o => o.supplierStatus === 'confirm').length;
                
                let statusText = sup.done ? 'Закрыта' : 'Формируется';
                let icon = <Box size={18} className="text-gray-400" />;
                
                if (confirmCount > 0) { statusText = 'На сборке'; icon = <Clock size={18} className="text-yellow-500" />; }
                else if (supplyOrders.some(o => o.supplierStatus === 'complete')) { statusText = 'В доставке'; icon = <Truck size={18} className="text-purple-500" />; }

                const deductedCount = supplyOrders.filter(o => (o as any).localDeducted).length;

                return (
                  <div 
                    key={sup.id} 
                    onClick={() => setSelectedSupplyId(sup.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedSupplyId === sup.id ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {icon}
                        <h4 className="font-bold text-[14px] text-gray-900">{sup.name}</h4>
                      </div>
                      <span className="text-[11px] text-gray-400 font-medium">
                        {new Date(sup.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-3">
                      <span className="text-[12px] font-bold text-gray-600">
                        Списано: <span className={deductedCount === supplyOrders.length && supplyOrders.length > 0 ? "text-green-600" : "text-[#1e3a5f]"}>{deductedCount}</span> / {supplyOrders.length}
                      </span>
                      {deductedCount === supplyOrders.length && supplyOrders.length > 0 ? (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-green-100 text-green-800 flex items-center gap-1">
                          <CheckCircle2 size={12}/> Все списаны
                        </span>
                      ) : (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${confirmCount > 0 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                          {statusText}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА: СПИСОК ТОВАРОВ В ПОСТАВКЕ */}
        <div className="w-2/3 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
          {!selectedSupplyId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
              <Package size={48} strokeWidth={1} className="mb-4 text-gray-300" />
              <p className="text-[15px] font-medium">Выберите поставку слева,</p>
              <p className="text-[14px]">чтобы увидеть список товаров в ней</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-[16px] text-gray-900">
                    Поставка: {supplies.find(s => s.id === selectedSupplyId)?.name}
                  </h3>
                  <p className="text-[12px] text-gray-500 mt-0.5">Списано {displayOrders.filter(o => (o as any).localDeducted).length} из {displayOrders.length} шт.</p>
                </div>
                
                <div className="flex items-center gap-3">
                  {/* КНОПКА МАССОВОГО СПИСАНИЯ */}
                  <Button variant="outline" onClick={handleBulkDeduct} disabled={displayOrders.filter(o => !(o as any).localDeducted).length === 0}>
                    <ListChecks size={16} className="text-blue-600" /> 
                    Списать все остатки
                  </Button>

                  <div className="w-48">
                    <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск товара..." />
                  </div>
                </div>
              </div>
              
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-200">
                      <th className="px-5 py-3 w-[35%]">Наименование (WB)</th>
                      <th className="px-5 py-3 text-center w-[15%]">Статус</th>
                      <th className="px-5 py-3 text-center w-[25%]">Дата заказа</th>
                      <th className="px-5 py-3 text-center w-[25%]">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayOrders.length === 0 ? (
                      <tr>
                         <td colSpan={4} className="p-8 text-center text-gray-400">
                           Здесь пока нет товаров
                         </td>
                      </tr>
                    ) : (
                      displayOrders.map((order: any) => {
                        const statusConfig = STATUS_MAP[order.supplierStatus || ''] || { text: order.supplierStatus || 'Неизвестно', color: 'bg-gray-100 text-gray-600 border-gray-200' };
                        const matchedItem = getMatchedWarehouseItem(order);

                        return (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 whitespace-normal break-words">
                              <p className="text-[13px] font-bold text-gray-800 leading-snug line-clamp-2">{order.title || 'Без названия'}</p>
                              <p className="text-[11px] text-gray-400 mt-1">Арт: {order.article} {order.nmId ? `| ID: ${order.nmId}` : ''}</p>
                              
                              {/* ИНДИКАТОР ПРИВЯЗКИ */}
                              <div className="mt-2">
                                {matchedItem ? (
                                  <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1 w-max" title="Будет списано со склада">
                                    <LinkIcon size={10} /> Склад: {matchedItem.title}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded flex items-center gap-1 w-max" title="Привяжите товар в разделе 'Остатки (FBS)'">
                                    <AlertTriangle size={10} /> Не найден на складе
                                  </span>
                                )}
                              </div>
                            </td>
                            
                            <td className="px-5 py-3 text-center align-middle">
                              <span className={`inline-flex items-center justify-center px-2.5 py-1 border rounded-md text-[11px] font-bold shadow-sm ${statusConfig.color}`}>
                                {statusConfig.text}
                              </span>
                            </td>
                            
                            <td className="px-5 py-3 text-center align-middle text-[12px] text-gray-600 font-medium">
                              {new Date(order.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            
                            <td className="px-5 py-3 text-center align-middle">
                              {order.localDeducted ? (
                                <span className="inline-flex items-center justify-center w-full max-w-[120px] gap-1.5 text-[12px] font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                                  <CheckCircle2 size={14} /> Списано
                                </span>
                              ) : (
                                <button 
                                  onClick={() => handleDeductFromWarehouse(order)}
                                  className="inline-flex items-center justify-center w-full max-w-[120px] gap-1.5 text-[12px] font-bold text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                                >
                                  <MinusCircle size={14} /> Списать 1 шт
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  )
}