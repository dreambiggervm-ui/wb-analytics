// Вспомогательная функция для автоматической паузы
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Полная таблица перевода новых (camelCase) полей в старые (snake_case)
const FIELD_MAPPING: Record<string, string> = {
  reportId: 'realizationreport_id', dateFrom: 'date_from', dateTo: 'date_to',
  createDate: 'create_dt', currency: 'currency_name', rrdId: 'rrd_id',
  giId: 'gi_id', dlvPrc: 'dlv_prc', fixTariffDateFrom: 'fix_tariff_date_from',
  fixTariffDateTo: 'fix_tariff_date_to', subjectName: 'subject_name', nmId: 'nm_id',
  brandName: 'brand_name', vendorCode: 'sa_name', techSize: 'ts_name',
  sku: 'barcode', docTypeName: 'doc_type_name', quantity: 'quantity',
  retailPrice: 'retail_price', retailAmount: 'retail_amount', salePercent: 'sale_percent',
  commissionPercent: 'commission_percent', officeName: 'office_name', sellerOperName: 'supplier_oper_name',
  orderDt: 'order_dt', saleDt: 'sale_dt', rrDate: 'rr_dt', shkId: 'shk_id',
  retailPriceWithDisc: 'retail_price_withdisc_rub', deliveryAmount: 'delivery_amount', returnAmount: 'return_amount',
  deliveryService: 'delivery_rub', giBoxTypeName: 'gi_box_type_name', productDiscountForReport: 'product_discount_for_report',
  sellerPromo: 'supplier_promo', spp: 'ppvz_spp_prc', kvwBase: 'ppvz_kvw_prc_base',
  kvw: 'ppvz_kvw_prc', supRatingUp: 'sup_rating_prc_up', isKgvpV2: 'is_kgvp_v2',
  ppvzSalesCommission: 'ppvz_sales_commission', forPay: 'ppvz_for_pay', ppvzReward: 'ppvz_reward',
  acquiringFee: 'acquiring_fee', acquiringPercent: 'acquiring_percent', paymentProcessing: 'payment_processing',
  acquiringBank: 'acquiring_bank', vw: 'ppvz_vw', vwNds: 'ppvz_vw_nds',
  ppvzOfficeName: 'ppvz_office_name', ppvzOfficeId: 'ppvz_office_id', ppvzSupplierName: 'ppvz_supplier_name',
  ppvzSupplierInn: 'ppvz_inn', declarationNumber: 'declaration_number', bonusTypeName: 'bonus_type_name',
  stickerId: 'sticker_id', country: 'site_country', srvDbs: 'srv_dbs',
  penalty: 'penalty', additionalPayment: 'additional_payment', rebillLogisticCost: 'rebill_logistic_cost',
  rebillLogisticOrg: 'rebill_logistic_org', paidStorage: 'storage_fee', deduction: 'deduction',
  paidAcceptance: 'acceptance', orderId: 'assembly_id', kiz: 'kiz', srid: 'srid',
  reportType: 'report_type', isB2b: 'is_legal_entity', trbxId: 'trbx_id',
  installmentCofinancingAmount: 'installment_cofinancing_amount', wibesDiscountPercent: 'wibes_wb_discount_percent', cashbackAmount: 'cashback_amount',
  cashbackDiscount: 'cashback_discount', cashbackCommissionChange: 'cashback_commission_change', orderUid: 'order_uid'
};

// Функция для скачивания товаров
export const fetchWbProducts = async (token: string) => {
  const response = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } } })
  });

  if (!response.ok) throw new Error('Не удалось скачать товары. Проверьте API Токен!');
  const data = await response.json();
  
  return data.cards.map((card: any) => ({
    nmID: card.nmID, vendorCode: card.vendorCode, title: card.title,
    photo: card.photos?.[0]?.c246x328 || '', kizMarked: card.kizMarked || false 
  }));
};

// Функция для скачивания финансового отчета
export const fetchFinancialReport = async (token: string, dateFrom: string, dateTo: string) => {
  let allData: any[] = [];
  let rrdId = 0; 
  let hasMore = true;

  while (hasMore) {
    const url = `https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo, rrdId, limit: 100000 })
    });

    if (response.status === 429) {
      console.warn("WB просит подождать. Лимит запросов. Спим 60 секунд...");
      await sleep(60000); 
      continue; 
    }
    if (response.status === 204) break; 
    if (!response.ok) throw new Error(`Ошибка скачивания отчета. Статус: ${response.status}`);

    const data = await response.json();
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      const parsedData = data.map((item: any) => {
        const parsedItem = { ...item };
        
        // 1. Превращаем ВСЕ поля, отмеченные "S" в таблице, из строк обратно в нормальные числа
        const stringFields = [
          'retailPrice', 'retailAmount', 'retailPriceWithDisc', 'deliveryService',
          'sellerPromo', 'ppvzSalesCommission', 'forPay', 'ppvzReward',
          'acquiringFee', 'vw', 'vwNds', 'penalty', 'additionalPayment',
          'rebillLogisticCost', 'paidStorage', 'deduction', 'paidAcceptance',
          'installmentCofinancingAmount', 'cashbackAmount', 'cashbackDiscount',
          'cashbackCommissionChange'
        ];
        
        stringFields.forEach(field => {
          if (typeof parsedItem[field] === 'string') {
            // На случай если ВБ вдруг пришлет запятые вместо точек
            parsedItem[field] = parseFloat(parsedItem[field].replace(',', '.')) || 0; 
          }
        });

        // 2. Маппим новые camelCase названия на старые snake_case
        Object.keys(FIELD_MAPPING).forEach(newKey => {
           const oldKey = FIELD_MAPPING[newKey];
           if (parsedItem[newKey] !== undefined) {
               parsedItem[oldKey] = parsedItem[newKey];
           }
        });

        return parsedItem;
      });

      allData = [...allData, ...parsedData];
      rrdId = data[data.length - 1].rrdId; 
      if (data.length === 100000) await sleep(5000); 
    }
  }
  return allData;
};

// Функция для скачивания остатков со складов WB (FBW)
export const fetchWbWarehouseStocks = async (token: string) => {
  let allData: any[] = [];
  let offset = 0;
  const limit = 250000;
  let hasMore = true;

  while (hasMore) {
    const url = `https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, offset })
    });

    if (response.status === 429) {
      console.warn("WB Лимит на остатки. Спим 20 секунд...");
      await sleep(20000); 
      continue;
    }
    if (!response.ok) throw new Error(`Ошибка скачивания остатков. Статус: ${response.status}`);

    const data = await response.json();
    const items = Array.isArray(data) ? data : (data.data || []);
    
    if (!items || items.length === 0) {
      hasMore = false;
    } else {
      allData = [...allData, ...items];
      if (items.length < limit) hasMore = false;
      else {
        offset += limit;
        await sleep(21000); 
      }
    }
  }
  return allData;
};