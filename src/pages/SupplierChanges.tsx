import { useState, useMemo } from 'react';
import { History, ArrowRight, TrendingUp, TrendingDown, AlertTriangle, Trash2 } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, TableWrapper, EmptyState, Button } from '../components/ui';

// =================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =================================================================

const extractNumber = (val: string) => {
  if (!val) return 0;
  const num = parseFloat(val.replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : num;
};

const isZeroStock = (val: string) => {
  if (!val) return true;
  const lower = val.toLowerCase();
  if (/^[\-\u2010\u2012\u2013\u2014\u2212]+$/.test(val)) return true;
  if (['нет', 'x', 'х', '×', '0', '0 шт', '0шт'].includes(lower)) return true;
  const num = extractNumber(val);
  if (num <= 0 && /\d/.test(val)) return true;
  return false;
};

export default function SupplierChanges() {
  const changes = useLiveQuery(() => db.supplierChanges.toArray()) || [];
  const [searchQuery, setSearchQuery] = useState('');

  // =================================================================
  // ГРУППИРОВКА И ФИЛЬТРАЦИЯ
  // =================================================================
  const groupedChanges = useMemo(() => {
    // 1. Сначала фильтруем по строке поиска
    let filtered = changes;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.supplierName.toLowerCase().includes(q) ||
        (c.category && c.category.toLowerCase().includes(q))
      );
    }

    // 2. Группируем изменения по Товару + Дате
    const groups = new Map<string, any>();

    filtered.forEach(c => {
      // Ключ группировки: точная дата обновления + поставщик + название товара
      const key = `${c.changeDate}_${c.supplierId}_${c.title}`;

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          changeDate: c.changeDate,
          supplierName: c.supplierName,
          sheetName: c.sheetName,
          category: c.category,
          title: c.title,
          hasZeroStock: false, // Флаг для подсветки всей строки
          fields: []
        });
      }

      const group = groups.get(key)!;
      const isZero = c.field === 'Остаток' && isZeroStock(c.newValue);
      if (isZero) group.hasZeroStock = true;

      group.fields.push({
        id: c.id,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        isZero
      });
    });

    // 3. Превращаем обратно в массив и сортируем от новых к старым
    return Array.from(groups.values()).sort((a, b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime());
  }, [changes, searchQuery]);

  const handleClearHistory = async () => {
    if (window.confirm('Вы уверены, что хотите удалить всю историю изменений?')) {
      await db.supplierChanges.clear();
    }
  };

  // =================================================================
  // ЛОГИКА ОТОБРАЖЕНИЯ ОДНОГО ПОЛЯ ИЗМЕНЕНИЯ
  // =================================================================
  const renderFieldDiff = (changeField: any) => {
    const oldNum = extractNumber(changeField.oldValue);
    const newNum = extractNumber(changeField.newValue);
    
    let isUp = newNum > oldNum;
    let isDown = newNum < oldNum;
    
    if (oldNum === 0 && newNum === 0 && changeField.oldValue && changeField.newValue) {
       isUp = false; isDown = false;
    }

    const isPrice = changeField.field !== 'Остаток';
    const isZero = changeField.isZero;

    let icon = null;
    let badgeClass = 'text-gray-700 bg-gray-100 border-gray-200';

    if (isPrice) {
      if (isUp) { icon = <TrendingUp size={14} className="text-red-500"/>; badgeClass = 'text-red-700 bg-red-50 border-red-200'; }
      if (isDown) { icon = <TrendingDown size={14} className="text-green-500"/>; badgeClass = 'text-green-700 bg-green-50 border-green-200'; }
    } else {
      if (isUp) { icon = <TrendingUp size={14} className="text-green-500"/>; badgeClass = 'text-green-700 bg-green-50 border-green-200'; }
      if (isDown) { icon = <TrendingDown size={14} className="text-red-500"/>; badgeClass = 'text-red-700 bg-red-50 border-red-200'; }
      if (isZero) { icon = <AlertTriangle size={14} className="text-red-600 animate-pulse"/>; badgeClass = 'text-red-800 bg-red-100 border-red-300 font-bold'; }
    }

    return (
      <div key={changeField.id} className="flex items-center gap-3 py-1">
        {/* Бейдж с названием поля (Опт, РРЦ, Остаток) */}
        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-16 text-center flex-shrink-0 ${changeField.field === 'Остаток' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'}`}>
          {changeField.field}
        </span>
        
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[13px] text-gray-400 line-through truncate max-w-[80px]" title={changeField.oldValue}>{changeField.oldValue || '—'}</span>
          {icon || <ArrowRight size={14} className="text-gray-300 flex-shrink-0" />}
          <span className={`text-[13px] font-bold px-2 py-0.5 border rounded-md truncate max-w-[120px] ${badgeClass}`} title={changeField.newValue}>
            {isZero && changeField.newValue === '—' ? 'Нет' : changeField.newValue}
          </span>
        </div>
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
        {groupedChanges.length === 0 ? (
          <EmptyState icon={History} title="Изменений нет" description="Нажмите «Обновить все» в разделе Поставщики. Разница между старыми и новыми данными появится здесь." />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full min-w-[1000px] table-fixed text-left border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-white border-b border-gray-200 shadow-sm">
                  <th className="px-4 py-3 sticky left-0 bg-white z-30 shadow-[1px_0_0_0_#e5e7eb] w-[12%]">Дата</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[15%]">Поставщик / Лист</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[15%]">Категория</th>
                  <th className="px-4 py-3 border-r border-gray-100 w-[30%]">Наименование товара</th>
                  <th className="px-4 py-3 w-[28%] pl-6">Изменения</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groupedChanges.map((group) => (
                  <tr key={group.id} className={`transition-colors bg-white hover:bg-gray-50 group-row ${group.hasZeroStock ? 'bg-red-50/30' : ''}`}>
                    <td className={`px-4 py-3 sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-nowrap align-top ${group.hasZeroStock ? 'bg-red-50/30 group-hover:bg-red-50/60' : 'bg-white group-row-hover:bg-gray-50'}`}>
                      <span className="text-[12px] font-medium text-gray-500">{new Date(group.changeDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </td>
                    
                    <td className="px-4 py-3 border-r border-gray-100 align-top">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-[#1e3a5f] truncate">{group.supplierName}</span>
                        <span className="text-[11px] text-gray-500 truncate">{group.sheetName}</span>
                      </div>
                    </td>
                    
                    <td className="px-4 py-3 border-r border-gray-100 whitespace-normal break-words align-top">
                      <span className="text-[12px] font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-md leading-tight inline-block">{group.category || 'Без категории'}</span>
                    </td>
                    
                    <td className="px-4 py-3 border-r border-gray-100 whitespace-normal break-words align-top">
                      <span className="text-[13px] font-bold text-gray-800 leading-snug line-clamp-3">{group.title}</span>
                    </td>
                    
                    <td className="px-4 py-2 align-top pl-6">
                      <div className="flex flex-col gap-1">
                        {group.fields.map((f: any) => renderFieldDiff(f))}
                      </div>
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