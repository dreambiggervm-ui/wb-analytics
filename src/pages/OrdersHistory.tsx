import { useState, useMemo } from 'react';
import { Archive, Search, Truck, User, Package, Calendar } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, TableWrapper, EmptyState } from '../components/ui';

export default function OrdersHistory() {
  const manualOrders = useLiveQuery(() => db.manualOrders.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredOrders = useMemo(() => {
    let result = [...manualOrders];

    if (filterType !== 'All') result = result.filter(o => o.shippingType === filterType);
    
    if (dateFrom) result = result.filter(o => o.date >= dateFrom);
    if (dateTo) result = result.filter(o => o.date <= dateTo);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o => o.title.toLowerCase().includes(q));
    }

    // Сортировка от новых к старым
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [manualOrders, searchQuery, filterType, dateFrom, dateTo]);

  const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.quantity * o.salePrice), 0);
  const totalItems = filteredOrders.reduce((sum, o) => sum + o.quantity, 0);

  const getShippingIcon = (type: string) => {
    if (type === 'Самовывоз') return <User size={14} className="text-blue-500" />;
    if (type === 'Курьер') return <Package size={14} className="text-orange-500" />;
    return <Truck size={14} className="text-green-500" />;
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4 flex-1">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Архив продаж (Прямые)</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск по названию товара..." />
        </div>
      </Toolbar>

      {/* Панель фильтров и статистики */}
      <div className="flex flex-wrap items-center justify-between p-4 bg-white border-b border-gray-200 flex-shrink-0 gap-4">
        <div className="flex items-center gap-4">
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-[13px] font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-500">
            <option value="All">Все способы доставки</option>
            <option value="Самовывоз">Самовывоз</option>
            <option value="Курьер">Курьер</option>
            <option value="ТК">Транспортная компания (ТК)</option>
          </select>
          
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
            <Calendar size={14} className="text-gray-400"/>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-transparent border-none text-[12px] font-medium text-gray-700 outline-none" />
            <span className="text-gray-400">-</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-transparent border-none text-[12px] font-medium text-gray-700 outline-none" />
          </div>
        </div>

        <div className="flex items-center gap-6 bg-green-50 px-5 py-2 rounded-xl border border-green-100">
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold text-green-600 tracking-wider">Отгружено</p>
            <p className="text-[16px] font-black text-green-800">{totalItems} шт</p>
          </div>
          <div className="w-px h-8 bg-green-200"></div>
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold text-green-600 tracking-wider">Выручка</p>
            <p className="text-[16px] font-black text-green-800">{totalRevenue.toLocaleString('ru-RU')} ₽</p>
          </div>
        </div>
      </div>

      <TableWrapper>
        {filteredOrders.length === 0 ? (
          <EmptyState icon={Archive} title="Продажи не найдены" description="Здесь будет храниться история ваших прямых отгрузок со склада." />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                  <th className="px-5 py-3 w-[15%]">Дата и Время</th>
                  <th className="px-5 py-3 w-[40%]">Наименование товара</th>
                  <th className="px-5 py-3 w-[15%] text-center">Доставка</th>
                  <th className="px-5 py-3 w-[10%] text-center">Кол-во</th>
                  <th className="px-5 py-3 w-[10%] text-right">Цена (шт)</th>
                  <th className="px-5 py-3 w-[10%] text-right text-blue-800 bg-blue-50/50">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50/80 transition-colors bg-white">
                    <td className="px-5 py-3">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-gray-800">{new Date(order.date).toLocaleDateString('ru-RU')}</span>
                        <span className="text-[11px] text-gray-400">{new Date(order.createdAt).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-normal break-words">
                      <span className="text-[13px] font-medium text-[#1e3a5f] leading-snug">{order.title}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-700 text-[11px] font-bold rounded-lg border border-gray-200">
                        {getShippingIcon(order.shippingType)} {order.shippingType}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="text-[13px] font-bold text-gray-800">{order.quantity} шт</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-[13px] font-medium text-gray-600">{order.salePrice} ₽</span>
                    </td>
                    <td className="px-5 py-3 text-right bg-blue-50/20">
                      <span className="text-[14px] font-black text-[#1e3a5f]">{(order.quantity * order.salePrice).toLocaleString('ru-RU')} ₽</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>
    </PageLayout>
  )
}