import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Edit3, X, Save, Plus, Trash2, PackageSearch, Copy, Check, FileUp, Link as LinkIcon, Unlink, Box } from 'lucide-react';
import { db, FbsStockItem } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

interface PricePeriod { id?: number; price: number | ''; startDate: string; endDate: string; }

export default function Products() {
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  
  const location = useLocation();
  const navigate = useNavigate();

  const savedProducts = useLiveQuery(() => db.fbsStocks.toArray()) || [];
  const savedPrices = useLiveQuery(() => db.prices.toArray()) || [];
  const myWarehouse = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const wbLinks = useLiveQuery(() => db.wbLinks.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);
  
  const [editingProduct, setEditingProduct] = useState<FbsStockItem | null>(null);
  const [modalPrices, setModalPrices] = useState<PricePeriod[]>([]);

  const [linkingNmId, setLinkingNmId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState('');

  const handleLink = async (myStockItemId: number) => {
    if (!linkingNmId) return;
    await db.wbLinks.put({ nmId: linkingNmId, myStockItemId });
    setLinkingNmId(null); setLinkSearch('');
  };

  const handleUnlink = async (nmId: number) => {
    if (window.confirm('Отвязать этот товар от "Моего склада"?')) await db.wbLinks.where('nmId').equals(nmId).delete();
  };

  const searchFilteredMyWarehouse = useMemo(() => {
    if (!linkSearch) return myWarehouse;
    const q = linkSearch.toLowerCase();
    return myWarehouse.filter(m => m.title.toLowerCase().includes(q) || (m.category && m.category.toLowerCase().includes(q)));
  }, [myWarehouse, linkSearch]);

  const processedProducts = useMemo(() => {
    let result = [...savedProducts];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        String(p.nmId).includes(q) || 
        p.vendorCode.toLowerCase().includes(q) || 
        p.title.toLowerCase().includes(q) ||
        (p.color && p.color.toLowerCase().includes(q)) ||
        (p.techSize && p.techSize.toLowerCase().includes(q)) ||
        p.barcodes.some(b => b.includes(q))
      );
    }

    const productsWithPrices = result.map(product => {
      const productPrices = savedPrices.filter(price => price.nmId === product.nmId);
      const lastUpdated = Math.max(...productPrices.map(p => p.updatedAt || p.id || 0), 0);
      
      return {
        ...product,
        prices: productPrices.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
        lastUpdated
      };
    });

    productsWithPrices.sort((a, b) => {
       if (b.lastUpdated !== a.lastUpdated) return b.lastUpdated - a.lastUpdated;
       const cmp = a.vendorCode.localeCompare(b.vendorCode);
       if (cmp !== 0) return cmp;
       return (a.techSize || '').localeCompare(b.techSize || '', undefined, { numeric: true });
    });

    return productsWithPrices;
  }, [savedProducts, savedPrices, searchQuery]);

  useEffect(() => {
    if (location.state?.openEditModalNmId && processedProducts.length > 0) {
      const targetProduct = processedProducts.find(p => p.nmId === location.state.openEditModalNmId);
      if (targetProduct) { openEditModal(targetProduct); navigate(location.pathname, { replace: true, state: {} }); }
    }
  }, [location.state, processedProducts, navigate]);

  const handleSyncProducts = async () => {
    const tokenContent = import.meta.env.VITE_WB_API_KEY_CONTENT;
    const tokenMarketplace = import.meta.env.VITE_WB_API_KEY_MARKETPLACE;
    if (!tokenContent || !tokenMarketplace) return alert('ОШИБКА: Убедитесь, что в .env добавлены токены CONTENT и MARKETPLACE!');

    setIsLoading(true);
    try {
      setSyncStatus('Загрузка каталога...');
      let hasMore = true; let updatedAt: string | undefined = undefined; let nmID: number | undefined = undefined;
      const itemGroupMap = new Map<string, FbsStockItem>(); const barcodeToGroupId = new Map<string, string>(); const allSkus: string[] = [];

      while (hasMore) {
        const payload: any = { settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } } };
        if (updatedAt && nmID) { payload.settings.cursor.updatedAt = updatedAt; payload.settings.cursor.nmID = nmID; }

        const res = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', { method: 'POST', headers: { 'Authorization': tokenContent, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Ошибка загрузки каталога.`);
        const data = await res.json();
        
        for (const card of data.cards || []) {
          let photoUrl = '';
          if (card.photos && card.photos.length > 0) { const p = card.photos[0]; photoUrl = p['516x688'] || p.big || p.c516x688 || p.url || (typeof p === 'string' ? p : ''); }
          let colorStr = '';
          if (card.characteristics) {
            const colorObj = card.characteristics.find((c: any) => c.name?.toLowerCase() === 'цвет' || c.name?.toLowerCase() === 'основной цвет');
            if (colorObj) colorStr = Array.isArray(colorObj.value) ? colorObj.value.join(', ') : String(colorObj.value || '');
          }

          for (const size of card.sizes || []) {
            const sizeName = size.techSize || ''; const groupId = `${card.nmID}_${sizeName}`;
            if (!itemGroupMap.has(groupId)) {
              itemGroupMap.set(groupId, { id: groupId, nmId: card.nmID, vendorCode: card.vendorCode, title: card.title, techSize: sizeName, color: colorStr, barcodes: [], photo: photoUrl, stocks: {}, totalAmount: 0 });
            }
            const group = itemGroupMap.get(groupId)!;
            for (const barcode of size.skus || []) {
              allSkus.push(barcode); if (!group.barcodes.includes(barcode)) group.barcodes.push(barcode);
              barcodeToGroupId.set(barcode, groupId); 
            }
          }
        }
        if (data.cursor && data.cursor.updatedAt && data.cursor.nmID && (data.cards || []).length === 100) { updatedAt = data.cursor.updatedAt; nmID = data.cursor.nmID; } else { hasMore = false; }
      }

      setSyncStatus('Загрузка остатков...');
      const whRes = await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses', { headers: { 'Authorization': tokenMarketplace } });
      const parsedWarehouses = whRes.ok ? await whRes.json() : [];
      const chunkArray = (arr: string[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
      const skuChunks = chunkArray(allSkus, 1000);

      for (const wh of parsedWarehouses) {
        for (const chunk of skuChunks) {
          const stockRes = await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${wh.id}`, { method: 'POST', headers: { 'Authorization': tokenMarketplace, 'Content-Type': 'application/json' }, body: JSON.stringify({ skus: chunk }) });
          if (stockRes.ok) {
            const stockData = await stockRes.json();
            for (const stock of stockData.stocks || []) {
              const groupId = barcodeToGroupId.get(stock.sku);
              if (groupId) {
                const groupItem = itemGroupMap.get(groupId)!;
                groupItem.stocks[wh.id] = (groupItem.stocks[wh.id] || 0) + stock.amount; groupItem.totalAmount += stock.amount;
              }
            }
          }
        }
      }

      const finalStocksData = Array.from(itemGroupMap.values());
      await db.transaction('rw', db.fbsWarehouses, db.fbsStocks, db.fbsStatusHistory, async () => {
        await db.fbsWarehouses.clear(); await db.fbsWarehouses.bulkAdd(parsedWarehouses);
        const oldHistory = await db.fbsStatusHistory.toArray(); const historyMap = new Map(oldHistory.map(h => [h.id, h])); const newHistoryItems: any[] = []; const now = Date.now();
        finalStocksData.forEach(item => {
          let currentStatus = 'ok'; if (item.totalAmount === 0) currentStatus = 'empty'; else if (item.totalAmount <= 5) currentStatus = 'low';
          const prev = historyMap.get(item.id); if (!prev || prev.status !== currentStatus) newHistoryItems.push({ id: item.id, status: currentStatus, since: now });
        });
        if (newHistoryItems.length > 0) await db.fbsStatusHistory.bulkPut(newHistoryItems);
        await db.fbsStocks.clear(); await db.fbsStocks.bulkAdd(finalStocksData);
      });
      
      const nowStr = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      localStorage.setItem('wb_fbs_last_updated', nowStr); setSyncStatus('');
    } catch (err: any) { alert(err.message); setSyncStatus(''); } finally { setIsLoading(false); }
  };

  const openEditModal = (product: any) => {
    setEditingProduct(product);
    if (product.prices && product.prices.length > 0) setModalPrices(product.prices.map((p: any) => ({ ...p })));
    else setModalPrices([{ price: '', startDate: '', endDate: '' }]);
  };

  const handleAddPricePeriod = () => setModalPrices([...modalPrices, { price: '', startDate: '', endDate: '' }]);
  const handleRemovePricePeriod = (index: number) => { const newPrices = [...modalPrices]; newPrices.splice(index, 1); setModalPrices(newPrices); };
  const handlePriceChange = (index: number, field: keyof PricePeriod, value: string) => { const newPrices = [...modalPrices]; newPrices[index] = { ...newPrices[index], [field]: value }; setModalPrices(newPrices); };

  const handleSavePrices = async () => {
    if (!editingProduct) return;
    const validPrices = modalPrices.filter(p => p.price !== '' && Number(p.price) > 0);
    await db.prices.where('nmId').equals(editingProduct.nmId).delete();
    if (validPrices.length > 0) {
      const now = Date.now();
      const toInsert = validPrices.map(p => ({ name: editingProduct.title, nmId: editingProduct.nmId, price: Number(p.price), startDate: p.startDate, endDate: p.endDate, updatedAt: now }));
      await db.prices.bulkAdd(toInsert as any);
    }
    setEditingProduct(null);
  };

  const handleCopy = (text: string) => { navigator.clipboard.writeText(text); setCopiedBarcode(text); setTimeout(() => setCopiedBarcode(null), 2000); };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Остатки и Цены (FBS)</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск по названию или артикулу..." />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate('/import')}><FileUp size={16} className="text-gray-500" />Загрузить цены</Button>
          <Button onClick={handleSyncProducts} disabled={isLoading}><RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />{isLoading ? syncStatus || "Загрузка..." : "Обновить данные WB"}</Button>
        </div>
      </Toolbar>

      <TableWrapper>
        {processedProducts.length === 0 && !isLoading ? (
          <EmptyState icon={PackageSearch} title="Товары не найдены" description="Измените запрос или нажмите «Обновить данные WB»" />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 sticky left-0 bg-gray-50 z-30 shadow-[1px_0_0_0_#e5e7eb]">Товар (Фото и Артикул)</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 w-32">Баркоды</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 text-center w-24">Остаток WB</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 w-40 text-center">Связь с Моим складом</th>
                  <th className="px-4 py-2.5 text-right w-[280px]">Себестоимость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedProducts.map((product) => {
                  const link = wbLinks.find(l => l.nmId === product.nmId);
                  const linkedMyItem = link ? myWarehouse.find(m => m.id === link.myStockItemId) : null;
                  const latestReceipt = linkedMyItem?.receipts && linkedMyItem.receipts.length > 0 ? linkedMyItem.receipts[linkedMyItem.receipts.length - 1] : null;

                  return (
                    <tr key={product.id} className="hover:bg-gray-50/80 transition-colors bg-white group">
                      <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal min-w-[320px] max-w-[420px]">
                        <div className="flex items-center gap-3">
                          {product.photo ? <img src={product.photo} alt="img" className="w-[44px] h-[58px] object-cover rounded shadow-sm border border-gray-200 flex-shrink-0" /> : <div className="w-[44px] h-[58px] bg-gray-50 rounded flex items-center justify-center text-[9px] text-gray-400 font-medium flex-shrink-0 border border-gray-100">Нет</div>}
                          <div className="flex flex-col justify-center">
                            <h3 className="text-[13px] font-bold text-[#1e3a5f] leading-tight line-clamp-2">{product.title}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <span className="text-[12px] text-gray-500 font-medium">Арт: {product.vendorCode}</span>
                              {product.color && <span className="bg-[#8ba5ca]/15 text-[#5a769a] px-1.5 py-0.5 rounded text-[10px] font-bold border border-[#8ba5ca]/20">{product.color}</span>}
                              {product.techSize && product.techSize !== '0' && <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-gray-200">Разм: {product.techSize}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 border-r border-gray-100 align-middle">
                        <div className="flex flex-col gap-1.5 w-max">
                          {product.barcodes.map((b: string) => (
                            <div key={b} onClick={() => handleCopy(b)} className="flex items-center gap-2 group/copy cursor-pointer">
                              <span className="text-[13px] font-medium text-[#1e3a5f] tracking-wide">{b}</span>
                              {copiedBarcode === b ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-300 group-hover/copy:text-blue-500 transition-colors" />}
                            </div>
                          ))}
                        </div>
                      </td>

                      <td className="px-4 py-3 border-r border-gray-100 text-center align-middle">
                         <div className="inline-flex items-center justify-center min-w-[36px] h-[28px] px-2 bg-gray-50 border border-gray-200 rounded-md text-[13px] font-bold text-gray-800 shadow-sm">{product.totalAmount}</div>
                      </td>

                      <td className="px-4 py-3 border-r border-gray-100 align-middle bg-indigo-50/10">
                        {linkedMyItem ? (
                          <div className="flex flex-col items-center justify-center gap-1">
                            <div className="flex items-center gap-1.5" title={linkedMyItem.title}>
                              <Box size={12} className="text-indigo-400" />
                              <span className={`text-[14px] font-bold ${linkedMyItem.quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>Остаток: {linkedMyItem.quantity} шт</span>
                            </div>
                            <button onClick={() => handleUnlink(product.nmId)} className="text-[10px] font-bold text-indigo-300 hover:text-red-500 transition-colors" title="Отвязать товар от склада">Отвязать</button>
                          </div>
                        ) : (
                          <div className="flex justify-center">
                            <button onClick={() => setLinkingNmId(product.nmId)} className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded transition-all opacity-60 group-hover:opacity-100">
                              <LinkIcon size={12} /> Привязать к складу
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right align-middle">
                        <div className="flex items-center justify-end gap-3">
                          {linkedMyItem ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1"><LinkIcon size={8} /> Синхронизировано со складом (FIFO)</span>
                              {latestReceipt ? (
                                <div className="flex items-end gap-2">
                                  <span className="text-[10px] text-gray-400">партия от {new Date(latestReceipt.date).toLocaleDateString('ru-RU')}</span>
                                  <span className="text-[14px] font-bold text-[#1e3a5f] bg-indigo-50/50 border border-indigo-100 px-2 py-0.5 rounded shadow-sm text-center">{latestReceipt.price} ₽</span>
                                </div>
                              ) : (
                                <span className="text-[14px] font-bold text-[#1e3a5f] bg-indigo-50/50 border border-indigo-100 px-2 py-0.5 rounded shadow-sm text-center">{linkedMyItem.price} ₽</span>
                              )}
                            </div>
                          ) : (
                            <>
                              {product.prices.length > 0 ? (
                                <div className="flex flex-col gap-1.5 items-end">
                                  {product.prices.map((p: any, idx: number) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span className="text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                                        {p.startDate ? new Date(p.startDate).toLocaleDateString('ru-RU') : '...'} — {p.endDate ? new Date(p.endDate).toLocaleDateString('ru-RU') : '∞'}
                                      </span>
                                      <span className="text-[13px] font-bold text-[#1e3a5f] bg-blue-50/50 border border-blue-100 px-2 py-0.5 rounded shadow-sm w-[70px] text-center">{p.price} ₽</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[12px] text-gray-400 italic mr-2">Не указана</span>
                              )}
                              <Button variant="outline" onClick={() => openEditModal(product)} className="!p-2 ml-2"><Edit3 size={16} /></Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>

      {linkingNmId && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col h-[70vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50/80">
              <div>
                <h3 className="text-[16px] font-bold text-indigo-900 flex items-center gap-2"><LinkIcon size={18} className="text-indigo-600" /> Связь с Моим складом</h3>
                <p className="text-[12px] text-indigo-600/70 mt-1">Выберите товар из вашей базы для привязки</p>
              </div>
              <button onClick={() => {setLinkingNmId(null); setLinkSearch('');}} className="p-1.5 text-indigo-400 hover:text-indigo-700 hover:bg-white rounded-lg transition-colors shadow-sm border border-transparent hover:border-indigo-200"><X size={20} /></button>
            </div>
            <div className="p-4 border-b border-gray-100 bg-white">
               <SearchInput value={linkSearch} onChange={setLinkSearch} placeholder="Поиск по Моему складу..." />
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1 bg-gray-50/50">
              {searchFilteredMyWarehouse.length === 0 ? (
                <div className="text-center p-8 text-gray-400 text-[13px]"><Box size={32} className="mx-auto mb-2 opacity-50" />Товары не найдены. <br/>Сначала добавьте их в разделе "Мой Склад".</div>
              ) : (
                searchFilteredMyWarehouse.map(mItem => (
                  <div key={mItem.id} onClick={() => handleLink(mItem.id!)} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 transition-all shadow-sm">
                    <div className="flex flex-col pr-4">
                      <span className="text-[13px] font-bold text-gray-800 leading-snug">{mItem.title}</span>
                      <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded mt-1.5 inline-block w-max">{mItem.category || 'Без категории'}</span>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                      <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Остаток</span>
                      <span className={`text-[14px] font-black ${mItem.quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>{mItem.quantity} шт</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
              <h3 className="text-[16px] font-bold text-[#1e3a5f]">Управление себестоимостью</h3>
              <button onClick={() => setEditingProduct(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center gap-4 mb-6 bg-blue-50/30 p-3 rounded-xl border border-blue-100">
                {editingProduct.photo && <img src={editingProduct.photo} alt="img" className="w-[40px] h-[54px] object-cover rounded shadow-sm border border-gray-200" />}
                <div className="flex flex-col">
                  <p className="font-bold text-[14px] text-[#1e3a5f] line-clamp-2">{editingProduct.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] text-gray-500 font-medium">Арт: {editingProduct.vendorCode}</span>
                    {editingProduct.color && <span className="text-[10px] text-gray-400">• {editingProduct.color}</span>}
                    {editingProduct.techSize && editingProduct.techSize !== '0' && <span className="text-[10px] text-gray-400">• Разм: {editingProduct.techSize}</span>}
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-end mb-2">
                  <h4 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider">Периоды цен</h4>
                  <span className="text-[11px] text-gray-400">Пустое поле = действует всегда</span>
                </div>
                {modalPrices.map((p, index) => (
                  <div key={index} className="flex items-end gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 group transition-colors hover:border-blue-300">
                    <div className="w-1/3">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Себестоимость (₽) *</label>
                      <input type="number" value={p.price} onChange={(e) => handlePriceChange(index, 'price', e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-[13px] font-bold text-gray-900 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="Напр: 450" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Действует От</label>
                      <input type="date" value={p.startDate} onChange={(e) => handlePriceChange(index, 'startDate', e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-[13px] text-gray-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Действует До</label>
                      <input type="date" value={p.endDate} onChange={(e) => handlePriceChange(index, 'endDate', e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-[13px] text-gray-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer" />
                    </div>
                    <button onClick={() => handleRemovePricePeriod(index)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mb-0.5" title="Удалить"><Trash2 size={18} /></button>
                  </div>
                ))}
                <button onClick={handleAddPricePeriod} className="flex items-center justify-center gap-2 w-full py-2.5 mt-2 border border-dashed border-gray-300 rounded-xl text-[13px] font-bold text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer"><Plus size={16} /> Добавить период</button>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
              <Button variant="outline" onClick={() => setEditingProduct(null)}>Отмена</Button>
              <Button onClick={handleSavePrices}><Save size={16} /> Сохранить</Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}