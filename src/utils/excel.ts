import * as XLSX from 'xlsx';

// Функция для скачивания шаблона
export const downloadTemplate = () => {
  const data = [
    { "Наименование": "Футболка белая", "Цена (Опт)": 500, "Дата начала": "01.01.2024", "Дата окончания": "31.12.2024" },
    { "Наименование": "Носки черные", "Цена (Опт)": 80, "Дата начала": "01.06.2024", "Дата окончания": "" },
  ];
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Шаблон опт");
  
  // Делаем колонки пошире для красоты
  worksheet['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];

  XLSX.writeFile(workbook, "Шаблон_Оптовые_Цены.xlsx");
};

// Функция для чтения загруженного файла
export const parseExcel = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
};

// Функция для выгрузки любых данных в Excel
export const exportToExcel = (data: any[], filename: string) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Отчет");
  XLSX.writeFile(workbook, `${filename}.xlsx`);
};