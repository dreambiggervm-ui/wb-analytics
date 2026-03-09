// src/utils/emallApi.ts

// Базовый URL теперь указывает на наш локальный прокси
const EMALL_BASE_URL = '/emall-api/open/api/v1';

const getHeaders = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
});

/**
 * 1. Получение каталога товаров Emall
 */
export const fetchEmallProducts = async (token: string, page = 1, perPage = 100) => {
  // ИСПРАВЛЕНО: Эндпоинт Emall для получения товаров — /products
  const response = await fetch(`${EMALL_BASE_URL}/products?page=${page}&perPage=${perPage}`, {
    method: 'GET',
    headers: getHeaders(token),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('Неверный API Ключ Emall!');
    throw new Error(`Ошибка скачивания товаров Emall: Сервер вернул код ${response.status}`);
  }

  const data = await response.json();
  
  // В зависимости от ответа API, массив товаров может лежать в data.items, data.data или просто в data
  const productsArray = data.items || data.data || (Array.isArray(data) ? data : []); 

  return productsArray.map((item: any) => ({
    id: String(item.id),
    article: item.article || item.sku || item.code || '',
    title: item.name || item.title || 'Без названия',
    photo: item.imageUrl || item.image || item.photo || '' 
  }));
};

/**
 * 2. Получение заказов и финансовых данных Emall
 */
export const fetchEmallOrders = async (token: string, dateFrom: string, dateTo: string) => {
  const response = await fetch(`${EMALL_BASE_URL}/orders?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    method: 'GET',
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Ошибка скачивания заказов Emall: Сервер вернул код ${response.status}`);
  }

  const data = await response.json();

  const ordersArray = data.orders || data.data || (Array.isArray(data) ? data : []);

  return ordersArray.map((order: any) => ({
    id: String(order.id),
    status: order.status || 'Новый',
    createdAt: order.createdAt || order.date || new Date().toISOString(),
    totalPrice: Number(order.price || order.totalAmount || 0),
    emallCommission: Number(order.commission || order.fee || 0),
    deliveryCost: Number(order.deliveryCost || order.logistics || 0),
    localDeducted: false,
    items: order.items || order.products || [] // Важно для Шага 4 (списание товаров)
  }));
};