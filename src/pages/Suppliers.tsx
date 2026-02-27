import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Edit3, Trash2, Truck, X, Save, RefreshCw, Link as LinkIcon, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, Supplier, SupplierSheetMapping } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

// =================================================================
// 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ПОРТИРОВАНЫ ИЗ ПИТОНА И JS SUKULAD)
// =================================================================

// Превращает обычную ссылку Google Sheets в прямую ссылку на скачивание Excel
function resolveGoogleSheetUrl(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && url.includes('docs.google.com')) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
  }
  return url;
}

// Умный парсинг остатков с выдачей цвета бейджа
function parseStockBadge(val: any): { text: string, color: string, isOutOfStock: boolean } {
  if (val === null || val === undefined || String(val).trim() === '') {
    return { text: '—', color: 'bg-gray-100 text-gray-700 border-gray-200', isOutOfStock: true };
  }
  const rawStr = String(val).trim();
  const lower = rawStr.toLowerCase();
  const numericVal = parseFloat(rawStr.replace(/,/g, '.').replace(/\s/g, ''));

  let color = 'bg-gray-100 text-gray-700 border-gray-200';
  let text = rawStr;
  let isOutOfStock = false;

  if (/^[\-\u2010\u2012\u2013\u2014\u2212]+$/.test(rawStr)) {
    color = 'bg-red-50 text-red-700 border-red-200'; text = '-'; isOutOfStock = true;
  } else if (/^\++$/.test(rawStr)) {
    color = 'bg-green-50 text-green-700 border-green-200'; text = rawStr;
  } else if (!isNaN(numericVal)) {
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

export default function Suppliers() {
  const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
  const [activeSupplierId, setActiveSupplierId] = useState<number | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Модалка настройки
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalUrl, setModalUrl] = useState('');
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [previewWorkbook, setPreviewWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetMappings, setSheetMappings] = useState<SupplierSheetMapping[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSupplier = useMemo(() => suppliers.find(s => s.id === activeSupplierId), [suppliers, activeSupplierId]);

  // Установка первого активного поставщика при загрузке
  useEffect(() => {
    if (suppliers.length > 0 && !activeSupplierId) setActiveSupplierId(suppliers[0].id!);
  }, [suppliers, activeSupplierId]);

  // =================================================================
  // 2. ЛОГИКА ЗАГРУЗКИ ПРЕДПРОСМОТРА EXCEL
  // =================================================================
  const handlePreview = async () => {
    if (!modalUrl && !modalFile) return alert('Укажите ссылку на Google Таблицу/Сайт или загрузите файл.');
    setIsLoading(true);
    
    try {
      let data: ArrayBuffer;
      
      if (modalFile) {
        data = await modalFile.arrayBuffer();
      } else {
        const targetUrl = resolveGoogleSheetUrl(modalUrl);
        // Используем proxy для обхода CORS
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Не удалось скачать файл. Проверьте ссылку (должна быть открыта для всех).');
        data = await res.arrayBuffer();
      }

      const workbook = XLSX.read(data, { type: 'array' });
      setPreviewWorkbook(workbook);

      // Инициализируем маппинги по умолчанию (все листы выключены, кроме первого)
      const initialMappings: SupplierSheetMapping[] = workbook.SheetNames.map((name, i) => ({
        sheetName: name,
        enabled: i === 0,
        colName: '', colWholesale: '', colRrc: '', colStock: ''
      }));
      setSheetMappings(initialMappings);

    } catch (e: any) {
      alert(`Ошибка чтения: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const updateMapping = (idx: number, field: keyof SupplierSheetMapping, value: any) => {
    const newMappings = [...sheetMappings];
    newMappings[idx] = { ...newMappings[idx], [field]: value };
    setSheetMappings(newMappings);
  };

  // =================================================================
  // 3. ПАРСИНГ ТАБЛИЦЫ (ПО СТОЛБЦАМ И КАТЕГОРИЯМ)
  // =================================================================
  const parseWorkbookData = (wb: XLSX.WorkBook, mappings: SupplierSheetMapping[]) => {
    const parsedRows: any[] = [];
    
    mappings.forEach(map => {
      if (!map.enabled || !map.colName) return;
      const sheet = wb.Sheets[map.sheetName];
      if (!sheet) return;

      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
      let currentCategory = '';

      for (let R = range.s.r; R <= range.e.r; ++R) {
        const getCell = (colLetter: string) => {
          if (!colLetter) return '';
          const colIndex = XLSX.utils.decode_col(colLetter.toUpperCase());
          const cell = sheet[XLSX.utils.encode_cell({ c: colIndex, r: R })];
          return cell ? String(cell.v).trim() : '';
        };

        const name = getCell(map.colName);
        const wholesale = getCell(map.colWholesale);
        const rrc = getCell(map.colRrc);
        const stock = getCell(map.colStock);

        if (!name) continue;

        // Логика Sukulad: Если есть только имя, нет цен, а в остатках пусто ИЛИ стоит символ буллита (•, *, .) -> Это категория
        const isStockEmptyOrBullet = !stock || /^[\.\•\*\▪]+$/.test(stock);
        const isCategory = name && !wholesale && !rrc && isStockEmptyOrBullet;

        if (isCategory) {
          currentCategory = name;
          parsedRows.push({ kind: 'category', title: name });
        } else if (wholesale || rrc || stock) {
          parsedRows.push({
            kind: 'item',
            category: currentCategory,
            title: name,
            wholesale: wholesale,
            rrc: rrc,
            stock: stock
          });
        }
      }
    });

    return parsedRows;
  };

  // =================================================================
  // СОХРАНЕНИЕ ПОСТАВЩИКА
  // =================================================================
  const handleSave = async () => {
    if (!modalTitle) return alert('Введите название');
    if (!previewWorkbook) return alert('Сначала загрузите и настройте колонки таблицы.');

    const activeMappings = sheetMappings.filter(m => m.enabled);
    if (activeMappings.some(m => !m.colName)) return alert('Укажите колонку "Наименование" для всех включенных листов.');

    // Парсим данные прямо сейчас, чтобы сохранить их в кэш поставщика
    const parsedData = parseWorkbookData(previewWorkbook, activeMappings);

    const supplier: Supplier = {
      title: modalTitle,
      sourceUrl: modalUrl,
      sheets: activeMappings,
      cachedData: parsedData,
      lastSync: new Date().toLocaleString('ru-RU')
    };

    if (editingId) {
      await db.suppliers.update(editingId, supplier);
    } else {
      const newId = await db.suppliers.add(supplier);
      setActiveSupplierId(newId as number);
    }
    setIsModalOpen(false);
  };

  const openModal = (supplier?: Supplier) => {
    setEditingId(supplier?.id || null);
    setModalTitle(supplier?.title || '');
    setModalUrl(supplier?.sourceUrl || '');
    setModalFile(null);
    setPreviewWorkbook(null);
    setSheetMappings(supplier?.sheets || []);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Точно удалить прайс-лист?')) {
      await db.suppliers.delete(id);
      if (activeSupplierId === id) setActiveSupplierId(suppliers[0]?.id || null);
    }
  };

  // =================================================================
  // ОБНОВЛЕНИЕ АКТИВНОГО ПРАЙС-ЛИСТА
  // =================================================================
  const handleRefreshActive = async () => {
    if (!activeSupplier) return;
    setIsLoading(true);
    try {
      const targetUrl = resolveGoogleSheetUrl(activeSupplier.sourceUrl);
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('Не удалось скачать файл.');
      
      const data = await res.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const parsedData = parseWorkbookData(workbook, activeSupplier.sheets);

      await db.suppliers.update(activeSupplier.id!, {
        cachedData: parsedData,
        lastSync: new Date().toLocaleString('ru-RU')
      });
      alert('Прайс-лист успешно обновлен!');
    } catch (e: any) {
      alert(`Ошибка обновления: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Отрисовка колонок (A-Z) для селектов
  const getColOptions = () => {
    const opts = [<option key="empty" value="">Не выбрано</option>];
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      opts.push(<option key={letter} value={letter}>Столбец {letter}</option>);
    }
    return opts;
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Прайс-листы поставщиков</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск товара в прайсе..." />
        </div>
        <Button onClick={() => openModal()}>
          <Plus size={16} /> Добавить прайс-лист
        </Button>
      </Toolbar>

      {suppliers.length === 0 ? (
        <TableWrapper>
          <EmptyState icon={FileSpreadsheet} title="Нет прайс-листов" description="Добавьте ссылку на Google Таблицу поставщика для отслеживания цен и остатков." />
        </TableWrapper>
      ) : (
        <div className="flex flex-col gap-4 flex-1 h-full overflow-hidden">
          {/* ВКЛАДКИ ПОСТАВЩИКОВ */}
          <div className="flex flex-wrap gap-2">
            {suppliers.map(s => (
              <button 
                key={s.id} onClick={() => setActiveSupplierId(s.id!)}
                className={`px-4 py-2 rounded-xl text-[14px] font-bold transition-all border shadow-sm ${activeSupplierId === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {s.title}
              </button>
            ))}
          </div>

          {/* АКТИВНЫЙ ПОСТАВЩИК */}
          {activeSupplier && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex-1 flex flex-col overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{activeSupplier.title}</h2>
                  <div className="flex items-center gap-4 mt-2">
                    <a href={activeSupplier.sourceUrl} target="_blank" className="text-[13px] font-medium text-blue-600 hover:underline flex items-center gap-1"><LinkIcon size={14}/> Источник</a>
                    <span className="text-[13px] text-gray-500 font-medium">Обновлено: {activeSupplier.lastSync || 'Никогда'}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleRefreshActive} disabled={isLoading}>
                    <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} /> Обновить
                  </Button>
                  <Button variant="outline" onClick={() => openModal(activeSupplier)}><Edit3 size={16} /></Button>
                  <Button variant="danger" onClick={() => handleDelete(activeSupplier.id!)}><Trash2 size={16} /></Button>
                </div>
              </div>

              <div className="overflow-auto flex-1">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead className="sticky top-0 z-20">
                    <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-white border-b border-gray-200 shadow-sm">
                      <th className="px-5 py-3 sticky left-0 bg-white z-30 shadow-[1px_0_0_0_#e5e7eb]">Наименование товара</th>
                      <th className="px-5 py-3 text-right border-r border-gray-100 w-32">Опт (₽)</th>
                      <th className="px-5 py-3 text-right border-r border-gray-100 w-32">РРЦ (₽)</th>
                      <th className="px-5 py-3 text-center w-32">Остаток</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeSupplier.cachedData?.filter((row: any) => {
                       if (searchQuery && row.kind === 'item') return row.title.toLowerCase().includes(searchQuery.toLowerCase());
                       return true;
                    }).map((row: any, idx: number) => {
                      
                      // ОТРИСОВКА КАТЕГОРИИ
                      if (row.kind === 'category') {
                        return (
                          <tr key={`cat-${idx}`} className="bg-indigo-50/50 border-b border-indigo-100/50">
                            <td colSpan={4} className="px-5 py-3 sticky left-0 font-bold text-indigo-900 text-[13px] uppercase tracking-wider shadow-[1px_0_0_0_#e0e7ff]">
                              {row.title}
                            </td>
                          </tr>
                        );
                      }

                      // ОТРИСОВКА ТОВАРА
                      const stockInfo = parseStockBadge(row.stock);
                      
                      return (
                        <tr key={`item-${idx}`} className={`hover:bg-gray-50 transition-colors bg-white ${stockInfo.isOutOfStock ? 'opacity-50 grayscale-[20%]' : ''}`}>
                          <td className="px-5 py-3 sticky left-0 bg-white shadow-[1px_0_0_0_#f3f4f6] whitespace-normal min-w-[300px]">
                            <p className="text-[14px] font-bold text-[#1e3a5f] leading-snug">{row.title}</p>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-gray-800 border-r border-gray-100">{row.wholesale || '—'}</td>
                          <td className="px-5 py-3 text-right font-bold text-gray-800 border-r border-gray-100">{row.rrc || '—'}</td>
                          <td className="px-5 py-3 text-center">
                            <span className={`inline-flex items-center justify-center px-3 py-1 border rounded-lg text-[13px] font-bold shadow-sm ${stockInfo.color}`}>
                              {stockInfo.text}
                            </span>
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

      {/* ==================== МОДАЛКА ДОБАВЛЕНИЯ/МАППИНГА ==================== */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-[#1e3a5f]">{editingId ? 'Редактировать прайс' : 'Новый прайс-лист'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-900 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* Шаг 1. Источник */}
              <div className="space-y-4 bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                <h4 className="font-bold text-blue-900 text-[14px]">1. Источник данных</h4>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-[12px] font-bold text-gray-600 uppercase mb-1">Название поставщика</label>
                  <input type="text" value={modalTitle} onChange={e => setModalTitle(e.target.value)} className="col-span-2 w-full border border-gray-300 rounded-lg p-2.5 text-[14px] focus:ring-2 focus:ring-blue-500" placeholder="ООО Сима-Ленд" />
                  
                  <div className="col-span-2 space-y-2">
                    <label className="block text-[12px] font-bold text-gray-600 uppercase mb-1">Ссылка на Google Sheets</label>
                    <div className="flex gap-2">
                      <input type="url" value={modalUrl} onChange={e => {setModalUrl(e.target.value); setModalFile(null)}} className="flex-1 border border-gray-300 rounded-lg p-2.5 text-[14px] focus:ring-2 focus:ring-blue-500" placeholder="https://docs.google.com/spreadsheets/d/..." />
                      <input type="file" accept=".xlsx, .xls" ref={fileInputRef} onChange={e => { setModalFile(e.target.files?.[0] || null); setModalUrl(''); }} className="hidden" />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Или файл</Button>
                    </div>
                    {modalFile && <p className="text-[12px] text-green-600 font-bold">Выбран файл: {modalFile.name}</p>}
                  </div>

                  <div className="col-span-2 mt-2">
                    <Button onClick={handlePreview} disabled={isLoading} className="w-full justify-center">
                      {isLoading ? 'Загрузка структуры...' : 'Получить структуру колонок'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Шаг 2. Маппинг колонок */}
              {previewWorkbook && (
                <div className="space-y-4">
                  <h4 className="font-bold text-gray-900 text-[14px]">2. Настройка колонок (A, B, C...)</h4>
                  <p className="text-[13px] text-gray-500">Укажите, в каких столбцах находятся нужные данные.</p>
                  
                  {sheetMappings.map((mapping, idx) => (
                    <div key={idx} className={`p-4 rounded-xl border transition-colors ${mapping.enabled ? 'bg-white border-blue-300 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <input type="checkbox" checked={mapping.enabled} onChange={e => updateMapping(idx, 'enabled', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                        <span className="font-bold text-[15px]">{mapping.sheetName}</span>
                      </div>
                      
                      {mapping.enabled && (
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Наименование <span className="text-red-500">*</span></label>
                            <select value={mapping.colName} onChange={e => updateMapping(idx, 'colName', e.target.value)} className="w-full border border-gray-300 p-2 rounded-lg text-[13px]">
                              {getColOptions()}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Опт (Цена)</label>
                            <select value={mapping.colWholesale} onChange={e => updateMapping(idx, 'colWholesale', e.target.value)} className="w-full border border-gray-300 p-2 rounded-lg text-[13px]">
                              {getColOptions()}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">РРЦ</label>
                            <select value={mapping.colRrc} onChange={e => updateMapping(idx, 'colRrc', e.target.value)} className="w-full border border-gray-300 p-2 rounded-lg text-[13px]">
                              {getColOptions()}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Остаток</label>
                            <select value={mapping.colStock} onChange={e => updateMapping(idx, 'colStock', e.target.value)} className="w-full border border-gray-300 p-2 rounded-lg text-[13px]">
                              {getColOptions()}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Отмена</Button>
              <Button onClick={handleSave}><Save size={16} /> Сохранить прайс-лист</Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}