import requests
import time
import json
import asyncio
import websockets
import re

class AlorApi:
    OAUTH_URL = "https://oauth.alor.ru/refresh"
    API_URL = "https://api.alor.ru"
    WS_URL = "wss://api.alor.ru/ws"

    def __init__(self, refresh_token):
        self.refresh_token = refresh_token
        self.jwt_token = None
        self.token_expires_at = 0
        self.ws = None
        self.subscriptions = {} # guid -> callback

    def get_token(self):
        """Получает или обновляет Access Token (JWT) через Refresh Token"""
        if self.jwt_token and time.time() < self.token_expires_at - 60:
            return self.jwt_token

        params = {'token': self.refresh_token}
        response = requests.post(self.OAUTH_URL, params=params)
        
        if response.status_code != 200:
            print(f"Ошибка авторизации (REST): {response.text}")
            return None
            
        data = response.json()
        self.jwt_token = data.get('AccessToken')
        # Считаем, что токен живет 30 минут
        self.token_expires_at = time.time() + 1750 
        return self.jwt_token

    def _get_headers(self):
        token = self.get_token()
        if not token: return {}
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # --- REST АПИ Методы ---

    def get_quotes(self, symbols, exchange="MOEX"):
        """Запрос котировок через REST (списком)"""
        url = f"{self.API_URL}/md/v2/Securities/{exchange}/{symbols}/quotes"
        response = requests.get(url, headers=self._get_headers())
        return response.json() if response.status_code == 200 else None

    def get_securities(self, query, exchange="MOEX"):
        """Поиск инструментов по коду или названию"""
        url = f"{self.API_URL}/md/v2/Securities"
        params = {"query": query, "sector": "FORTS", "format": "Simple", "limit": 10}
        response = requests.get(url, headers=self._get_headers(), params=params)
        return response.json() if response.status_code == 200 else []

    def get_instrument_info(self, symbol, exchange="MOEX"):
        """Получение детальной информации об инструменте"""
        url = f"{self.API_URL}/md/v2/Securities/{exchange}/{symbol}"
        response = requests.get(url, headers=self._get_headers())
        return response.json() if response.status_code == 200 else None

    def get_all_securities(self, exchange="MOEX", sector="FORTS", limit=1000):
        """Получение списка всех инструментов с фильтрацией"""
        url = f"{self.API_URL}/md/v2/Securities"
        params = {"exchange": exchange, "sector": sector, "limit": limit}
        response = requests.get(url, headers=self._get_headers(), params=params)
        return response.json() if response.status_code == 200 else []

    def get_options_by_underlying(self, underlying_symbol, exchange="MOEX", sector="FORTS"):
        """
        Получение списка опционов по базовому активу.
        Опционы на ФОРТС имеют вид:
        - "Марж. амер. Call 80 с исп. 18 июня на фьюч. контр. Si-6.26"
        - "Нед. прем. европ. Put 90 с исп. 15 апр. на VTBR"
        """
        all_securities = self.get_all_securities(exchange, sector, limit=5000)
        
        # Нормализуем имя базового актива
        underlying_base = underlying_symbol.replace("-", "").upper()
        
        options = []
        for sec in all_securities:
            symbol = sec.get("symbol", "")
            sec_type = sec.get("type", "")
            
            # Проверяем, что это опцион (по типу инструмента)
            if not sec_type:
                continue
                
            is_option = (
                "Call" in sec_type or 
                "Put" in sec_type or
                sec.get("secType") == "OP"
            )
            
            if not is_option:
                continue
            
            # Проверяем принадлежность к базовому активу
            # Ищем имя базового актива в описании опциона
            type_lower = sec_type.lower()
            
            # Извлекаем имя базового актива из описания опциона
            # Например: "Марж. амер. Call 80 с исп. 18 июня на фьюч. контр. Si-6.26"
            if underlying_base in type_lower or underlying_base in symbol.upper():
                options.append(sec)
            elif "на фьюч. контр." in type_lower:
                # Извлекаем имя фьючерса после "на фьюч. контр."
                parts = type_lower.split("на фьюч. контр.")
                if len(parts) > 1:
                    futures_name = parts[1].strip().split()[0] if parts[1].strip() else ""
                    # Si-6.26 -> Si
                    futures_base = futures_name.split("-")[0].upper() if "-" in futures_name else futures_name.upper()
                    if underlying_base == futures_base:
                        options.append(sec)
        
        return options

    def get_option_expirations(self, underlying_symbol, exchange="MOEX", sector="FORTS"):
        """
        Получение списка дат экспирации для опционов на базовый актив.
        Возвращает список уникальных экспираций в формате 'MM.YY'
        """
        options = self.get_options_by_underlying(underlying_symbol, exchange, sector)

        expirations = set()
        for opt in options:
            symbol = opt.get("symbol", "")
            opt_type = opt.get("type", "")
            
            # Пробуем извлечь из описания типа (новый формат)
            if "на фьюч. контр." in opt_type.lower():
                parts = opt_type.lower().split("на фьюч. контр.")
                if len(parts) > 1:
                    futures_part = parts[1].strip()
                    # Si-6.26 -> 6.26
                    futures_match = re.match(r'([a-z]+)-(\d+\.\d+)', futures_part)
                    if futures_match:
                        expirations.add(futures_match.group(2))  # 6.26
            
            # Старый формат символа
            if '-' in symbol and not expirations:
                parts = symbol.split('-')[1]  # 6.26C92000
                # Находим позицию C или P
                for i, c in enumerate(parts):
                    if c in ('C', 'P'):
                        expirations.add(parts[:i])  # 6.26
                        break

        return sorted(list(expirations))

    # --- WEBSOCKET АПИ Методы (Real-time) ---

    async def run_ws(self, on_message_cb):
        """Бесконечный цикл подключения к WebSocket"""
        while True:
            try:
                token = self.get_token()
                async with websockets.connect(f"{self.WS_URL}?token={token}") as ws:
                    print("Подключено к WebSocket АЛОР")
                    self.ws = ws
                    
                    # Переподписываемся на всё, что было (если это реконнект)
                    for guid, sub_data in self.subscriptions.items():
                        await self.ws.send(json.dumps(sub_data))

                    async for message in ws:
                        data = json.loads(message)
                        if data.get("httpCode") == 200 or data.get("requestGuid"):
                            # Технические ответы или подтверждения подписки
                            continue
                        # Вызываем пользовательский коллбэк для данных
                        await on_message_cb(data)
            except Exception as e:
                print(f"Ошибка WebSocket: {e}. Повторное подключение через 5 сек...")
                await asyncio.sleep(5)

    async def subscribe_quotes(self, symbol, exchange="MOEX"):
        """Подписка на стакан/котировки инструмента"""
        guid = f"sub_{symbol}_{int(time.time())}"
        sub_data = {
            "opcode": "QuotesSubscribe",
            "code": symbol,
            "exchange": exchange,
            "format": "Simple",
            "guid": guid
        }
        self.subscriptions[guid] = sub_data
        if self.ws:
            await self.ws.send(json.dumps(sub_data))
        return guid

