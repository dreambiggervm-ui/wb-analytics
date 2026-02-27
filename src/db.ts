import Dexie, { Table } from 'dexie';

export interface WholesalePrice {
  id?: number;
  name: string;
  price: number;
  startDate: string;
  endDate: string;
  nmId?: number;
}

export interface WbProduct {
  nmID: number;
  vendorCode: string;
  title: string;
  photo: string;
}

export class WbAnalyticsDB extends Dexie {
  prices!: Table<WholesalePrice>;
  products!: Table<WbProduct>;
  // Новое: хранилище сырых строк из отчета WB
  rawReports!: Table<any, number>; 

  constructor() {
    super('WbAnalyticsDB');
    // ВАЖНО: Подняли версию до 2 и добавили таблицу rawReports.
    // rrd_id - это уникальный ID строки с ВБ, он будет ключом (защита от дублей)
    this.version(2).stores({
      prices: '++id, name, nmId',
      products: 'nmID, vendorCode, title',
      rawReports: 'rrd_id, rr_dt, shk_id, nm_id' 
    });
  }
}

export const db = new WbAnalyticsDB();