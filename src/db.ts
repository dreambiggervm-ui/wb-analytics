import Dexie, { Table } from 'dexie';

export interface WholesalePrice { id?: number; name: string; price: number; startDate: string; endDate: string; nmId?: number; updatedAt?: number; }
export interface WbProduct { nmID: number; vendorCode: string; title: string; photo: string; }
export interface FbsWarehouse { id: number; name: string; }
export interface FbsStockItem { id: string; nmId: number; vendorCode: string; title: string; techSize: string; color: string; barcodes: string[]; photo: string; stocks: Record<number, number>; totalAmount: number; }
export interface FbsStatus { id: string; status: string; since: number; }

export interface MyStockItem { id?: number; article?: string; title: string; brand?: string; category: string; quantity: number; price: number; barcode?: string; note?: string; }
export interface MyWarehouseChange { id?: number; itemId?: number; title: string; field: string; oldValue: string; newValue: string; changeDate: string; }

export interface SupplierSheetMapping { sheetName: string; enabled: boolean; colName: string; colWholesale: string; colRrc: string; colStock: string; colNote?: string; colDimensions?: string; colWeight?: string; }
export interface Supplier { id?: number; title: string; sourceUrl: string; sheets: SupplierSheetMapping[]; cachedData?: any[]; lastSync?: string; }
export interface SupplierChange { id?: number; supplierId: number; supplierName: string; sheetName: string; category: string; title: string; field: string; oldValue: string; newValue: string; changeDate: string; }

export interface WbSupply { id: string; name: string; createdAt: string; closedAt?: string; done: boolean; }
export interface WbOrder { id: number; supplyId?: string; article: string; title: string; price: number; supplierStatus?: string; createdAt: string; localDeducted?: boolean; }

// НОВАЯ ТАБЛИЦА: СВЯЗИ ТОВАРОВ WB С "МОИМ СКЛАДОМ"
export interface WbLink {
  nmId: number;
  myStockItemId: number;
}

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
  wbLinks!: Table<WbLink>; // Добавили таблицу связей

  constructor() {
    super('WbAnalyticsDB');
    // ВАЖНО: Подняли версию до 9
    this.version(9).stores({
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
      wbLinks: 'nmId, myStockItemId' // Индексы для быстрого поиска связей
    });
  }
}

export const db = new WbAnalyticsDB();