# --- Пример использования (для теста) ---
async def test_main():
    # Замените на ваш реальный Refresh Token
    MY_REFRESH_TOKEN = "48ca265c-b7e6-4c25-b45e-bd7cb194feae"
    api = AlorApi(MY_REFRESH_TOKEN)
    
    print("\n[1/3] Проверка авторизации (REST)...")
    token = api.get_token()
    if token:
        print(f"✅ Успешная авторизация! JWT получен: {token[:10]}...")
    else:
        print("❌ Ошибка авторизации. Проверьте Refresh Token.")
        return

    print("\n[2/3] Поиск инструмента (SiM6)...")
    search_res = api.get_securities("SiM6")
    if search_res:
        print(f"✅ Найдено {len(search_res)} инструментов по запросу SiM6:")
        for res in search_res[:3]: # Показать первые 3
            print(f" - {res['symbol']} ({res['description']}) на {res['exchange']}")
    else:
        print("❌ Инструменты не найдены.")

    print("\n[3/3] Настройка живого потока (SI-6.26)...")
    
    # Проверим детальную информацию об инструменте
    si_info = api.get_instrument_info("SI-6.26", exchange="MOEX")
    if si_info:
        print(f"✅ Инфо SI-6.26: {json.dumps(si_info, indent=2, ensure_ascii=False)}")
    else:
        print("❌ Не удалось получить инфо SI-6.26 (MOEX). Пробуем FORTS...")
        si_info = api.get_instrument_info("SI-6.26", exchange="FORTS")
        if si_info:
            print(f"✅ Инфо SI-6.26 (FORTS): {json.dumps(si_info, indent=2, ensure_ascii=False)}")

    async def handle_data(data):
        if data.get("data"):
            print(f"🔥 ПРИШЛИ ЖИВЫЕ ДАННЫЕ (SI-6.26): {data['data']}")

    ws_task = asyncio.create_task(api.run_ws(handle_data))
    await asyncio.sleep(2) # Ждем коннекта
    
    print("Отправка подписки на WS 'SI-6.26' (FORTS)...")
    await api.subscribe_quotes("SI-6.26", exchange="FORTS")
    
    print("Ожидаем обновлений 5 секунд...")
    await asyncio.sleep(5)
    ws_task.cancel()
    print("\n--- ТЕСТ ЗАВЕРШЕН ---")

if __name__ == "__main__":
    asyncio.run(test_main())
