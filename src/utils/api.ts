// Функция для скачивания товаров
export const fetchWbProducts = async (token: string) => {
  // Стучимся в официальный API Контента Wildberries
  const response = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      settings: {
        cursor: { limit: 100 },
        filter: { withPhoto: -1 }
      }
    })
  });

  if (!response.ok) {
    throw new Error('Не удалось скачать товары. Проверьте API Токен!');
  }

  const data = await response.json();
  
  // Берем только нужные нам поля из огромного ответа ВБ
  return data.cards.map((card: any) => ({
    nmID: card.nmID,
    vendorCode: card.vendorCode,
    title: card.title,
    photo: card.photos?.[0]?.c246x328 || '' // Берем первую фотографию
  }));
};

// Функция для скачивания финансового отчета
export const fetchFinancialReport = async (token: string, dateFrom: string, dateTo: string) => {
  let allData: any[] = [];
  let rrdid = 0;
  let hasMore = true;

  while (hasMore) {
    // Стучимся в API Статистики
    const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&rrdid=${rrdid}&limit=100000`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': token }
    });

    if (response.status === 429) {
      throw new Error("WB просит подождать. Лимит запросов: 1 раз в минуту. Попробуйте через 60 секунд.");
    }

    if (response.status === 204) {
      // 204 означает, что данных больше нет (мы скачали всё)
      break; 
    }

    if (!response.ok) {
      throw new Error('Ошибка скачивания. Проверьте, есть ли у токена галочка "Статистика".');
    }

    const data = await response.json();
    
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = [...allData, ...data];
      // Берем ID последней строки, чтобы WB понял, откуда отдавать следующую порцию
      rrdid = data[data.length - 1].rrd_id; 
    }
  }
  
  return allData;
};