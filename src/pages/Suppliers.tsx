import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Edit3, Trash2, X, Save, RefreshCw, FileSpreadsheet, Layers, Wand2, PackageSearch, TrendingUp, TrendingDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, Supplier, SupplierSheetMapping, MyStockItem } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

interface ExtendedMapping extends SupplierSheetMapping {
  url?: string;
}

// =================================================================
// 1. ПРЯМОЕ ЧТЕНИЕ GOOGLE ТАБЛИЦ ПО GID
// =================================================================
async function fetchGvizSheet(url: string): Promise<XLSX.WorkSheet> {
  const matchId = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const matchGid = url.match(/gid=([0-9]+)/);
  if (!matchId) throw new Error("Неверная ссылка Google Таблицы.");
  
  const docId = matchId[1];
  const gid = matchGid ? matchGid[1] : '0';

  const gvizUrl = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  
  const res = await fetch(gvizUrl);
  if (!res.ok) throw new Error("Ошибка доступа к таблице. Убедитесь, что доступ по ссылке 'Читатель' открыт для всех.");
  
  const csvText = await res.text();
  const workbook = XLSX.read(csvText, { type: 'string', raw: true });
  return workbook.Sheets[workbook.SheetNames[0]];
}

// =================================================================
// АВТО-ОПРЕДЕЛЕНИЕ КОЛОНОК
// =================================================================
const autoDetectColumns = (sheet: XLSX.WorkSheet) => {
  let colName = '', colWholesale = '', colRrc = '', colStock = '';
  let colNote = '', colDimensions = '', colWeight = '';
  
  const rangeStr = sheet['!ref'];
  if (rangeStr) {
    const range = XLSX.utils.decode_range(rangeStr);
    for (let R = range.s.r; R <= Math.min(range.e.r, 10); ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = sheet[XLSX.utils.encode_cell({ c: C, r: R })];
        const val = cell ? String(cell.v).toLowerCase().trim() : '';
        const letter = XLSX.utils.encode_col(C);
        
        if (!colName && ['наименование', 'товар', 'название'].some(k => val.includes(k))) colName = letter;
        if (!colWholesale && ['опт', 'закуп', 'цена'].some(k => val.includes(k))) colWholesale = letter;
        if (!colRrc && ['ррц', 'мрц', 'розница'].some(k => val.includes(k))) colRrc = letter;
        if (!colStock && ['склад', 'остаток', 'кол-во', 'наличие'].some(k => val.includes(k))) colStock = letter;
        if (!colNote && ['примечание', 'инфо', 'подробнее', 'ссылка'].some(k => val.includes(k))) colNote = letter;
        if (!colDimensions && ['габарит', 'размер', 'упаковк'].some(k => val.includes(k))) colDimensions = letter;
        if (!colWeight && ['вес', 'масса'].some(k => val.includes(k))) colWeight = letter;
      }
      if (colName && colWholesale && colStock) break;
    }
  }
  return { colName, colWholesale, colRrc, colStock, colNote, colDimensions, colWeight };
};

function parseStockBadge(val: any): { text: string, color: string, isOutOfStock: boolean } {
  if (val === null || val === undefined || String(val).trim() === '') return { text: '—', color: 'bg-gray-100 text-gray-700 border-gray-200', isOutOfStock: true };
  const rawStr = String(val).trim();
  const lower = rawStr.toLowerCase();
  const numericVal = parseFloat(rawStr.replace(/,/g, '.').replace(/\s/g, ''));

  let color = 'bg-gray-100 text-gray-700 border-gray-200', text = rawStr, isOutOfStock = false;

  if (/^[\-\u2010\u2012\u2013\u2014\u2212]+$/.test(rawStr)) { color = 'bg-red-50 text-red-700 border-red-200'; text = 'Нет'; isOutOfStock = true; } 
  else if (/^\++$/.test(rawStr)) { color = 'bg-green-50 text-green-700 border-green-200'; text = `В наличии`; } 
  else if (!isNaN(numericVal)) {
    if (numericVal >= 10) color = 'bg-green-50 text-green-700 border-green-200';
    else if (numericVal >= 5) color = 'bg-yellow-50 text-yellow-700 border-yellow-200';
    else if (numericVal > 0) color = 'bg-orange-50 text-orange-700 border-orange-200';
    else { color = 'bg-red-50 text-red-700 border-red-200'; isOutOfStock = true; }
    text = `${numericVal} шт`;
  } else {
    if (lower.includes('есть') || rawStr.includes('>')) color = 'bg-green-50 text-green-700 border-green-200';
    else if (lower.includes('нет') || lower.includes('мало') || rawStr.includes('<') || ['x', 'х', '×'].includes(lower)) {
      color = 'bg-red-50 text-red-700 border-red-200';
      if (['x', 'х', '×'].includes(lower)) text = 'X';
      isOutOfStock = true;
    }
  }
  return { text, color, isOutOfStock };
}

