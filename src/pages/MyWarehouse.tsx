import { useState, useMemo, useRef } from 'react';
import { Upload, Plus, Minus, PackageSearch, Trash2, Edit3, History, ArrowRight, X, Download, FileSpreadsheet, Save, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, MyStockItem } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

export default function MyWarehouse() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const changes = useLiveQuery(() => db.myWarehouseChanges.toArray()) || [];
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(''); // НОВОЕ: Состояние для фильтра
  const [isLoading, setIsLoading] = useState(false);
  
  const [historyItem, setHistoryItem] = useState<MyStockItem | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<MyStockItem>>({});
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // НОВОЕ: Автоматически получаем список всех уникальных категорий
  const uniqueCategories = useMemo(() => {
    const categories = new Set(stockItems.map(item => item.category || 'Без категории'));
    return Array.from(categories).sort();
  }, [stockItems]);

  const filteredItems = useMemo(() => {
    let result = [...stockItems];
    
    // Фильтрация по категории
    if (selectedCategory) {
      result = result.filter(item => (item.category || 'Без категории') === selectedCategory);
    }

    // Фильтрация по строке поиска
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => 
        item.title.toLowerCase().includes(q) || 
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.note && item.note.toLowerCase().includes(q))
      );
    }
    
    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [stockItems, searchQuery, selectedCategory]);

  const handleDelete = async (id?: number) => {
    if (id && window.confirm('Удалить товар со склада?')) {
      await db.myWarehouse.delete(id);
      await db.myWarehouseChanges.where('itemId').equals(id).delete();
    }
  };

  const clearWarehouse = async () => {
    if (window.confirm('ВНИМАНИЕ! Это удалит ВСЕ товары и историю с вашего склада. Продолжить?')) {
      await db.myWarehouse.clear();
      await db.myWarehouseChanges.clear();
    }
  };

  const handleDownloadTemplate = () => {
    const data = [{ 'Категория': 'Одежда', 'Наименование': 'Пример: Футболка белая', 'Опт': 500, 'Остаток': 15, 'Примечание': 'На витрине' }];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Шаблон');
    XLSX.writeFile(wb, 'Шаблон_Склада.xlsx');
  };

  const handleExportWarehouse = () => {
    if (stockItems.length === 0) return alert('Склад пуст!');
    const data = stockItems.map(item => ({
      'Категория': item.category,
      'Наименование': item.title,
      'Опт': item.price,
      'Остаток': item.quantity,
      'Примечание': item.note || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Мой склад');
    XLSX.writeFile(wb, `Мой_Склад_${new Date().toLocaleDateString('ru-RU')}.xlsx`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);

    try {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (jsonData.length < 2) throw new Error('Файл пуст или имеет неверный формат');

      const headers = jsonData[0].map(h => String(h).toLowerCase().trim());
      const colTitle = headers.findIndex(h => ['наименование', 'название', 'товар'].includes(h));
      const colCategory = headers.findIndex(h => ['категория', 'раздел', 'группа'].includes(h));
      const colPrice = headers.findIndex(h => ['опт', 'цена', 'закупка'].includes(h));
      const colStock = headers.findIndex(h => ['остаток', 'склад', 'кол-во', 'количество'].includes(h));
      const colNote = headers.findIndex(h => ['примечание', 'инфо', 'описание'].includes(h));

      if (colTitle === -1) throw new Error('Не найдена колонка "Наименование"');

      const now = new Date().toISOString();
      const logsToSave: any[] = [];
      const newItemsToSave: MyStockItem[] = [];
      const itemsToUpdate: MyStockItem[] = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || !row[colTitle]) continue;

        const title = String(row[colTitle]).trim();
        const category = colCategory !== -1 && row[colCategory] ? String(row[colCategory]).trim() : 'Без категории';
        const price = colPrice !== -1 ? parseFloat(String(row[colPrice]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0 : 0;
        const quantity = colStock !== -1 ? parseInt(String(row[colStock]).replace(/[^\d-]/g, ''), 10) || 0 : 0;
        const note = colNote !== -1 && row[colNote] ? String(row[colNote]).trim() : '';

        const existingItem = stockItems.find(item => item.title.toLowerCase() === title.toLowerCase());

        if (existingItem) {
          let changed = false;
          const updatedItem = { ...existingItem, category, price, quantity, note: note || existingItem.note };

          if (existingItem.price !== price) {
            logsToSave.push({ itemId: existingItem.id, title, field: 'Опт', oldValue: String(existingItem.price), newValue: String(price), changeDate: now });
            changed = true;
          }
          if (existingItem.quantity !== quantity) {
            logsToSave.push({ itemId: existingItem.id, title, field: 'Остаток', oldValue: String(existingItem.quantity), newValue: String(quantity), changeDate: now });
            changed = true;
          }
          if (existingItem.note !== note && note !== '') changed = true;

          if (changed || existingItem.category !== category) itemsToUpdate.push(updatedItem);
        } else {
          newItemsToSave.push({ title, category, price, quantity, note });
        }
      }

      await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
        if (newItemsToSave.length > 0) await db.myWarehouse.bulkAdd(newItemsToSave);
        if (itemsToUpdate.length > 0) await db.myWarehouse.bulkPut(itemsToUpdate);
        if (logsToSave.length > 0) await db.myWarehouseChanges.bulkAdd(logsToSave);
      });

      alert(`Загрузка завершена!\nНовых: ${newItemsToSave.length}\nОбновлено: ${itemsToUpdate.length}\nИзменений: ${logsToSave.length}`);
    } catch (err: any) { alert(`Ошибка: ${err.message}`); } 
    finally { setIsLoading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const openManualModal = (item?: MyStockItem) => {
    if (item) setEditingItem({ ...item });
    else setEditingItem({ title: '', category: '', price: 0, quantity: 0, note: '' });
    setIsManualModalOpen(true);
  };

  const handleSaveManual = async () => {
    if (!editingItem.title) return alert('Укажите наименование товара!');

    const now = new Date().toISOString();
    const itemToSave = {
      ...editingItem,
      category: editingItem.category || 'Без категории',
      price: Number(editingItem.price) || 0,
      quantity: Number(editingItem.quantity) || 0,
      note: editingItem.note || ''
    } as MyStockItem;

    if (editingItem.id) {
      const oldItem = stockItems.find(i => i.id === editingItem.id);
      const logs: any[] = [];
      if (oldItem) {
        if (oldItem.price !== itemToSave.price) logs.push({ itemId: oldItem.id, title: oldItem.title, field: 'Опт', oldValue: String(oldItem.price), newValue: String(itemToSave.price), changeDate: now });
        if (oldItem.quantity !== itemToSave.quantity) logs.push({ itemId: oldItem.id, title: oldItem.title, field: 'Остаток', oldValue: String(oldItem.quantity), newValue: String(itemToSave.quantity), changeDate: now });
        
        await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
          await db.myWarehouse.update(editingItem.id!, itemToSave);
          if (logs.length > 0) await db.myWarehouseChanges.bulkAdd(logs);
        });
      }
    } else {
      await db.myWarehouse.add(itemToSave);
    }
    
    setIsManualModalOpen(false);
  };

  const handleQuickStockChange = async (item: MyStockItem, delta: number) => {
    const newQuantity = Math.max(0, item.quantity + delta); 
    if (newQuantity === item.quantity) return;

    const now = new Date().toISOString();
    const log = { itemId: item.id!, title: item.title, field: 'Остаток', oldValue: String(item.quantity), newValue: String(newQuantity), changeDate: now };

    await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
      await db.myWarehouse.update(item.id!, { quantity: newQuantity });
      await db.myWarehouseChanges.add(log);
    });
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4 flex-1">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Мой Склад</h1>
          
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск товара..." />
          
          {/* НОВЫЙ ФИЛЬТР ПО КАТЕГОРИЯМ */}
          <div className="relative flex items-center">
            <Filter size={14} className="absolute left-3 text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-600 font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm cursor-pointer hover:bg-gray-50"
            >
              <option value="">Все категории</option>
              {uniqueCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate} title="Скачать пустой шаблон для заполнения">
             <FileSpreadsheet size={16} className="text-green-600" /> Шаблон
          </Button>

          {stockItems.length > 0 && (
            <Button variant="outline" onClick={handleExportWarehouse} title="Выгрузить весь склад">
               <Download size={16} className="text-blue-600" /> Экспорт
            </Button>
          )}

          <input type="file" accept=".xlsx, .xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
            <Upload size={16} className={isLoading ? "animate-pulse" : "text-gray-600"} />
            {isLoading ? 'Загрузка...' : 'Загрузить Excel'}
          </Button>

          <Button onClick={() => openManualModal()} className="ml-2">
            <Plus size={16} /> Добавить
          </Button>
        </div>
      </Toolbar>

      <TableWrapper>
        {filteredItems.length === 0 ? (
          <EmptyState icon={PackageSearch} title="Товары не найдены" description="Добавьте товары или измените параметры фильтрации." />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full min-w-[950px] table-fixed text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3 sticky left-0 bg-gray-50 z-30 shadow-[1px_0_0_0_#e5e7eb] w-[35%]">Наименование и Категория</th>
                  <th className="px-5 py-3 border-r border-gray-100 text-right w-[15%]">Опт (Закупка)</th>
                  <th className="px-5 py-3 border-r border-gray-100 text-center w-[20%]">Остаток</th>
                  <th className="px-5 py-3 border-r border-gray-100 w-[20%]">Примечание</th>
                  <th className="px-5 py-3 text-center w-[15%]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors bg-white group">
                    <td className="px-5 py-3 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal break-words">
                      <div className="flex flex-col justify-center">
                        <h3 className="text-[14px] font-bold text-[#1e3a5f] leading-snug line-clamp-2">{item.title}</h3>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md text-[11px] font-bold border border-indigo-100 cursor-pointer hover:bg-indigo-100" onClick={() => setSelectedCategory(item.category || 'Без категории')} title="Фильтровать по этой категории">
                            {item.category || 'Без категории'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 border-r border-gray-100 text-right align-middle">
                       <span className="text-[14px] font-bold text-gray-800">{item.price ? `${item.price} ₽` : '0 ₽'}</span>
                    </td>
                    <td className="px-5 py-3 border-r border-gray-100 text-center align-middle">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => handleQuickStockChange(item, -1)} disabled={item.quantity <= 0} className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><Minus size={14} /></button>
                        <div className={`inline-flex items-center justify-center min-w-[44px] h-[30px] px-2.5 border rounded-lg text-[13px] font-bold shadow-sm ${item.quantity > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{item.quantity} шт</div>
                        <button onClick={() => handleQuickStockChange(item, 1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-600 transition-colors"><Plus size={14} /></button>
                      </div>
                    </td>
                    <td className="px-5 py-3 border-r border-gray-100 whitespace-normal break-words text-[12px] text-gray-600 align-middle">
                       {item.note || '—'}
                    </td>
                    <td className="px-5 py-3 text-center align-middle">
                      <div className="flex items-center justify-center gap-3">
                        <button onClick={() => setHistoryItem(item)} className={`flex items-center gap-1.5 text-[12px] font-bold px-2 py-1 rounded-md transition-colors ${changes.some(c => c.itemId === item.id) ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`} title={changes.some(c => c.itemId === item.id) ? 'Посмотреть историю' : 'Истории пока нет'}>
                          <History size={14} /> История
                        </button>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openManualModal(item)} className="text-gray-400 hover:text-blue-600 transition-colors"><Edit3 size={16}/></button>
                          <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600 transition-colors"><Trash2 size={16}/></button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>

      {/* МОДАЛКА "РУЧНОЕ ДОБАВЛЕНИЕ / РЕДАКТИРОВАНИЕ" */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-[16px] font-bold text-[#1e3a5f]">{editingItem.id ? 'Редактировать товар' : 'Добавить товар'}</h3>
              <button onClick={() => setIsManualModalOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Наименование *</label>
                <input type="text" value={editingItem.title || ''} onChange={e => setEditingItem({...editingItem, title: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Футболка мужская белая" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Категория</label>
                <input type="text" list="categoryList" value={editingItem.category || ''} onChange={e => setEditingItem({...editingItem, category: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Одежда" />
                {/* Подсказки существующих категорий при вводе */}
                <datalist id="categoryList">
                  {uniqueCategories.map(cat => <option key={cat} value={cat} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Опт (Цена, ₽)</label>
                  <input type="number" min="0" step="0.01" value={editingItem.price === 0 ? '' : editingItem.price} onChange={e => setEditingItem({...editingItem, price: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Остаток (ШТ)</label>
                  <input type="number" min="0" value={editingItem.quantity === 0 ? '' : editingItem.quantity} onChange={e => setEditingItem({...editingItem, quantity: parseInt(e.target.value, 10) || 0})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Примечание</label>
                <input type="text" value={editingItem.note || ''} onChange={e => setEditingItem({...editingItem, note: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Дополнительная информация..." />
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setIsManualModalOpen(false)}>Отмена</Button>
              <Button onClick={handleSaveManual}><Save size={16} /> Сохранить</Button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО "ИСТОРИЯ ИЗМЕНЕНИЙ ТОВАРА" */}
      {historyItem && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-[15px] font-bold text-[#1e3a5f] truncate pr-4">История: {historyItem.title}</h3>
              <button onClick={() => setHistoryItem(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-0 overflow-y-auto flex-1">
              {changes.filter(c => c.itemId === historyItem.id).length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-[14px]">
                  У этого товара пока нет истории изменений.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                      <th className="px-4 py-2 w-[25%]">Дата</th>
                      <th className="px-4 py-2 text-center w-[25%]">Поле</th>
                      <th className="px-4 py-2 text-center w-[50%]">Изменение</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {changes.filter(c => c.itemId === historyItem.id).sort((a,b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime()).map(change => (
                      <tr key={change.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-[12px] text-gray-500 font-medium">
                          {new Date(change.changeDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[11px] font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">{change.field}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[13px] text-gray-400 line-through">{change.oldValue}</span>
                            <ArrowRight size={14} className="text-gray-300" />
                            <span className={`text-[13px] font-bold px-2 py-0.5 rounded-md border ${
                              parseFloat(change.newValue) > parseFloat(change.oldValue) 
                                ? 'bg-green-50 text-green-700 border-green-200' 
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}>
                              {change.newValue} {change.field === 'Остаток' ? 'шт' : '₽'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end flex-shrink-0">
              <Button onClick={() => setHistoryItem(null)}>Закрыть</Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}