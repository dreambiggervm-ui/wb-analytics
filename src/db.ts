import Dexie, { Table } from 'dexie';

export interface WholesalePrice { id?: number; name: string; price: number; startDate: string; endDate: string; nmId?: number; updatedAt?: number; }
export interface WbProduct { nmID: number; vendorCode: string; title: string; photo: string; }
export interface FbsWarehouse { id: number; name: string; }
export interface FbsStockItem { id: string; nmId: number; vendorCode: string; title: string; techSize: string; color: string; barcodes: string[]; photo: string; stocks: Record<number, number>; totalAmount: number; }
export interface FbsStatus { id: string; status: string; since: number; }
export interface MyStockItem { id?: number; article: string; title: string; brand: string; category: string; quantity: number; price: number; barcode: string; }

// === ОБНОВЛЕННАЯ СТРУКТУРА ПОСТАВЩИКА (EXCEL/GOOGLE SHEETS) ===
export interface SupplierSheetMapping {
  sheetName: string;
  enabled: boolean;
  colName: string;      // Например: "A"
  colWholesale: string; // Например: "B"
  colRrc: string;       // Например: "C"
  colStock: string;     // Например: "D"
}

export interface Supplier {
  id?: number;
  title: string;
  sourceUrl: string;
  sheets: SupplierSheetMapping[]; // Массив настроек листов
  cachedData?: any[]; // Сюда будем сохранять готовые строки для быстрой отрисовки
  lastSync?: string;
}

export interface SupplierChange { id?: number; supplierId: number; article: string; oldPrice: number; newPrice: number; oldStock: number; newStock: number; changeDate: string; }

export class WbAnalyticsDB extends Dexie {
  prices!: Table<WholesalePrice>;
  products!: Table<WbProduct>;
  rawReports!: Table<any, number>; 
  fbsWarehouses!: Table<FbsWarehouse>;
  fbsStocks!: Table<FbsStockItem>;
  fbsStatusHistory!: Table<FbsStatus>;
  myWarehouse!: Table<MyStockItem>;
  
  suppliers!: Table<Supplier>;
  supplierChanges!: Table<SupplierChange>;

  constructor() {
    super('WbAnalyticsDB');
    this.version(5).stores({ // Подняли версию до 5
      prices: '++id, name, nmId',
      products: 'nmID, vendorCode, title',
      rawReports: 'rrd_id, rr_dt, shk_id, nm_id',
      fbsWarehouses: 'id',
      fbsStocks: 'id, nmId, vendorCode', 
      fbsStatusHistory: 'id',
      myWarehouse: '++id, article, title, barcode',
      suppliers: '++id, title',
      supplierChanges: '++id, supplierId, article, changeDate'
    });
  }
}

export const db = new WbAnalyticsDB();