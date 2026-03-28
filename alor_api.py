import requests
import time
import json
import asyncio
import websockets

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
