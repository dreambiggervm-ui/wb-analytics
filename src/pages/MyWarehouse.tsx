import { useState, useMemo, useRef } from 'react';
import { Upload, Plus, Minus, PackageSearch, Trash2, Edit3, History, ArrowRight, X, Download, FileSpreadsheet, Save, Filter, Link as LinkIcon, Unlink, Box, PackagePlus, CheckSquare } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, MyStockItem, StockReceipt } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

export default function MyWarehouse() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const changes = useLiveQuery(() => db.myWarehouseChanges.toArray()) || [];

  const wbProducts = useLiveQuery(() => db.fbsStocks.toArray()) || [];
  const wbLinks = useLiveQuery(() => db.wbLinksV2.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // СОСТОЯНИЕ ДЛЯ МАССОВЫХ ДЕЙСТВИЙ
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const [historyItem, setHistoryItem] = useState<MyStockItem | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<MyStockItem>>({});
  const [editingReceipts, setEditingReceipts] = useState<StockReceipt[]>([]);

  const [linkingStockId, setLinkingStockId] = useState<number | null>(null);
  const [linkSearchWb, setLinkSearchWb] = useState('');

  // Состояния для окна комплектации
  const [kittingItem, setKittingItem] = useState<MyStockItem | null>(null);
  const [kittingItemsPerKit, setKittingItemsPerKit] = useState<number>(2);
  const [kittingCount, setKittingCount] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const uniqueCategories = useMemo(() => {
    const categories = new Set(stockItems.map(item => item.category || 'Без категории'));
    return Array.from(categories).sort();
  }, [stockItems]);

  const filteredItems = useMemo(() => {
    let result = [...stockItems];
    if (selectedCategory) result = result.filter(item => (item.category || 'Без категории') === selectedCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => item.title.toLowerCase().includes(q) || (item.category && item.category.toLowerCase().includes(q)) || (item.note && item.note.toLowerCase().includes(q)));
    }
    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [stockItems, searchQuery, selectedCategory]);

  const searchFilteredWbProducts = useMemo(() => {
    let result = wbProducts;

    if (linkSearchWb) {
      const q = linkSearchWb.toLowerCase();
      result = wbProducts.filter(p => (p.title || '').toLowerCase().includes(q) || (p.vendorCode || '').toLowerCase().includes(q) || String(p.nmId).includes(q));
    }

    const uniqueProducts = [...result];

    if (linkingStockId) {
      const localItem = stockItems.find(item => item.id === linkingStockId);
      if (localItem) {
        const localTitle = (localItem.title || '').toLowerCase();
        const localNote = (localItem.note || '').toLowerCase();
        const localWords = localTitle.split(/[\s,.-]+/).filter(w => w.length > 2);

        uniqueProducts.sort((a, b) => {
          let scoreA = 0; let scoreB = 0;
          const titleA = (a.title || '').toLowerCase(); const vendorA = (a.vendorCode || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase(); const vendorB = (b.vendorCode || '').toLowerCase();

          if (vendorA && (localTitle.includes(vendorA) || localNote.includes(vendorA))) scoreA += 100;
          if (titleA === localTitle) scoreA += 50;
          localWords.forEach(w => { if (titleA.includes(w)) scoreA += 5; });

          if (vendorB && (localTitle.includes(vendorB) || localNote.includes(vendorB))) scoreB += 100;
          if (titleB === localTitle) scoreB += 50;
          localWords.forEach(w => { if (titleB.includes(w)) scoreB += 5; });

          return scoreB - scoreA;
        });
      }
    }

    return uniqueProducts;
  }, [wbProducts, linkSearchWb, linkingStockId, stockItems]);

  // ОБРАБОТЧИКИ МАССОВОГО ВЫДЕЛЕНИЯ
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedItems(new Set(filteredItems.map(item => item.id!)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectItem = (id: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  // МАССОВОЕ УДАЛЕНИЕ
  const handleMassDelete = async () => {
    if (selectedItems.size === 0) return;
    if (window.confirm(`Вы уверены, что хотите удалить ${selectedItems.size} выбранных товаров со склада?\nВсе их связи с WB и история изменений также будут удалены.`)) {
      setIsLoading(true);
      try {
        const idsToDelete = Array.from(selectedItems);
        
        await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, db.wbLinksV2, async () => {
          await db.myWarehouse.bulkDelete(idsToDelete);
          await db.myWarehouseChanges.where('itemId').anyOf(idsToDelete).delete();
          await db.wbLinksV2.where('myStockItemId').anyOf(idsToDelete).delete();
        });

        setSelectedItems(new Set());
      } catch (err: any) {
        alert(`Ошибка при массовом удалении: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async (id?: number) => {
    if (id && window.confirm('Удалить товар со склада?')) {
      await db.myWarehouse.delete(id);
      await db.myWarehouseChanges.where('itemId').equals(id).delete();

      const linksToDelete = await db.wbLinksV2.where('myStockItemId').equals(id).toArray();
      for (const link of linksToDelete) {
        if (link.id) await db.wbLinksV2.delete(link.id);
      }
      
      // Удаляем из выделенных, если он там был
      if (selectedItems.has(id)) {
        const newSelected = new Set(selectedItems);
        newSelected.delete(id);
        setSelectedItems(newSelected);
      }
    }
  };

  const handleLinkWb = async (wbItem: any) => {
    if (!linkingStockId) return;
    const existingLinks = await db.wbLinksV2.toArray();
    const alreadyLinked = existingLinks.find((l: any) => l.myStockItemId === linkingStockId && (l.wbItemId === wbItem.id || (!l.wbItemId && l.nmId === wbItem.nmId)));
    if (!alreadyLinked) await db.wbLinksV2.add({ nmId: wbItem.nmId, wbItemId: wbItem.id, myStockItemId: linkingStockId });
    setLinkingStockId(null); setLinkSearchWb('');
  };

  const handleUnlinkWb = async (nmId: number, stockItemId: number) => {
    if (window.confirm('Отвязать карточку Wildberries от этого товара?')) {
      const links = await db.wbLinksV2.where('nmId').equals(nmId).toArray();
      const linkToDelete = links.find((l: any) => l.myStockItemId === stockItemId);
      if (linkToDelete && linkToDelete.id) await db.wbLinksV2.delete(linkToDelete.id);
    }
  };

  // ОБНОВЛЕННЫЙ ШАБЛОН (ДОБАВЛЕНА КОЛОНКА "ДАТА ПОСТУПЛЕНИЯ")
  const handleDownloadTemplate = () => {
    const data = [{ 
      'Категория': 'Одежда', 
      'Наименование': 'Пример: Футболка белая', 
      'Опт': 500, 
      'Остаток': 15, 
      'Дата поступления': new Date().toLocaleDateString('ru-RU'),
      'Примечание': 'На витрине' 
    }];
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
      
      // ИЩЕМ КОЛОНКУ С ДАТОЙ
      const colDate = headers.findIndex(h => ['дата', 'поступление', 'дата поступления'].includes(h));
      const colNote = headers.findIndex(h => ['примечание', 'инфо', 'описание'].includes(h));

      if (colTitle === -1) throw new Error('Не найдена колонка "Наименование"');

      // ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПАРСИНГА ДАТЫ ИЗ EXCEL
      const parseExcelDate = (val: any): string | null => {
        if (!val) return null;
        // 1. Если Excel передает дату как число (серийный номер)
        if (typeof val === 'number') {
          const date = new Date(Math.round((val - 25569) * 86400 * 1000));
          return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
        }
        // 2. Если Excel передает дату как строку "DD.MM.YYYY"
        const strVal = String(val).trim();
        const ruDateMatch = strVal.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
        if (ruDateMatch) {
          let [_, d, m, y] = ruDateMatch;
          if (y.length === 2) y = `20${y}`;
          const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
          if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
        }
        // 3. Стандартный парсинг JS
        const d = new Date(strVal);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        
        return null;
      };

      const now = new Date().toISOString();
      const todayDate = now.split('T')[0];
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

        // ОПРЕДЕЛЯЕМ ДАТУ ПОСТУПЛЕНИЯ
        let receiptDate = todayDate;
        if (colDate !== -1 && row[colDate]) {
          const parsedDate = parseExcelDate(row[colDate]);
          if (parsedDate) receiptDate = parsedDate; // Если получилось распарсить, используем эту дату
        }

        const existingItem = stockItems.find(item => item.title.toLowerCase() === title.toLowerCase());

        if (existingItem) {
          let changed = false;

          const addedQty = quantity - existingItem.quantity;
          const newReceipts = existingItem.receipts ? [...existingItem.receipts] : [];
          if (addedQty > 0) newReceipts.push({ date: receiptDate, quantity: addedQty, price: price });

          const updatedItem = { ...existingItem, category, price, quantity, note: note || existingItem.note, receipts: newReceipts };

          if (existingItem.price !== price) { logsToSave.push({ itemId: existingItem.id, title, field: 'Опт', oldValue: String(existingItem.price), newValue: String(price), changeDate: now }); changed = true; }
          if (existingItem.quantity !== quantity) { logsToSave.push({ itemId: existingItem.id, title, field: 'Остаток', oldValue: String(existingItem.quantity), newValue: String(quantity), changeDate: now }); changed = true; }
          if (existingItem.note !== note && note !== '') changed = true;

          if (changed || existingItem.category !== category) itemsToUpdate.push(updatedItem);
        } else {
          newItemsToSave.push({ title, category, price, quantity, note, receipts: [{ date: receiptDate, quantity, price }] });
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
    if (item) {
      setEditingItem({ ...item });
      setEditingReceipts(item.receipts || []);
    } else {
      setEditingItem({ title: '', category: '', price: 0, quantity: 0, note: '' });
      setEditingReceipts([{ date: new Date().toISOString().split('T')[0], quantity: 0, price: 0 }]);
    }
    setIsManualModalOpen(true);
  };

  const openKittingModal = (item: MyStockItem) => {
    if (!item.id) return alert('Сначала сохраните товар!');
    if (item.quantity <= 0) return alert('Остаток товара равен 0, комплектовать не из чего.');

    setKittingItem(item);
    setKittingItemsPerKit(2);
    setKittingCount(1);
    setIsManualModalOpen(false);
  };

  const handleSaveKitting = async () => {
    if (!kittingItem || !kittingItem.id) return;
    const totalToDeduct = kittingItemsPerKit * kittingCount;

    if (totalToDeduct > kittingItem.quantity) {
      return alert(`Недостаточно товара на складе! Нужно ${totalToDeduct} шт, а в наличии ${kittingItem.quantity} шт.`);
    }

    let remainingToDeduct = totalToDeduct;
    let totalCost = 0;

    const sourceReceipts = kittingItem.receipts ? JSON.parse(JSON.stringify(kittingItem.receipts)) : [];
    sourceReceipts.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (let i = 0; i < sourceReceipts.length; i++) {
      if (remainingToDeduct <= 0) break;
      const r = sourceReceipts[i];
      if (r.quantity > 0) {
        const take = Math.min(r.quantity, remainingToDeduct);
        r.quantity -= take;
        remainingToDeduct -= take;
        totalCost += take * r.price;
      }
    }

    if (totalCost === 0 && kittingItem.price > 0) {
      totalCost = kittingItem.price * totalToDeduct;
    }

    const updatedSourceReceipts = sourceReceipts.filter((r: any) => r.quantity > 0);
    const newSourceQty = kittingItem.quantity - totalToDeduct;
    const sourcePrice = updatedSourceReceipts.length > 0 ? updatedSourceReceipts[updatedSourceReceipts.length - 1].price : kittingItem.price;

    const kitPrice = totalCost / kittingCount; 
    const kitTitle = `${kittingItem.title} (${kittingItemsPerKit} шт.)`;
    const today = new Date().toISOString().split('T')[0];
    const nowISO = new Date().toISOString();

    const existingKit = await db.myWarehouse.where('title').equals(kitTitle).first();

    await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
      await db.myWarehouse.update(kittingItem.id!, {
        quantity: newSourceQty,
        receipts: updatedSourceReceipts,
        price: sourcePrice
      } as any);
      await db.myWarehouseChanges.add({ itemId: kittingItem.id, title: kittingItem.title, field: 'Остаток (Списано на сборку)', oldValue: String(kittingItem.quantity), newValue: String(newSourceQty), changeDate: nowISO });

      if (existingKit) {
        const kitReceipts = existingKit.receipts ? [...existingKit.receipts] : [];
        kitReceipts.push({ date: today, quantity: kittingCount, price: kitPrice });
        const newKitQty = existingKit.quantity + kittingCount;

        await db.myWarehouse.update(existingKit.id!, {
          quantity: newKitQty,
          receipts: kitReceipts,
          price: kitPrice 
        } as any);
        await db.myWarehouseChanges.add({ itemId: existingKit.id, title: kitTitle, field: 'Остаток (Скомплектовано)', oldValue: String(existingKit.quantity), newValue: String(newKitQty), changeDate: nowISO });
      } else {
        const newKit = {
          title: kitTitle,
          category: kittingItem.category,
          price: kitPrice,
          quantity: kittingCount,
          note: 'Создано из комплектации',
          receipts: [{ date: today, quantity: kittingCount, price: kitPrice }]
        } as MyStockItem;

        const newId = await db.myWarehouse.add(newKit);
        await db.myWarehouseChanges.add({ itemId: newId as number, title: kitTitle, field: 'Остаток (Новый комплект)', oldValue: "0", newValue: String(kittingCount), changeDate: nowISO });
      }
    });

    alert(`Комплектация успешно завершена!\nСоздано: ${kittingCount} шт. "${kitTitle}"\nСписано: ${totalToDeduct} шт.`);
    setKittingItem(null);
  };

  const handleReceiptChange = (index: number, field: keyof StockReceipt, value: string) => {
    const updated = [...editingReceipts];
    updated[index] = { ...updated[index], [field]: field === 'date' ? value : Number(value) };
    setEditingReceipts(updated);
  };

  const handleSaveManual = async () => {
    if (!editingItem.title) return alert('Укажите наименование товара!');

    const now = new Date().toISOString();
    const itemToSave = {
      ...editingItem,
      category: editingItem.category || 'Без категории',
      price: Number(editingItem.price) || 0,
      quantity: Number(editingItem.quantity) || 0,
      note: editingItem.note || '',
      receipts: editingReceipts.filter(r => r.quantity > 0)
    } as MyStockItem;

    if (!itemToSave.id && itemToSave.receipts!.length > 0 && itemToSave.quantity === 0) {
      itemToSave.quantity = itemToSave.receipts!.reduce((sum, r) => sum + r.quantity, 0);
      itemToSave.price = itemToSave.receipts![itemToSave.receipts!.length - 1].price;
    }

    if (editingItem.id) {
      const oldItem = stockItems.find(i => i.id === editingItem.id);
      const logs: any[] = [];
      if (oldItem) {
        if (oldItem.price !== itemToSave.price) logs.push({ itemId: oldItem.id, title: oldItem.title, field: 'Опт', oldValue: String(oldItem.price), newValue: String(itemToSave.price), changeDate: now });
        if (oldItem.quantity !== itemToSave.quantity) logs.push({ itemId: oldItem.id, title: oldItem.title, field: 'Остаток', oldValue: String(oldItem.quantity), newValue: String(itemToSave.quantity), changeDate: now });

        await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
          await db.myWarehouse.put(itemToSave);
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
      await db.myWarehouse.put({ ...item, quantity: newQuantity });
      await db.myWarehouseChanges.add(log);
    });
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4 flex-1">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Мой Склад</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск товара..." />
          <div className="relative flex items-center">
            <Filter size={14} className="absolute left-3 text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-600 font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm cursor-pointer hover:bg-gray-50"
            >
              <option value="">Все категории</option>
              {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* ПЛАШКА МАССОВЫХ ДЕЙСТВИЙ */}
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2 bg-red-50 pl-3 pr-1.5 py-1.5 rounded-lg border border-red-200 mr-2 animate-in fade-in zoom-in duration-200 shadow-sm">
              <CheckSquare size={14} className="text-red-500" />
              <span className="text-[12px] font-bold text-red-800 tracking-wide">Выбрано: {selectedItems.size}</span>
              <button 
                onClick={handleMassDelete} 
                className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded shadow-sm transition-colors ml-2"
                disabled={isLoading}
              >
                <Trash2 size={13} /> Удалить всё
              </button>
              <button onClick={() => setSelectedItems(new Set())} className="text-red-400 hover:text-red-700 p-1 hover:bg-red-100 rounded transition-colors ml-1" title="Снять выделение">
                <X size={14} />
              </button>
            </div>
          )}

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
            <table className="w-full min-w-[1050px] table-fixed text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3 sticky left-0 bg-gray-50 z-30 shadow-[1px_0_0_0_#e5e7eb] w-[30%]">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        title="Выбрать все"
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer shadow-sm"
                        checked={filteredItems.length > 0 && selectedItems.size === filteredItems.length}
                        onChange={handleSelectAll}
                      />
                      <span>Наименование и Категория</span>
                    </div>
                  </th>
                  <th className="px-5 py-3 border-r border-gray-100 text-right w-[10%]">Опт (Последний)</th>
                  <th className="px-5 py-3 border-r border-gray-100 text-center w-[15%]">Остаток</th>
                  <th className="px-5 py-3 border-r border-gray-100 min-w-[220px]">Связь с ВБ (Карточки)</th>
                  <th className="px-5 py-3 text-center w-[15%]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => {
                  const linkedWbItems = wbLinks
                    .filter((l: any) => l.myStockItemId === item.id)
                    .map((l: any) => wbProducts.find((p: any) => l.wbItemId ? p.id === l.wbItemId : p.nmId === l.nmId))
                    .filter(Boolean);

                  const latestReceipt = item.receipts && item.receipts.length > 0 ? item.receipts[item.receipts.length - 1] : null;
                  const isSelected = selectedItems.has(item.id!);

                  return (
                    <tr key={item.id} className={`hover:bg-gray-50/80 transition-colors group ${isSelected ? 'bg-blue-50/30' : 'bg-white'}`}>
                      <td className={`px-5 py-3 sticky left-0 group-hover:bg-gray-50/80 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal break-words ${isSelected ? 'bg-blue-50/50' : 'bg-white'}`}>
                        <div className="flex items-start gap-3">
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer mt-1 flex-shrink-0"
                            checked={isSelected}
                            onChange={() => handleSelectItem(item.id!)}
                          />
                          <div className="flex flex-col justify-center">
                            <h3 className="text-[14px] font-bold text-[#1e3a5f] leading-snug line-clamp-2">{item.title}</h3>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md text-[11px] font-bold border border-indigo-100 cursor-pointer hover:bg-indigo-100" onClick={() => setSelectedCategory(item.category || 'Без категории')} title="Фильтровать по этой категории">
                                {item.category || 'Без категории'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 border-r border-gray-100 text-right align-middle">
                        <div className="flex flex-col items-end">
                          <span className="text-[14px] font-bold text-gray-800">
                            {latestReceipt 
                              ? `${Number(latestReceipt.price).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` 
                              : (item.price ? `${Number(item.price).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '0 ₽')}
                          </span>
                          {latestReceipt && <span className="text-[10px] text-gray-400 mt-0.5">от {new Date(latestReceipt.date).toLocaleDateString('ru-RU')}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 border-r border-gray-100 text-center align-middle">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleQuickStockChange(item, -1)} disabled={item.quantity <= 0} className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-50 transition-colors"><Minus size={14} /></button>
                          <div className={`inline-flex items-center justify-center min-w-[44px] h-[30px] px-2.5 border rounded-lg text-[13px] font-bold shadow-sm ${item.quantity > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{item.quantity} шт</div>
                          <button onClick={() => handleQuickStockChange(item, 1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-600 transition-colors"><Plus size={14} /></button>
                        </div>
                      </td>

                      <td className="px-5 py-3 border-r border-gray-100 align-middle">
                        <div className="flex flex-col gap-2">
                          {linkedWbItems.map((p: any) => (
                            <div key={p!.nmId} className="flex items-center justify-between gap-3 px-2 py-1.5 bg-blue-50/50 rounded-lg border border-blue-100">
                              <div className="flex flex-col max-w-[200px] whitespace-normal break-words">
                                <span className="text-[11px] font-bold text-blue-900 leading-tight line-clamp-2" title={p!.title}>
                                  {p!.title} {p!.techSize && p!.techSize !== '0' && `(Разм: ${p!.techSize})`}
                                </span>
                                <span className="text-[10px] text-gray-500 mt-0.5">Арт: {p!.vendorCode}</span>
                              </div>
                              <button onClick={() => handleUnlinkWb(p!.nmId, item.id!)} className="text-blue-300 hover:text-red-500 transition-colors flex-shrink-0" title="Отвязать WB карточку">
                                <Unlink size={14} />
                              </button>
                            </div>
                          ))}
                          {linkedWbItems.length === 0 && (
                            <button
                              onClick={() => setLinkingStockId(item.id!)}
                              className="inline-flex w-max items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                            >
                              <LinkIcon size={12} /> Привязать карточку WB
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-3 text-center align-middle">
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => setHistoryItem(item)} className={`flex items-center gap-1.5 text-[12px] font-bold px-2 py-1 rounded-md transition-colors ${changes.some(c => c.itemId === item.id) ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`} title="Посмотреть историю">
                            <History size={14} /> История
                          </button>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openKittingModal(item)} className="text-gray-400 hover:text-indigo-600 transition-colors" title="Скомплектовать наборы"><PackagePlus size={16} /></button>
                            <button onClick={() => openManualModal(item)} className="text-gray-400 hover:text-blue-600 transition-colors"><Edit3 size={16} /></button>
                            <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>

      {/* МОДАЛЬНОЕ ОКНО ПОИСКА WB ДЛЯ ПРИВЯЗКИ */}
      {linkingStockId && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[75vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-blue-50/50">
              <div>
                <h3 className="text-[16px] font-bold text-[#1e3a5f] flex items-center gap-2">
                  <LinkIcon size={18} className="text-blue-500" /> Связать с карточкой Wildberries
                </h3>
                <p className="text-[12px] text-gray-500 mt-1">Выберите товар из каталога WB, который соответствует этому товару на складе</p>
              </div>
              <button onClick={() => { setLinkingStockId(null); setLinkSearchWb(''); }} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-white rounded-lg transition-colors"><X size={20} /></button>
            </div>

            <div className="p-4 border-b border-gray-100 bg-white">
              <SearchInput value={linkSearchWb} onChange={setLinkSearchWb} placeholder="Поиск по артикулу или названию WB..." />
            </div>

            <div className="overflow-y-auto flex-1 p-2 space-y-1 bg-gray-50/50">
              {searchFilteredWbProducts.length === 0 ? (
                <div className="text-center p-8 text-gray-400 text-[13px]">
                  <Box size={32} className="mx-auto mb-2 opacity-50" />
                  В каталоге WB ничего не найдено по вашему запросу.
                </div>
              ) : (
                searchFilteredWbProducts.map(wbItem => (
                  <div
                    key={wbItem.nmId}
                    onClick={() => handleLinkWb(wbItem)}
                    className="flex items-center gap-4 p-3 bg-white border border-gray-100 rounded-xl cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm"
                  >
                    <div className="w-10 h-10 rounded border border-gray-200 overflow-hidden flex-shrink-0 bg-gray-50 flex items-center justify-center">
                      {wbItem.photo ? <img src={wbItem.photo} alt="img" className="w-full h-full object-cover" /> : <span className="text-xs text-gray-300">Нет</span>}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 pr-4">
                      <span className="text-[13px] font-bold text-gray-800 leading-snug line-clamp-1">{wbItem.title}</span>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[11px] font-medium text-gray-500">Арт: <span className="text-gray-700">{wbItem.vendorCode}</span></span>
                        <span className="text-[11px] font-medium text-gray-500">nmID: <span className="text-gray-700">{wbItem.nmId}</span></span>
                        {wbItem.techSize && wbItem.techSize !== '0' && (
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded ml-2">
                            Размер: {wbItem.techSize}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО КОМПЛЕКТАЦИИ */}
      {kittingItem && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-indigo-100 flex justify-between items-center bg-indigo-50/80">
              <h3 className="text-[16px] font-bold text-indigo-900 flex items-center gap-2">
                <PackagePlus size={18} className="text-indigo-600" /> Комплектация товара
              </h3>
              <button onClick={() => setKittingItem(null)} className="p-1.5 text-indigo-400 hover:text-indigo-700 hover:bg-white rounded-lg transition-colors"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1">Оригинальный товар</p>
                <p className="text-[14px] font-bold text-gray-900 leading-snug">{kittingItem.title}</p>
                <div className="flex gap-4 mt-2">
                  <span className="text-[12px] font-medium text-gray-600">Опт: <b>{Number(kittingItem.price).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</b></span>
                  <span className="text-[12px] font-medium text-gray-600">Доступно: <b className="text-green-600">{kittingItem.quantity} шт</b></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">В одном комплекте (ШТ)</label>
                  <input type="number" min="1" value={kittingItemsPerKit} onChange={e => setKittingItemsPerKit(parseInt(e.target.value, 10) || 1)} className="w-full bg-white border border-indigo-200 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-900" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Сколько наборов собрать</label>
                  <input type="number" min="1" value={kittingCount} onChange={e => setKittingCount(parseInt(e.target.value, 10) || 1)} className="w-full bg-white border border-indigo-200 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-900" />
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Итоговый результат</p>
                <div className="space-y-2 text-[13px]">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Спишется оригинала:</span>
                    <span className="font-bold text-red-600">-{kittingItemsPerKit * kittingCount} шт.</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Останется оригинала:</span>
                    <span className="font-bold text-gray-900">{Math.max(0, kittingItem.quantity - (kittingItemsPerKit * kittingCount))} шт.</span>
                  </div>
                  <div className="mt-3 p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                    <span className="block text-[10px] text-indigo-400 uppercase font-bold mb-1">Появится новый товар:</span>
                    <span className="font-bold text-indigo-900 line-clamp-2">{kittingItem.title} ({kittingItemsPerKit} шт.)</span>
                    <div className="flex gap-3 mt-1.5">
                      <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">+{kittingCount} шт.</span>
                      <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">Себестоимость: ~{Number(kittingItem.price * kittingItemsPerKit).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setKittingItem(null)}>Отмена</Button>
              <Button onClick={handleSaveKitting} disabled={kittingItemsPerKit * kittingCount > kittingItem.quantity || kittingCount < 1}>
                <PackagePlus size={16} /> Создать {kittingCount} наб.
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ С ПАРТИЯМИ */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-[16px] font-bold text-[#1e3a5f]">{editingItem.id ? 'Редактировать товар' : 'Добавить товар'}</h3>
              <button onClick={() => setIsManualModalOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Наименование *</label>
                <input type="text" value={editingItem.title || ''} onChange={e => setEditingItem({ ...editingItem, title: e.target.value })} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Категория</label>
                  <input type="text" list="categoryList" value={editingItem.category || ''} onChange={e => setEditingItem({ ...editingItem, category: e.target.value })} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
                  <datalist id="categoryList">{uniqueCategories.map(cat => <option key={cat} value={cat} />)}</datalist>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">ТЕКУЩИЙ Остаток (ШТ)</label>
                  <input type="number" min="0" value={editingItem.quantity === 0 ? '' : editingItem.quantity} onChange={e => setEditingItem({ ...editingItem, quantity: parseInt(e.target.value, 10) || 0 })} className="w-full bg-white border border-blue-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-900" placeholder="0" title="Общий физический остаток на полке" />
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center mb-3">
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest">История поступлений (Партии)</label>
                  <button type="button" onClick={() => setEditingReceipts([...editingReceipts, { date: new Date().toISOString().split('T')[0], quantity: 0, price: 0 }])} className="text-[11px] text-blue-600 font-bold hover:underline bg-blue-50 px-2 py-1 rounded">
                    + Добавить партию
                  </button>
                </div>

                <div className="space-y-2">
                  {editingReceipts.map((r, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                      <div className="flex-1">
                        <span className="text-[9px] text-gray-400 font-bold uppercase ml-1">Дата</span>
                        <input type="date" value={r.date} onChange={e => handleReceiptChange(idx, 'date', e.target.value)} className="w-full bg-white border border-gray-200 rounded p-1.5 text-[12px] outline-none" />
                      </div>
                      <div className="w-20">
                        <span className="text-[9px] text-gray-400 font-bold uppercase ml-1">Шт</span>
                        <input type="number" min="0" value={r.quantity || ''} onChange={e => handleReceiptChange(idx, 'quantity', e.target.value)} placeholder="0" className="w-full bg-white border border-gray-200 rounded p-1.5 text-[12px] outline-none text-center" />
                      </div>
                      <div className="w-24">
                        <span className="text-[9px] text-gray-400 font-bold uppercase ml-1">Цена (₽)</span>
                        <input type="number" min="0" step="0.01" value={r.price || ''} onChange={e => handleReceiptChange(idx, 'price', e.target.value)} placeholder="0" className="w-full bg-white border border-gray-200 rounded p-1.5 text-[12px] outline-none text-right" />
                      </div>
                      <button type="button" onClick={() => setEditingReceipts(editingReceipts.filter((_, i) => i !== idx))} className="mt-4 p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {editingReceipts.length === 0 && <div className="text-center text-[12px] text-gray-400 py-2 italic">Нет партий</div>}
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Примечание</label>
                <input type="text" value={editingItem.note || ''} onChange={e => setEditingItem({ ...editingItem, note: e.target.value })} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between gap-3 flex-shrink-0">
              {editingItem.id ? (
                <Button variant="outline" onClick={() => openKittingModal(editingItem as MyStockItem)} className="mr-auto text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                  <PackagePlus size={16} /> Скомплектовать
                </Button>
              ) : <div></div>}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsManualModalOpen(false)}>Отмена</Button>
                <Button onClick={handleSaveManual}><Save size={16} /> Сохранить</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyItem && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-[15px] font-bold text-[#1e3a5f] truncate pr-4">История: {historyItem.title}</h3>
              <button onClick={() => setHistoryItem(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="p-0 overflow-y-auto flex-1">
              {changes.filter(c => c.itemId === historyItem.id).length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-[14px]">У этого товара пока нет истории изменений.</div>
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
                    {changes.filter(c => c.itemId === historyItem.id).sort((a, b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime()).map(change => (
                      <tr key={change.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-[12px] text-gray-500 font-medium">{new Date(change.changeDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="px-4 py-3 text-center"><span className="text-[11px] font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">{change.field}</span></td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[13px] text-gray-400 line-through">{change.oldValue}</span>
                            <ArrowRight size={14} className="text-gray-300" />
                            <span className={`text-[13px] font-bold px-2 py-0.5 rounded-md border ${parseFloat(change.newValue) > parseFloat(change.oldValue) ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                              {change.newValue} {change.field.includes('Остаток') ? 'шт' : '₽'}
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