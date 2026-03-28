import requests
import time

class AlorApi:
    OAUTH_URL = "https://oauth.alor.ru/refresh"
    API_URL = "https://api.alor.ru"

    def __init__(self, refresh_token):
        self.refresh_token = refresh_token
        self.jwt_token = None
        self.token_expires_at = 0

    def get_token(self):
        """Получает или обновляет JWT токен"""
        # Если токена нет или он протухнет быстрее чем через 60 сек - обновляем
        if time.time() < self.token_expires_at - 60 and self.jwt_token:
            return self.jwt_token

        params = {'token': self.refresh_token}
        response = requests.post(self.OAUTH_URL, params=params)
        
        if response.status_code != 200:
            print(f"Ошибка авторизации: {response.text}")
            return None
            
        data = response.json()
        self.jwt_token = data.get('AccessToken')
        # Токен АЛОР живет около 30 минут, берём срок в 1800 секунд
        self.token_expires_at = time.time() + 1800 
        return self.jwt_token

    def _get_headers(self):
        token = self.get_token()
        if not token:
            return {}
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def get_instrument_info(self, symbol, exchange="MOEX"):
        """Получение общей информации об инструменте (например, базовый актив)"""
        url = f"{self.API_URL}/md/v2/Securities/{exchange}/{symbol}"
        response = requests.get(url, headers=self._get_headers())
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Ошибка при запросе инструмента: {response.text}")
        return None

    def get_option_chain_by_underlying(self, underlying_symbol, exchange="MOEX"):
        """
        Поиск доступных опционов по тикеру базового актива.
        """
        url = f"{self.API_URL}/md/v2/Securities"
        params = {
            "query": underlying_symbol,
            "sector": "FORTS", # Деривативы на московской бирже
            "format": "Simple",
            "limit": 500
        }
        
        response = requests.get(url, headers=self._get_headers(), params=params)
        if response.status_code == 200:
            return response.json()
        return []

    def get_quote(self, symbol, exchange="MOEX"):
        """Получить текущие котировки инструмента"""
        url = f"{self.API_URL}/md/v2/Securities/{exchange}/{symbol}/quotes"
        response = requests.get(url, headers=self._get_headers())
        if response.status_code == 200:
            return response.json()
        return None
