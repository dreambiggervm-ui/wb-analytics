import Dexie, { Table } from 'dexie';

export interface WholesalePrice {
  id?: number;
  name: string;
  price: number;
  startDate: string;
  endDate: string;
  nmId?: number;
  updatedAt?: number;
}

export interface WbProduct {
  nmID: number;
  vendorCode: string;
  title: string;
  photo: string;
}

// Новые интерфейсы для раздела "Остатки (FBS)"
export interface FbsWarehouse { id: number; name: string; }
export interface FbsStockItem {
  id: string;
  nmId: number;
  vendorCode: string;
  title: string;
  techSize: string;
  color: string;
  barcodes: string[];
  photo: string;
  stocks: Record<number, number>;
  totalAmount: number;
}
export interface FbsStatus { id: string; status: string; since: number; }

export class WbAnalyticsDB extends Dexie {
  prices!: Table<WholesalePrice>;
  products!: Table<WbProduct>;
  rawReports!: Table<any, number>; 
  
  // Хранилища для остатков FBS
  fbsWarehouses!: Table<FbsWarehouse>;
  fbsStocks!: Table<FbsStockItem>;
  fbsStatusHistory!: Table<FbsStatus>;

  constructor() {
    super('WbAnalyticsDB');
    // ВАЖНО: Подняли версию до 3
    this.version(3).stores({
      prices: '++id, name, nmId',
      products: 'nmID, vendorCode, title',
      rawReports: 'rrd_id, rr_dt, shk_id, nm_id',
      fbsWarehouses: 'id',
      fbsStocks: 'id, nmId, vendorCode', 
      fbsStatusHistory: 'id'
    });
  }
}

export const db = new WbAnalyticsDB();