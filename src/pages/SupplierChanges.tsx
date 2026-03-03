import { useState, useMemo } from 'react';
import { History, ArrowRight, TrendingUp, TrendingDown, AlertTriangle, Trash2 } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, TableWrapper, EmptyState, Button } from '../components/ui';

// =================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (АНАЛОГ js В PYTHON)
// =================================================================

// Извлекаем чистые числа из строк ("1 500 ₽" -> 1500, ">10 шт" -> 10)
const extractNumber = (val: string) => {
  if (!val) return 0;
  const num = parseFloat(val.replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : num;
};

// Проверяем, обнулился ли остаток (как класс change-item--zero-stock)
const isZeroStock = (val: string) => {
  if (!val) return true;
  const lower = val.toLowerCase();
  if (/^[\-\u2010\u2012\u2013\u2014\u2212]+$/.test(val)) return true;
  if (['нет', 'x', 'х', '×', '0', '0 шт', '0шт'].includes(lower)) return true;
  const num = extractNumber(val);
  if (num <= 0 && /\d/.test(val)) return true; // Есть цифра 0
  return false;
};

export default function SupplierChanges() {
  const changes = useLiveQuery(() => db.supplierChanges.toArray()) || [];
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChanges = useMemo(() => {
    let result = [...changes];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.supplierName.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    }
    // Сортируем: новые сверху
    return result.sort((a, b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime());
  }, [changes, searchQuery]);

  const handleClearHistory = async () => {
    if (window.confirm('Вы уверены, что хотите удалить всю историю изменений?')) {
      await db.supplierChanges.clear();
    }
  };

  // =================================================================
  // ЛОГИКА ОТОБРАЖЕНИЯ ОДНОГО ИЗМЕНЕНИЯ (ЦВЕТА И СТРЕЛОЧКИ)
  // =================================================================
  const renderChangeDiff = (change: any) => {
    const oldNum = extractNumber(change.oldValue);
    const newNum = extractNumber(change.newValue);
    
    let isUp = newNum > oldNum;
    let isDown = newNum < oldNum;
    
    // Если это текстовое поле, а не цифры, не показываем стрелочки
    if (oldNum === 0 && newNum === 0 && change.oldValue && change.newValue) {
       isUp = false; isDown = false;
    }

    const isPrice = change.field !== 'Остаток';
    const isZero = change.field === 'Остаток' && isZeroStock(change.newValue);

    let icon = null;
    let badgeClass = 'text-gray-700 bg-gray-100 border-gray-200';

    if (isPrice) {
      // Цена выросла = ПЛОХО (Красный)
      if (isUp) { icon = <TrendingUp size={14} className="text-red-500"/>; badgeClass = 'text-red-700 bg-red-50 border-red-200'; }
      // Цена упала = ХОРОШО (Зеленый)
      if (isDown) { icon = <TrendingDown size={14} className="text-green-500"/>; badgeClass = 'text-green-700 bg-green-50 border-green-200'; }
    } else {
      // Остаток вырос = ХОРОШО (Зеленый)
      if (isUp) { icon = <TrendingUp size={14} className="text-green-500"/>; badgeClass = 'text-green-700 bg-green-50 border-green-200'; }
      // Остаток упал = ПЛОХО (Красный)
      if (isDown) { icon = <TrendingDown size={14} className="text-red-500"/>; badgeClass = 'text-red-700 bg-red-50 border-red-200'; }
      // Остаток обнулился = ОЧЕНЬ ПЛОХО (Мигающий красный)
      if (isZero) { icon = <AlertTriangle size={14} className="text-red-600 animate-pulse"/>; badgeClass = 'text-red-800 bg-red-100 border-red-300 font-bold'; }
    }

    return (
      <div className="flex items-center justify-center gap-3">
        <span className="text-[13px] text-gray-400 line-through truncate max-w-[80px]" title={change.oldValue}>{change.oldValue || '—'}</span>
        {icon || <ArrowRight size={14} className="text-gray-300" />}
        <span className={`text-[13px] font-bold px-2.5 py-1 border rounded-lg truncate max-w-[120px] ${badgeClass}`} title={change.newValue}>
          {isZero && change.newValue === '—' ? 'Нет в наличии' : change.newValue}
        </span>
      </div>
    );
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">История изменений</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск по товару, поставщику или категории..." />
        </div>
        
        {changes.length > 0 && (
          <Button variant="danger" onClick={handleClearHistory}>
            <Trash2 size={16} /> Очистить историю
          </Button>
        )}
      </Toolbar>

      <TableWrapper>
        {filteredChanges.length === 0 ? (
          <EmptyState icon={History} title="Изменений нет" description="Нажмите «Обновить все» в разделе Поставщики. Разница между старыми и новыми данными появится здесь." />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full min-w-[1000px] table-fixed text-left border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-white border-b border-gray-200 shadow-sm">
                  <th className="px-4 py-3 sticky left-0 bg-white z-30 shadow-[1px_0_0_0_#e5e7eb] w-[12%]">Дата</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[15%]">Поставщик / Лист</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[15%]">Категория</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[28%]">Наименование товара</th>
                  <th className="px-4 py-3 text-center border-r border-gray-100 w-[10%]">Поле</th>
                  <th className="px-4 py-3 text-center w-[20%]">Изменение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredChanges.map((change) => {
                  const isZero = change.field === 'Остаток' && isZeroStock(change.newValue);
                  
                  return (
                    <tr key={change.id} className={`transition-colors bg-white hover:bg-gray-50 group ${isZero ? 'bg-red-50/30' : ''}`}>
                      <td className={`px-4 py-3 sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-nowrap ${isZero ? 'bg-red-50/30 group-hover:bg-red-50/60' : 'bg-white group-hover:bg-gray-50'}`}>
                        <span className="text-[12px] font-medium text-gray-500">{new Date(change.changeDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </td>
                      
                      <td className="px-4 py-3 border-r border-gray-100">
                        <div className="flex flex-col">
                          <span className="text-[13px] font-bold text-[#1e3a5f] truncate">{change.supplierName}</span>
                          <span className="text-[11px] text-gray-500 truncate">{change.sheetName}</span>
                        </div>
                      </td>
                      
                      <td className="px-4 py-3 border-r border-gray-100 whitespace-normal break-words">
                        <span className="text-[12px] font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-md leading-tight inline-block">{change.category || 'Без категории'}</span>
                      </td>
                      
                      <td className="px-4 py-3 border-r border-gray-100 whitespace-normal break-words">
                        <span className="text-[13px] font-bold text-gray-800 leading-snug line-clamp-3">{change.title}</span>
                      </td>
                      
                      <td className="px-4 py-3 border-r border-gray-100 text-center">
                        <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded ${change.field === 'Остаток' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'}`}>
                          {change.field}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        {renderChangeDiff(change)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>
    </PageLayout>
  )
}