// =================================================================
// ПАРСИНГ ДАННЫХ ИЗ ЛИСТА
// =================================================================
const parseSheetData = (sheet: XLSX.WorkSheet, map: ExtendedMapping) => {
  const parsedRows: any[] = [];
  const rangeStr = sheet['!ref'];
  if (!rangeStr || !map.colName) return parsedRows;

  const range = XLSX.utils.decode_range(rangeStr);
  let currentCategory = '';
  
  const merges = sheet['!merges'] || [];
  const nameColIdx = XLSX.utils.decode_col(map.colName.toUpperCase());

  for (let R = range.s.r; R <= range.e.r; ++R) {
    const getCell = (colLetter: string) => {
      if (!colLetter) return '';
      const colIndex = XLSX.utils.decode_col(colLetter.toUpperCase());
      const cell = sheet[XLSX.utils.encode_cell({ c: colIndex, r: R })];
      if (!cell) return '';
      return cell.w ? String(cell.w).trim() : String(cell.v).trim();
    };

    const name = getCell(map.colName);
    const wholesale = getCell(map.colWholesale);
    const rrc = getCell(map.colRrc);
    const stock = getCell(map.colStock);
    const note = getCell(map.colNote || '');
    const dimensions = getCell(map.colDimensions || '');
    const weight = getCell(map.colWeight || '');

    if (!name) continue; 

    const isHeader = ['наименование', 'товар', 'название'].includes(name.toLowerCase()) || 
                     (wholesale && ['опт', 'цена', 'закуп'].includes(wholesale.toLowerCase()));
    if (isHeader) continue;

    const isMerged = merges.some(m => R >= m.s.r && R <= m.e.r && m.s.c !== m.e.c && nameColIdx >= m.s.c && nameColIdx <= m.e.c);
    const isStockEmptyOrSymbol = !stock || /^[\.\•\*\▪\-\_\=\+]+$/.test(stock);
    const isOnlyNameFilled = name && !wholesale && !rrc && isStockEmptyOrSymbol;

    const isCategory = isMerged || isOnlyNameFilled;

    if (isCategory) {
      currentCategory = name;
      parsedRows.push({ kind: 'category', title: name, sheetName: map.sheetName });
    } else if (wholesale || rrc || stock || note) {
      parsedRows.push({ 
        kind: 'item', category: currentCategory, title: name, 
        wholesale, rrc, stock, note, dimensions, weight, sheetName: map.sheetName 
      });
    }
  }
  return parsedRows;
};

// =================================================================
// РАСЧЕТ И ЗАПИСЬ ИЗМЕНЕНИЙ В ЛОГ (С ДОБАВЛЕНИЕМ ТРЕНДОВ)
// =================================================================
const extractNumber = (val: string) => {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : num;
};

