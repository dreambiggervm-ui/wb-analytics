import { useState, useMemo } from 'react';
import { ShoppingCart, User, Truck, Package, Search, PlusCircle, Trash2, ArrowRight } from 'lucide-react';
import { db, MyStockItem, ManualOrder } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, Button, SearchInput } from '../components/ui';

export default function PosTerminal() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const manualOrders = useLiveQuery(() => db.manualOrders.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<MyStockItem | null>(null);
  
  const [sellQty, setSellQty] = useState<number | ''>('');
  const [sellPrice, setSellPrice] = useState<number | ''>('');
  const [shippingType, setShippingType] = useState<'Самовывоз' | 'Курьер' | 'ТК'>('Самовывоз');

  // Данные для открытого дня (сегодня)
  const todayStr = new Date().toISOString().split('T')[0];
  const todaysOrders = useMemo(() => {
    return manualOrders
      .filter(o => o.date === todayStr)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [manualOrders, todayStr]);

  const searchFilteredStock = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return stockItems
      .filter(i => i.title.toLowerCase().includes(q) || (i.article && i.article.toLowerCase().includes(q)))
      .slice(0, 10); // Показываем топ-10 для быстрого выбора
  }, [stockItems, searchQuery]);

  const handleSelectItem = (item: MyStockItem) => {
    setSelectedItem(item);
    setSearchQuery('');
    setSellQty(1);
    setSellPrice(''); // Оставляем цену пустой, чтобы вбили вручную
  };

  const handleSell = async () => {
    if (!selectedItem) return alert('Выберите товар!');
    if (!sellQty || sellQty <= 0) return alert('Введите количество!');
    if (sellPrice === '' || sellPrice < 0) return alert('Введите цену продажи!');

    if (sellQty > selectedItem.quantity) {
      if (!window.confirm(`Вы пытаетесь отгрузить больше товара, чем есть на складе (${selectedItem.quantity} шт).\nОстаток уйдет в минус. Продолжить?`)) {
        return;
      }
    }

    const now = new Date().toISOString();
    const newOrder: ManualOrder = {
      myStockItemId: selectedItem.id!,
      title: selectedItem.title,
      quantity: Number(sellQty),
      salePrice: Number(sellPrice),
      shippingType,
      date: todayStr,
      createdAt: now
    };

    const newQty = selectedItem.quantity - Number(sellQty);

    await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
      // 1. Создаем заказ
      await db.manualOrders.add(newOrder);
      
      // 2. Обновляем остаток на складе
      await db.myWarehouse.update(selectedItem.id!, { quantity: newQty });
      
      // 3. Пишем лог
      await db.myWarehouseChanges.add({
        itemId: selectedItem.id,
        title: selectedItem.title,
        field: 'Остаток (Ручная отгрузка)',
        oldValue: String(selectedItem.quantity),
        newValue: String(newQty),
        changeDate: now
      });
    });

    // Очистка формы
    setSelectedItem(null);
    setSellQty('');
    setSellPrice('');
  };

  const handleDeleteOrder = async (order: ManualOrder) => {
    if (!window.confirm('Отменить эту отгрузку и вернуть товар на склад?')) return;

    const item = await db.myWarehouse.get(order.myStockItemId);
    const now = new Date().toISOString();

    await db.transaction('rw', db.manualOrders, db.myWarehouse, db.myWarehouseChanges, async () => {
      // Удаляем заказ
      await db.manualOrders.delete(order.id!);

      if (item) {
        // Возвращаем остаток
        const restoredQty = item.quantity + order.quantity;
        await db.myWarehouse.update(item.id!, { quantity: restoredQty });
        
        await db.myWarehouseChanges.add({
          itemId: item.id,
          title: item.title,
          field: 'Остаток (Отмена отгрузки)',
          oldValue: String(item.quantity),
          newValue: String(restoredQty),
          changeDate: now
        });
      }
    });
  };

  const totalTodayRevenue = todaysOrders.reduce((sum, o) => sum + (o.quantity * o.salePrice), 0);
  const totalTodayItems = todaysOrders.reduce((sum, o) => sum + o.quantity, 0);

  return (
    <PageLayout>
      <Toolbar>
        <h1 className="text-[16px] font-bold text-[#1e3a5f] uppercase tracking-wider">Касса (Открытый день)</h1>
        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
          <span className="text-[12px] font-bold text-blue-700">Сегодня: {new Date().toLocaleDateString('ru-RU')}</span>
        </div>
      </Toolbar>

      <div className="flex flex-1 overflow-hidden gap-6 p-6 bg-[#F5F5F7]">
        
        {/* ЛЕВАЯ КОЛОНКА: ФОРМА ОТГРУЗКИ */}
        <div className="w-1/2 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-gray-100 bg-gray-50 font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart size={18} className="text-blue-600" /> Оформление отгрузки
          </div>
          
          <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            
            {/* Поиск товара */}
            <div className="relative">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">1. Выберите товар со склада</label>
              {!selectedItem ? (
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                    placeholder="Начните вводить название..." 
                    className="w-full bg-white border border-gray-300 rounded-xl py-3 pl-10 pr-4 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  {searchFilteredStock.length > 0 && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
                      {searchFilteredStock.map(item => (
                        <div key={item.id} onClick={() => handleSelectItem(item)} className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-b-0">
                          <p className="text-[13px] font-bold text-gray-800 leading-snug">{item.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">Остаток: <span className={item.quantity > 0 ? "text-green-600 font-bold" : "text-red-500 font-bold"}>{item.quantity} шт</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <div>
                    <p className="text-[14px] font-bold text-blue-900 leading-snug">{selectedItem.title}</p>
                    <p className="text-[12px] text-blue-700 mt-1">Доступно на складе: <b>{selectedItem.quantity} шт</b></p>
                  </div>
                  <button onClick={() => setSelectedItem(null)} className="text-blue-400 hover:text-red-500 bg-white p-1.5 rounded-lg shadow-sm">
                    Сбросить
                  </button>
                </div>
              )}
            </div>

            {selectedItem && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">2. Количество (шт)</label>
                    <input type="number" min="1" value={sellQty} onChange={e => setSellQty(Number(e.target.value))} className="w-full bg-white border border-gray-300 rounded-xl py-3 px-4 text-[16px] font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="1" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">3. Цена за 1 шт (₽)</label>
                    <input type="number" min="0" step="0.01" value={sellPrice} onChange={e => setSellPrice(Number(e.target.value))} className="w-full bg-white border border-gray-300 rounded-xl py-3 px-4 text-[16px] font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Напр: 1500" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">4. Способ отгрузки</label>
                  <div className="flex gap-3">
                    <button onClick={() => setShippingType('Самовывоз')} className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${shippingType === 'Самовывоз' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      <User size={20} className="mb-1"/> <span className="font-bold text-[12px]">Самовывоз</span>
                    </button>
                    <button onClick={() => setShippingType('Курьер')} className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${shippingType === 'Курьер' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      <Package size={20} className="mb-1"/> <span className="font-bold text-[12px]">Курьер</span>
                    </button>
                    <button onClick={() => setShippingType('ТК')} className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${shippingType === 'ТК' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      <Truck size={20} className="mb-1"/> <span className="font-bold text-[12px]">Транспортная (ТК)</span>
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <button onClick={handleSell} className="w-full py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl text-[16px] font-bold shadow-md transition-colors flex items-center justify-center gap-2">
                    <PlusCircle size={20} /> Провести отгрузку
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА: СЕГОДНЯШНИЙ ЧЕК */}
        <div className="w-1/2 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <span className="font-bold text-gray-800">Отгрузки за сегодня</span>
            <div className="text-right">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">Выручка за день</p>
              <p className="text-[18px] font-black text-green-600 leading-none">{totalTodayRevenue.toLocaleString('ru-RU')} ₽</p>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50/50">
            {todaysOrders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <ShoppingCart size={48} strokeWidth={1} className="mb-3 opacity-50"/>
                <p className="text-[14px]">Сегодня продаж еще не было</p>
              </div>
            ) : (
              <div className="space-y-3">
                {todaysOrders.map(order => (
                  <div key={order.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between gap-4 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-900 leading-snug truncate">{order.title}</p>
                      <div className="flex gap-3 mt-1.5">
                        <span className="text-[11px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {order.shippingType}
                        </span>
                        <span className="text-[11px] font-medium text-gray-500">
                          {new Date(order.createdAt).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[14px] font-bold text-gray-900">{order.quantity} шт <span className="text-gray-400 text-[12px] font-normal mx-1">x</span> {order.salePrice} ₽</p>
                      <p className="text-[12px] font-bold text-blue-600 mt-1">Итого: {(order.quantity * order.salePrice).toLocaleString('ru-RU')} ₽</p>
                    </div>
                    <button onClick={() => handleDeleteOrder(order)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Отменить продажу">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </PageLayout>
  )
}