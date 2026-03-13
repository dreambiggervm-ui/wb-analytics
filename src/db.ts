import Dexie, { Table } from 'dexie';

export interface WholesalePrice { id?: number; name: string; price: number; startDate: string; endDate: string; nmId?: number; updatedAt?: number; }
export interface WbProduct { nmID: number; vendorCode: string; title: string; photo: string; sizes?: string[]; }
export interface FbsWarehouse { id: number; name: string; }
export interface FbsStockItem { id: string; nmId: number; vendorCode: string; title: string; techSize: string; color: string; barcodes: string[]; photo: string; stocks: Record<number, number>; totalAmount: number; }
export interface FbsStatus { id: string; status: string; since: number; }
export interface StockReceipt { date: string; quantity: number; price: number; }

export interface MyStockItem { 
  id?: number; 
  article?: string; 
  title: string; 
  brand?: string; 
  category: string; 
  quantity: number; 
  price: number; 
  barcode?: string; 
  note?: string;
  receipts?: StockReceipt[]; 
}

export interface MyWarehouseChange { id?: number; itemId?: number; title: string; field: string; oldValue: string; newValue: string; changeDate: string; }
export interface SupplierSheetMapping { sheetName: string; enabled: boolean; colName: string; colWholesale: string; colRrc: string; colStock: string; colNote?: string; colDimensions?: string; colWeight?: string; }
export interface Supplier { id?: number; title: string; sourceUrl: string; sheets: SupplierSheetMapping[]; cachedData?: any[]; lastSync?: string; }
export interface SupplierChange { id?: number; supplierId: number; supplierName: string; sheetName: string; category: string; title: string; field: string; oldValue: string; newValue: string; changeDate: string; }
export interface WbSupply { id: string; name: string; createdAt: string; closedAt?: string; done: boolean; }
export interface WbOrder { id: number; supplyId?: string; article: string; title: string; price: number; supplierStatus?: string; createdAt: string; localDeducted?: boolean; nmId?: number; }
export interface WbLink { nmId: number; myStockItemId: number; }

// НОВОЕ: Интерфейс для wbLinks с уникальным id
export interface WbLinkV2 { id?: number; nmId: number; wbItemId?: string; myStockItemId: number; }

// Интерфейс для ручных отгрузок (Заказы со склада)
export interface ManualOrder {
  id?: number;
  myStockItemId: number;
  title: string;
  quantity: number;
  salePrice: number; // Цена продажи за 1 шт.
  shippingType: 'Самовывоз' | 'Курьер' | 'ТК';
  date: string; // YYYY-MM-DD
  createdAt: string; // Точное время создания (ISO)
}

// ==========================================
// НОВОЕ: ИНТЕРФЕЙСЫ ДЛЯ EMALL
// ==========================================

export interface EmallProduct {
  id: string; // ID товара в Emall (согласно их API)
  article: string;
  title: string;
  photo?: string;
}

export interface EmallOrder {
  id: string; // Номер заказа Emall
  status: string;
  createdAt: string;
  totalPrice: number; // Сумма продажи
  emallCommission: number; // Комиссия площадки (для расчета чистой прибыли)
  deliveryCost: number; // Логистика (для расчета чистой прибыли)
  localDeducted?: boolean; // Флаг: списано ли с Моего Склада
}

export interface EmallLink {
  emallProductId: string; // ID товара на Emall
  myStockItemId: number; // ID товара на локальном складе (MyStockItem)
}

// ==========================================
// НОВОЕ: Интерфейс для сохранения состояния приложения
// ==========================================
export interface AppState {
  id: string;
  value: any;
}
// ==========================================

export class WbAnalyticsDB extends Dexie {
  prices!: Table<WholesalePrice>;
  products!: Table<WbProduct>;
  rawReports!: Table<any, number>; 
  fbsWarehouses!: Table<FbsWarehouse>;
  fbsStocks!: Table<FbsStockItem>;
  fbsStatusHistory!: Table<FbsStatus>;
  myWarehouse!: Table<MyStockItem>;
  myWarehouseChanges!: Table<MyWarehouseChange>;
  suppliers!: Table<Supplier>;
  supplierChanges!: Table<SupplierChange>;
  wbSupplies!: Table<WbSupply>;
  wbOrders!: Table<WbOrder>;
  wbLinks!: Table<WbLink>;
  wbLinksV2!: Table<WbLinkV2>; // ДОБАВЛЕНО
  manualOrders!: Table<ManualOrder>; 
  
  // НОВОЕ: Таблицы Emall
  emallProducts!: Table<EmallProduct>;
  emallOrders!: Table<EmallOrder>;
  emallLinks!: Table<EmallLink>;

  // НОВОЕ: Таблица состояния приложения
  appState!: Table<AppState>;

  constructor() {
    super('WbAnalyticsDB');
    
    // ВАЖНО: Подняли версию до 13 для добавления таблиц Emall. 
    // Старые таблицы сохранены без изменений.
    this.version(13).stores({
      prices: '++id, name, nmId',
      products: 'nmID, vendorCode, title',
      rawReports: 'rrd_id, rr_dt, shk_id, nm_id',
      fbsWarehouses: 'id',
      fbsStocks: 'id, nmId, vendorCode', 
      fbsStatusHistory: 'id',
      myWarehouse: '++id, article, title, barcode',
      myWarehouseChanges: '++id, itemId, title',
      suppliers: '++id, title',
      supplierChanges: '++id, supplierId, title, changeDate',
      wbSupplies: 'id, createdAt, done',
      wbOrders: 'id, supplyId, supplierStatus, createdAt',
      wbLinks: 'nmId, myStockItemId',
      manualOrders: '++id, date, myStockItemId, shippingType',
      
      // НОВОЕ: Индексы для таблиц Emall
      emallProducts: 'id, article, title',
      emallOrders: 'id, status, createdAt',
      emallLinks: 'emallProductId, myStockItemId'
    });

    // ДОБАВЛЕНО: Версия 14: Изменение ключа wbLinks для поддержки множественных связей
    this.version(14).stores({
      wbLinks: 'nmId, myStockItemId', 
      wbLinksV2: '++id, nmId, wbItemId, myStockItemId' 
    }).upgrade(async trans => {
      // Переносим данные из старой таблицы в новую, если они есть
      const oldLinks = await trans.table('wbLinks').toArray();
      const newLinksCount = await trans.table('wbLinksV2').count();
      if (oldLinks.length > 0 && newLinksCount === 0) {
        // Убираем nmId в качестве первичного ключа и переносим данные
        const mappedLinks = oldLinks.map((l: any) => ({
          nmId: l.nmId,
          myStockItemId: l.myStockItemId
        }));
        await trans.table('wbLinksV2').bulkAdd(mappedLinks);
      }
    });

    // ДОБАВЛЕНО: Версия 15: Таблица для сохранения состояния интерфейса (чтобы не сбрасывалось при закрытии)
    this.version(15).stores({
      appState: 'id'
    });
  }
}

export const db = new WbAnalyticsDB();