async function calculateAndSaveDiffs(supplierId: number, supplierName: string, oldData: any[], newData: any[]) {
  if (!oldData || oldData.length === 0) return; 
  
  const oldMap = new Map();
  oldData.forEach(item => {
    if (item.kind === 'item') {
      const key = `${item.sheetName}|${item.category}|${item.title}`.toLowerCase();
      oldMap.set(key, item);
    }
  });

  const changesToSave: any[] = [];
  const now = new Date().toISOString();

  newData.forEach(newItem => {
    if (newItem.kind === 'item') {
      const key = `${newItem.sheetName}|${newItem.category}|${newItem.title}`.toLowerCase();
      const oldItem = oldMap.get(key);

      newItem.trends = {};

      if (oldItem) {
        const checkField = (fieldKey: string, fieldLabel: string) => {
          const oldVal = String(oldItem[fieldKey] || '').trim();
          const newVal = String(newItem[fieldKey] || '').trim();
          if (oldVal !== newVal) {
            changesToSave.push({
              supplierId, supplierName, sheetName: newItem.sheetName,
              category: newItem.category, title: newItem.title,
              field: fieldLabel, oldValue: oldVal, newValue: newVal, changeDate: now
            });
            
            // Расчет направления тренда для отображения в таблице
            const oldNum = extractNumber(oldVal);
            const newNum = extractNumber(newVal);
            if (newNum > oldNum) newItem.trends[fieldKey] = 'up';
            else if (newNum < oldNum) newItem.trends[fieldKey] = 'down';
            else newItem.trends[fieldKey] = 'changed';
          }
        };

        checkField('wholesale', 'Опт');
        checkField('rrc', 'РРЦ');
        checkField('stock', 'Остаток');
      } else {
        // Товар не найден в старом прайсе = Новинка
        newItem.isNew = true;
      }
    }
  });

  if (changesToSave.length > 0) {
    await db.supplierChanges.bulkAdd(changesToSave);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  await db.supplierChanges.where('changeDate').below(sevenDaysAgo.toISOString()).delete();
}

// Отрисовка стрелочки тренда
const renderTrend = (trend: string, isPrice: boolean) => {
  if (trend === 'up') {
    return isPrice 
      ? <TrendingUp size={14} className="text-red-500 inline-block ml-1.5 mb-0.5" /> 
      : <TrendingUp size={14} className="text-green-500 inline-block ml-1.5 mb-0.5" />;
  }
  if (trend === 'down') {
    return isPrice 
      ? <TrendingDown size={14} className="text-green-500 inline-block ml-1.5 mb-0.5" /> 
      : <TrendingDown size={14} className="text-red-500 inline-block ml-1.5 mb-0.5" />;
  }
  return null;
};

export default function Suppliers() {
  const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
  const [activeSupplierId, setActiveSupplierId] = useState<number | null>(null);
  const [activeSheetTab, setActiveSheetTab] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Состояния для модальных окон
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [sourceType, setSourceType] = useState<'google' | 'file'>('google');
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [previewWorkbook, setPreviewWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetMappings, setSheetMappings] = useState<ExtendedMapping[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [transferItem, setTransferItem] = useState<Partial<MyStockItem> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSupplier = useMemo(() => suppliers.find(s => s.id === activeSupplierId), [suppliers, activeSupplierId]);

  useEffect(() => {
    if (suppliers.length > 0 && !activeSupplierId) setActiveSupplierId(suppliers[0].id!);
  }, [suppliers, activeSupplierId]);

  useEffect(() => {
    if (activeSupplier && activeSupplier.sheets) {
      const enabledSheets = activeSupplier.sheets.filter(s => s.enabled);
      if (enabledSheets.length > 0 && (!activeSheetTab || !enabledSheets.some(s => s.sheetName === activeSheetTab))) {
        setActiveSheetTab(enabledSheets[0].sheetName);
      }
    }
  }, [activeSupplier]);

  const updateMapping = (idx: number, field: keyof ExtendedMapping, value: any) => {
    const newMappings = [...sheetMappings];
    newMappings[idx] = { ...newMappings[idx], [field]: value };
    setSheetMappings(newMappings);
  };

  const handleAddGoogleSheet = () => {
    setSheetMappings([...sheetMappings, { sheetName: `Вкладка ${sheetMappings.length + 1}`, enabled: true, url: '', colName: '', colWholesale: '', colRrc: '', colStock: '', colNote: '', colDimensions: '', colWeight: '' }]);
  };

  const handleRemoveMapping = (idx: number) => {
    const newMappings = [...sheetMappings];
    newMappings.splice(idx, 1);
    setSheetMappings(newMappings);
  };

  const handleAutoDetectGoogle = async (idx: number) => {
    const map = sheetMappings[idx];
    if (!map.url) return alert('Сначала вставьте ссылку на этот лист!');
    setIsLoading(true);
    try {
      const sheet = await fetchGvizSheet(map.url);
      const cols = autoDetectColumns(sheet);
      const newMappings = [...sheetMappings];
      newMappings[idx] = { ...map, ...cols };
      setSheetMappings(newMappings);
    } catch (e: any) { alert(e.message); } 
    finally { setIsLoading(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setModalFile(file);
    setIsLoading(true);
    try {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
      const wb = XLSX.read(data, { type: 'array' });
      setPreviewWorkbook(wb);

      const initialMappings = wb.SheetNames.map((name, i) => {
        const cols = autoDetectColumns(wb.Sheets[name]);
        return { sheetName: name, enabled: i === 0, ...cols };
      });
      setSheetMappings(initialMappings);
    } catch (e: any) { alert("Ошибка чтения файла"); } 
    finally { setIsLoading(false); }
  };

  const handleSave = async () => {
    if (!modalTitle) return alert('Введите название поставщика');
    const activeMappings = sheetMappings.filter(m => m.enabled);
    if (activeMappings.length === 0) return alert('Добавьте хотя бы одну вкладку');
    if (activeMappings.some(m => !m.colName)) return alert('Укажите колонку "Наименование" для всех вкладок');
    if (sourceType === 'google' && activeMappings.some(m => !m.url)) return alert('Укажите ссылки для всех вкладок');

    setIsLoading(true);
    try {
      let allParsedRows: any[] = [];
      if (sourceType === 'google') {
        for (const map of activeMappings) {
          const sheet = await fetchGvizSheet(map.url!);
          allParsedRows = [...allParsedRows, ...parseSheetData(sheet, map)];
        }
      } else {
        if (!previewWorkbook) throw new Error('Файл не загружен');
        for (const map of activeMappings) {
          const sheet = previewWorkbook.Sheets[map.sheetName];
          if (sheet) allParsedRows = [...allParsedRows, ...parseSheetData(sheet, map)];
        }
      }

      const supplier: Supplier = { title: modalTitle, sourceUrl: sourceType, sheets: activeMappings, cachedData: allParsedRows, lastSync: new Date().toLocaleString('ru-RU') };
      
      if (editingId) {
        const oldSupplier = await db.suppliers.get(editingId);
        if (oldSupplier && oldSupplier.cachedData) await calculateAndSaveDiffs(editingId, modalTitle, oldSupplier.cachedData, allParsedRows);
        await db.suppliers.update(editingId, supplier as any);
      } else {
        await db.suppliers.add(supplier);
      }
      setIsModalOpen(false);
    } catch (e: any) { alert(e.message); } 
    finally { setIsLoading(false); }
  };

  const openModal = (supplier?: Supplier) => {
    setEditingId(supplier?.id || null);
    setModalTitle(supplier?.title || '');
    setSourceType(supplier?.sourceUrl === 'file' ? 'file' : 'google');
    setModalFile(null); setPreviewWorkbook(null);
    setSheetMappings(supplier?.sheets || [{ sheetName: 'Общий прайс', enabled: true, url: '', colName: '', colWholesale: '', colRrc: '', colStock: '', colNote: '', colDimensions: '', colWeight: '' }]);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Точно удалить прайс-лист?')) {
      await db.suppliers.delete(id);
      await db.supplierChanges.where('supplierId').equals(id).delete();
      if (activeSupplierId === id) setActiveSupplierId(suppliers[0]?.id || null);
    }
  };

  const handleRefreshActive = async () => {
    if (!activeSupplier) return;
    if (activeSupplier.sourceUrl === 'file') return alert('Локальные файлы обновляются через Редактирование -> Загрузить новый файл.');
    
    setIsLoading(true);
    try {
      let allParsedRows: any[] = [];
      for (const map of activeSupplier.sheets as ExtendedMapping[]) {
        if (!map.enabled || !map.url) continue;
        const sheet = await fetchGvizSheet(map.url);
        allParsedRows = [...allParsedRows, ...parseSheetData(sheet, map)];
      }
      await calculateAndSaveDiffs(activeSupplier.id!, activeSupplier.title, activeSupplier.cachedData || [], allParsedRows);
      await db.suppliers.update(activeSupplier.id!, { cachedData: allParsedRows, lastSync: new Date().toLocaleString('ru-RU') });
      alert('Данные успешно загружены!');
    } catch (e: any) { alert(`Ошибка обновления: ${e.message}`); } 
    finally { setIsLoading(false); }
  };

  const handleRefreshAll = async () => {
    if (suppliers.length === 0) return;
    
    setIsRefreshingAll(true);
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const supplier of suppliers) {
      if (supplier.sourceUrl === 'file') {
        skippedCount++;
        continue;
      }

      try {
        let allParsedRows: any[] = [];
        for (const map of supplier.sheets as ExtendedMapping[]) {
          if (!map.enabled || !map.url) continue;
          const sheet = await fetchGvizSheet(map.url);
          allParsedRows = [...allParsedRows, ...parseSheetData(sheet, map)];
        }
        await calculateAndSaveDiffs(supplier.id!, supplier.title, supplier.cachedData || [], allParsedRows);
        await db.suppliers.update(supplier.id!, { cachedData: allParsedRows, lastSync: new Date().toLocaleString('ru-RU') });
        updatedCount++;
      } catch (e) {
        errorCount++;
      }
    }

    setIsRefreshingAll(false);
    alert(`Обновление завершено!\n\nУспешно обновлено: ${updatedCount}\nПропущено (локальные файлы): ${skippedCount}\nОшибок: ${errorCount}`);
  };

  // =================================================================
  // ПЕРЕНОС ТОВАРА НА "МОЙ СКЛАД" (ТЕПЕРЬ ДОБАВЛЯЕТ ОСТАТКИ И ПАРТИИ)
  // =================================================================
  const openTransferModal = (row: any) => {
    const price = parseFloat(String(row.wholesale || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    const quantity = parseInt(String(row.stock || '').replace(/[^\d-]/g, ''), 10) || 0;
    
    setTransferItem({
      title: row.title,
      category: row.category || 'Без категории',
      price: price,
      quantity: quantity > 0 ? quantity : 0, 
      note: row.note || ''
    });
  };

  const handleSaveTransfer = async () => {
    if (!transferItem?.title) return alert('Ошибка: у товара нет названия');
    
    const now = new Date().toISOString();
    const todayDate = now.split('T')[0];
    
    const priceToSave = Number(transferItem.price) || 0;
    const quantityToSave = Number(transferItem.quantity) || 0;

    if (quantityToSave <= 0) {
      return alert('Укажите количество больше 0 для добавления на склад.');
    }

    const existingItem = await db.myWarehouse.where('title').equals(transferItem.title).first();

    if (existingItem) {
      // ТОВАР УЖЕ ЕСТЬ: прибавляем остаток и записываем новую партию
      const newTotalQty = existingItem.quantity + quantityToSave;
      const newReceipts = existingItem.receipts ? [...existingItem.receipts] : [];
      
      newReceipts.push({ date: todayDate, quantity: quantityToSave, price: priceToSave });

      const logs: any[] = [];
      if (existingItem.price !== priceToSave) {
        logs.push({ itemId: existingItem.id, title: existingItem.title, field: 'Опт', oldValue: String(existingItem.price), newValue: String(priceToSave), changeDate: now });
      }
      logs.push({ itemId: existingItem.id, title: existingItem.title, field: 'Остаток', oldValue: String(existingItem.quantity), newValue: String(newTotalQty), changeDate: now });
      
      await db.transaction('rw', db.myWarehouse, db.myWarehouseChanges, async () => {
         await db.myWarehouse.update(existingItem.id!, {
           quantity: newTotalQty,
           price: priceToSave,
           receipts: newReceipts,
           note: transferItem.note || existingItem.note
         } as any);
         if (logs.length > 0) await db.myWarehouseChanges.bulkAdd(logs);
      });
      alert(`Новая партия добавлена к существующему товару!\nНовый общий остаток: ${newTotalQty} шт.`);
    } else {
      // НОВЫЙ ТОВАР: просто создаем с первой партией
      const itemToSave = {
        title: transferItem.title,
        category: transferItem.category || 'Без категории',
        price: priceToSave,
        quantity: quantityToSave,
        note: transferItem.note || '',
        receipts: [{ date: todayDate, quantity: quantityToSave, price: priceToSave }]
      } as MyStockItem;

      await db.myWarehouse.add(itemToSave);
      alert('Новый товар успешно добавлен на ваш склад!');
    }
    
    setTransferItem(null);
  };

  const getColOptions = () => {
    const opts = [<option key="empty" value="">Нет</option>];
    for (let i = 0; i < 26; i++) opts.push(<option key={i} value={String.fromCharCode(65 + i)}>Столбец {String.fromCharCode(65 + i)}</option>);
    return opts;
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Прайс-листы поставщиков</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск товара в прайсе..." />
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefreshAll} disabled={isRefreshingAll || suppliers.length === 0}>
            <RefreshCw size={16} className={isRefreshingAll ? "animate-spin text-blue-600" : "text-gray-500"} />
            {isRefreshingAll ? 'Идет обновление...' : 'Обновить все'}
          </Button>
          <Button onClick={() => openModal()}>
            <Plus size={16} /> Добавить прайс-лист
          </Button>
        </div>
      </Toolbar>

      {suppliers.length === 0 ? (
        <TableWrapper>
          <EmptyState icon={FileSpreadsheet} title="Нет прайс-листов" description="Добавьте ссылки на Google Таблицы поставщиков для отслеживания цен и остатков." />
        </TableWrapper>
      ) : (
        <div className="flex flex-col gap-4 flex-1 h-full overflow-hidden">
          <div className="flex flex-wrap gap-2">
            {suppliers.map(s => (
              <button key={s.id} onClick={() => setActiveSupplierId(s.id!)} className={`px-4 py-2 rounded-xl text-[14px] font-bold transition-all border shadow-sm ${activeSupplierId === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {s.title}
              </button>
            ))}
          </div>

          {activeSupplier && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex-1 flex flex-col overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{activeSupplier.title}</h2>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-[13px] text-gray-500 font-medium">Обновлено: {activeSupplier.lastSync || 'Никогда'}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleRefreshActive} disabled={isLoading || activeSupplier.sourceUrl === 'file'}>
                    <RefreshCw size={16} className={isLoading ? "animate-spin text-blue-600" : "text-blue-600"} /> 
                    {isLoading ? "Загрузка..." : "Обновить из Google"}
                  </Button>
                  <Button variant="outline" onClick={() => openModal(activeSupplier)}><Edit3 size={16} /></Button>
                  <Button variant="danger" onClick={() => handleDelete(activeSupplier.id!)}><Trash2 size={16} /></Button>
                </div>
              </div>

              {activeSupplier.sheets.filter(s => s.enabled).length > 1 && (
                <div className="flex flex-wrap gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center text-gray-400 mr-2"><Layers size={16} /></div>
                  {activeSupplier.sheets.filter(s => s.enabled).map(sheet => (
                    <button key={sheet.sheetName} onClick={() => setActiveSheetTab(sheet.sheetName)} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold transition-all ${activeSheetTab === sheet.sheetName ? 'bg-blue-100 text-blue-700 border border-blue-200 shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100 hover:text-gray-800'}`}>
                      {sheet.sheetName}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-auto flex-1">
                <table className="w-full min-w-[1150px] table-fixed text-left border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-white border-b border-gray-200 shadow-sm">
                      <th className="px-5 py-3 sticky left-0 bg-white z-30 shadow-[1px_0_0_0_#e5e7eb] w-[27%]">Наименование товара</th>
                      <th className="px-4 py-3 text-right border-r border-gray-100 w-[10%]">Опт</th>
                      <th className="px-4 py-3 text-right border-r border-gray-100 w-[10%]">РРЦ</th>
                      <th className="px-4 py-3 text-center border-r border-gray-100 w-[12%]">Остаток</th>
                      <th className="px-4 py-3 border-r border-gray-100 w-[20%]">Примечание</th>
                      <th className="px-4 py-3 border-r border-gray-100 text-center w-[10%]">Габариты</th>
                      <th className="px-4 py-3 text-center w-[6%]">Вес</th>
                      <th className="px-4 py-3 text-center w-[5%]">Склад</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeSupplier.cachedData?.filter((row: any) => {
                       if (activeSheetTab && row.sheetName !== activeSheetTab) return false;
                       if (searchQuery && row.kind === 'item') return row.title.toLowerCase().includes(searchQuery.toLowerCase());
                       return true;
                    }).map((row: any, idx: number) => {
                      if (row.kind === 'category') {
                        return (
                          <tr key={`cat-${idx}`} className="bg-indigo-50/50 border-b border-indigo-100/50">
                            <td colSpan={8} className="px-5 py-3 sticky left-0 font-bold text-indigo-900 text-[13px] uppercase tracking-wider shadow-[1px_0_0_0_#e0e7ff] truncate">
                              {row.title}
                            </td>
                          </tr>
                        );
                      }
                      
                      const stockInfo = parseStockBadge(row.stock);
                      
                      // Настройки стилей для новинок
                      const rowBg = row.isNew ? 'bg-green-50/60' : 'bg-white';
                      const stickyBg = row.isNew ? '#f0fdf4' : '#ffffff';
                      
                      return (
                        <tr key={`item-${idx}`} className={`hover:bg-gray-50 transition-colors group ${rowBg} ${stockInfo.isOutOfStock && !row.isNew ? 'opacity-50 grayscale-[20%]' : ''}`}>
                          <td className="px-5 py-3 sticky left-0 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal break-words z-10" style={{ backgroundColor: stickyBg }}>
                            <div className="flex flex-col">
                              {row.isNew && <span className="inline-block w-max px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-black uppercase tracking-widest rounded mb-1 border border-green-200">Новинка</span>}
                              <p className="text-[13px] font-bold text-[#1e3a5f] leading-snug line-clamp-3">{row.title}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800 border-r border-gray-100 truncate whitespace-nowrap">
                            {row.wholesale ? `${row.wholesale}` : '—'}
                            {row.trends && renderTrend(row.trends.wholesale, true)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800 border-r border-gray-100 truncate whitespace-nowrap">
                            {row.rrc ? `${row.rrc}` : '—'}
                            {row.trends && renderTrend(row.trends.rrc, true)}
                          </td>
                          <td className="px-4 py-3 text-center border-r border-gray-100 truncate whitespace-nowrap">
                            <span className={`inline-flex items-center justify-center px-2 py-1 border rounded-lg text-[12px] font-bold shadow-sm truncate max-w-full ${stockInfo.color}`}>
                              {stockInfo.text}
                            </span>
                            {row.trends && renderTrend(row.trends.stock, false)}
                          </td>
                          <td className="px-4 py-3 border-r border-gray-100 whitespace-normal break-words text-[12px] text-gray-600 leading-snug">
                            {row.note || '—'}
                          </td>
                          <td className="px-4 py-3 text-center border-r border-gray-100 whitespace-normal break-words text-[12px] text-gray-600 font-medium">
                            {row.dimensions || '—'}
                          </td>
                          <td className="px-4 py-3 text-center truncate text-[12px] text-gray-600 font-medium">
                            {row.weight || '—'}
                          </td>
                          
                          <td className="px-4 py-3 text-center align-middle">
                            <button 
                              onClick={() => openTransferModal(row)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                              title="Добавить на Мой Склад"
                            >
                              <Plus size={16} strokeWidth={3} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* МОДАЛКА ПЕРЕНОСА НА СКЛАД */}
      {transferItem && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-blue-50/80">
              <h3 className="text-[16px] font-bold text-blue-900 flex items-center gap-2">
                <PackageSearch size={18} /> Добавление на Мой склад
              </h3>
              <button onClick={() => setTransferItem(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Наименование</label>
                <input type="text" value={transferItem.title || ''} onChange={e => setTransferItem({...transferItem, title: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Категория</label>
                <input type="text" value={transferItem.category || ''} onChange={e => setTransferItem({...transferItem, category: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Опт (Цена, ₽)</label>
                  <input type="number" min="0" step="0.01" value={transferItem.price === 0 ? '' : transferItem.price} onChange={e => setTransferItem({...transferItem, price: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Добавить (ШТ)</label>
                  <input type="number" min="0" value={transferItem.quantity === 0 ? '' : transferItem.quantity} onChange={e => setTransferItem({...transferItem, quantity: parseInt(e.target.value, 10) || 0})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Примечание (Опционально)</label>
                <input type="text" value={transferItem.note || ''} onChange={e => setTransferItem({...transferItem, note: e.target.value})} className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-[14px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Дополнительная информация..." />
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setTransferItem(null)}>Отмена</Button>
              <Button onClick={handleSaveTransfer}><Save size={16} /> Добавить на склад</Button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА НАСТРОЙКИ */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[900px] overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-[#1e3a5f]">{editingId ? 'Редактировать прайс' : 'Новый прайс-лист'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-900 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12px] font-bold text-gray-600 uppercase mb-1">Название поставщика</label>
                  <input type="text" value={modalTitle} onChange={e => setModalTitle(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2.5 text-[14px] focus:ring-2 focus:ring-blue-500" placeholder="OPTUS.BY" />
                </div>
                <div className="col-span-2 flex gap-4 mt-2">
                  <button onClick={() => setSourceType('google')} className={`flex-1 p-3 border rounded-xl font-bold transition-all ${sourceType === 'google' ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>Google Таблицы (по ссылкам)</button>
                  <button onClick={() => setSourceType('file')} className={`flex-1 p-3 border rounded-xl font-bold transition-all ${sourceType === 'file' ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>Локальный Excel Файл</button>
                </div>
              </div>

              {sourceType === 'google' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <div>
                      <h4 className="font-bold text-gray-900 text-[14px]">Вкладки (Листы) поставщика</h4>
                      <p className="text-[13px] text-gray-500">Добавьте ссылки на каждую нужную вкладку (в ссылке должен быть параметр <b>gid=...</b>)</p>
                    </div>
                    <Button onClick={handleAddGoogleSheet}><Plus size={16}/> Добавить лист</Button>
                  </div>

                  {sheetMappings.map((mapping, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-white border border-blue-200 shadow-sm relative">
                      <button onClick={() => handleRemoveMapping(idx)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><Trash2 size={18}/></button>
                      
                      <div className="grid grid-cols-3 gap-4 mb-4 pr-10">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Название листа (для табов)</label>
                          <input type="text" value={mapping.sheetName} onChange={e => updateMapping(idx, 'sheetName', e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-[13px]" placeholder="Общий прайс" />
                        </div>
                        <div className="col-span-2 relative">
                          <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Прямая ссылка на вкладку (с gid=...)</label>
                          <input type="url" value={mapping.url || ''} onChange={e => updateMapping(idx, 'url', e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-[13px] pr-36" placeholder="https://docs.google.com/spreadsheets/...#gid=123" />
                          <button onClick={() => handleAutoDetectGoogle(idx)} disabled={isLoading} className="absolute bottom-1 right-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md text-[11px] font-bold flex items-center gap-1 hover:bg-blue-100 transition-colors cursor-pointer">
                            <Wand2 size={12}/> Определить колонки
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-7 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Наименование *</label><select value={mapping.colName} onChange={e => updateMapping(idx, 'colName', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Опт</label><select value={mapping.colWholesale} onChange={e => updateMapping(idx, 'colWholesale', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">РРЦ</label><select value={mapping.colRrc} onChange={e => updateMapping(idx, 'colRrc', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Остаток</label><select value={mapping.colStock} onChange={e => updateMapping(idx, 'colStock', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Примечание</label><select value={mapping.colNote || ''} onChange={e => updateMapping(idx, 'colNote', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div className="col-span-1"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Габариты</label><select value={mapping.colDimensions || ''} onChange={e => updateMapping(idx, 'colDimensions', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                        <div className="col-span-1"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Вес</label><select value={mapping.colWeight || ''} onChange={e => updateMapping(idx, 'colWeight', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sourceType === 'file' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input type="file" accept=".xlsx, .xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Выбрать Excel файл</Button>
                    {modalFile && <span className="py-2 text-[13px] font-bold text-green-600">Загружен: {modalFile.name}</span>}
                  </div>
                  
                  {sheetMappings.length > 0 && (
                    <div className="space-y-4">
                      {sheetMappings.map((mapping, idx) => (
                        <div key={idx} className={`p-4 rounded-xl border transition-colors ${mapping.enabled ? 'bg-white border-blue-300 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                          <div className="flex items-center gap-3 mb-4">
                            <input type="checkbox" checked={mapping.enabled} onChange={e => updateMapping(idx, 'enabled', e.target.checked)} className="w-5 h-5 accent-blue-600 cursor-pointer" />
                            <span className="font-bold text-[15px] cursor-pointer" onClick={() => updateMapping(idx, 'enabled', !mapping.enabled)}>{mapping.sheetName}</span>
                          </div>
                          
                          {mapping.enabled && (
                            <div className="grid grid-cols-7 gap-3 mt-2">
                              <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Наименование *</label><select value={mapping.colName} onChange={e => updateMapping(idx, 'colName', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Опт</label><select value={mapping.colWholesale} onChange={e => updateMapping(idx, 'colWholesale', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">РРЦ</label><select value={mapping.colRrc} onChange={e => updateMapping(idx, 'colRrc', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Остаток</label><select value={mapping.colStock} onChange={e => updateMapping(idx, 'colStock', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Примечание</label><select value={mapping.colNote || ''} onChange={e => updateMapping(idx, 'colNote', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div className="col-span-1"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Габариты</label><select value={mapping.colDimensions || ''} onChange={e => updateMapping(idx, 'colDimensions', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                              <div className="col-span-1"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Вес</label><select value={mapping.colWeight || ''} onChange={e => updateMapping(idx, 'colWeight', e.target.value)} className="w-full border border-gray-300 p-1.5 rounded text-[12px] bg-white">{getColOptions()}</select></div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Отмена</Button>
              <Button onClick={handleSave} disabled={isLoading}><Save size={16} /> {isLoading ? 'Обработка...' : 'Сохранить прайс-лист'}</Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}