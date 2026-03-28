import pandas as pd
import numpy as np
from scipy.stats import norm
from datetime import datetime
import re


class OptionsAnalyzer:
    def __init__(self, api_client):
        self.api = api_client
        self.risk_free_rate = 0.16  # Безрисковая ставка ЦБ РФ (16%)

    def parse_option_symbol(self, symbol):
        """
        Парсинг символа опциона.
        Поддерживаемые форматы:
        1. Si-6.26C92000 (старый формат)
        2. Из описания типа: "Марж. амер. Call 80 с исп. 18 июня на фьюч. контр. Si-6.26"
        
        Возвращает: {base, expiration_month, expiration_year, option_type, strike}
        """
        # Паттерн 1: BASE-MM.YY[T]STRIKE где T - тип (C/P)
        pattern = r'^([A-Za-z]+)-(\d+)\.(\d+)([CP])(\d+)$'
        match = re.match(pattern, symbol)
        
        if match:
            base, month, year, opt_type, strike = match.groups()
            return {
                'base': base.upper(),
                'expiration_month': int(month),
                'expiration_year': 2000 + int(year),
                'option_type': opt_type,
                'strike': float(strike)
            }
        
        return None

    def parse_option_type(self, type_str, symbol=""):
        """
        Парсинг описания типа опциона из API АЛОР.
        Пример: "Марж. амер. Call 80 с исп. 18 июня на фьюч. контр. Si-6.26"
        """
        if not type_str:
            return None
            
        type_lower = type_str.lower()
        
        # Определяем тип опциона
        option_type = None
        if "call" in type_lower:
            option_type = 'C'
        elif "put" in type_lower:
            option_type = 'P'
        
        if not option_type:
            return None
        
        # Извлекаем страйк
        strike = None
        # Паттерн: "Call 80 с исп." или "Put 90 с исп."
        strike_match = re.search(r'(?:call|put)\s+([\d.]+)\s+с исп\.', type_lower)
        if strike_match:
            strike = float(strike_match.group(1))
        
        # Извлекаем базовый актив и экспирацию
        base = None
        exp_month = None
        exp_year = None
        
        if "на фьюч. контр." in type_lower:
            parts = type_lower.split("на фьюч. контр.")
            if len(parts) > 1:
                futures_part = parts[1].strip()
                # Si-6.26 -> Si, 6, 26
                futures_match = re.match(r'([a-z]+)-(\d+)\.(\d+)', futures_part)
                if futures_match:
                    base = futures_match.group(1).upper()
                    exp_month = int(futures_match.group(2))
                    exp_year = 2000 + int(futures_match.group(3))
        
        if not all([base, exp_month, exp_year, strike]):
            return None
            
        return {
            'base': base,
            'expiration_month': exp_month,
            'expiration_year': exp_year,
            'option_type': option_type,
            'strike': strike
        }

    def calculate_days_to_expiration(self, exp_month, exp_year):
        """Расчёт дней до экспирации"""
        # Третья пятница месяца экспирации
        exp_date = datetime(exp_year, exp_month, 1)
        # Находим третью пятницу
        third_friday = None
        count = 0
        for day in range(1, 22):
            date = datetime(exp_year, exp_month, day)
            if date.weekday() == 4:  # Пятница
                count += 1
                if count == 3:
                    third_friday = date
                    break
        
        if third_friday is None:
            return 0
        
        days = (third_friday - datetime.now()).days
        return max(0, days)

    @staticmethod
    def black_76_price(F, K, T, r, sigma, option_type='C'):
        """
        Расчет теоретической цены опциона на фьючерс по модели Black-76.
        F - Текущая цена фьючерса (базового актива)
        K - Страйк опциона
        T - Время до экспирации (в годах, например, 30 дней = 30/365)
        r - Безрисковая процентная ставка (в долях, например, 0.16 для 16%)
        sigma - Волатильность (в долях, например, 0.20 для 20%)
        option_type - 'C' для Call, 'P' для Put
        """
        if T <= 0 or sigma <= 0:
            return max(F - K, 0) if option_type == 'C' else max(K - F, 0)
            
        d1 = (np.log(F / K) + (0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        
        discount_factor = np.exp(-r * T)
        
        if option_type == 'C':
            price = discount_factor * (F * norm.cdf(d1) - K * norm.cdf(d2))
        else: # Put
            price = discount_factor * (K * norm.cdf(-d2) - F * norm.cdf(-d1))
            
        return price

    @staticmethod
    def black_76_vega(F, K, T, r, sigma):
        """Расчет Веги (чувствительность к изменению волатильности)"""
        if T <= 0 or sigma <= 0:
            return 0.0
            
        d1 = (np.log(F / K) + (0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        discount_factor = np.exp(-r * T)
        vega = F * discount_factor * norm.pdf(d1) * np.sqrt(T)
        return vega

    @classmethod
    def calculate_iv(cls, F, K, T, r, market_price, option_type='C', tol=1e-5, max_iter=100):
        """
        Расчет подразумеваемой волатильности (Implied Volatility - IV) 
        для опциона методом Ньютона-Рафсона.
        """
        if market_price <= 0 or T <= 0:
            return 0.0
            
        sigma = 0.5 # Начальное предположение: IV = 50%
        
        for i in range(max_iter):
            price = cls.black_76_price(F, K, T, r, sigma, option_type)
            diff = price - market_price
            
            if abs(diff) < tol:
                return sigma
                
            vega = cls.black_76_vega(F, K, T, r, sigma)
            if vega == 0:
                break
                
            sigma = sigma - diff / vega # Шаг алгоритма Ньютона
            
            # Волатильность не может быть отрицательной, 
            # ограничиваем снижение значением чуть больше нуля
            if sigma <= 0:
                sigma = 0.001 
                
        return sigma

    def fetch_and_analyze(self, underlying_symbol, expiration=None, futures_contract=None):
        """
        Загрузка и анализ опционной доски для базового актива.

        Args:
            underlying_symbol: Символ базового актива (например, "Si")
            expiration: Опциональная экспирация в формате "MM.YY" (например, "6.26")
                       Если None, используется ближайшая экспирация
            futures_contract: Символ фьючерсного контракта для получения цены (например, "SiM6")
        """
        print(f"Запуск аналитики для базового актива: {underlying_symbol}")

        # 1. Получаем список опционов по базовому активу
        print("Загрузка списка опционов...")
        options = self.api.get_options_by_underlying(underlying_symbol)

        if not options:
            print(f"⚠️ Опционы для {underlying_symbol} не найдены")
            return pd.DataFrame()

        print(f"✅ Найдено опционов: {len(options)}")

        # 2. Получаем доступные экспирации
        expirations = self.api.get_option_expirations(underlying_symbol)
        if not expirations:
            print("⚠️ Экспирации не найдены")
            return pd.DataFrame()

        print(f"Доступные экспирации: {', '.join(expirations)}")

        # Выбираем нужную экспирацию
        target_expiration = expiration if expiration else expirations[0]
        print(f"Выбрана экспирация: {target_expiration}")

        # 3. Получаем цену базового актива (фьючерса)
        if not futures_contract:
            futures_contract = f"{underlying_symbol}M{target_expiration.replace('.', '')}"
        
        F = 0  # Инициализируем переменную
        
        # Пробуем получить котировки
        futures_quotes = self.api.get_quotes(futures_contract)
        
        if futures_quotes and isinstance(futures_quotes, dict):
            F = futures_quotes.get('last', 0) or futures_quotes.get('close', 0)
        
        # Если не получилось, пробуем получить из instrument info
        if not F or F == 0:
            # Пробуем формат Si-6.26
            futures_name = f"{underlying_symbol}-{target_expiration}"
            info = self.api.get_instrument_info(futures_name)
            if info:
                F = info.get('theorPrice', 0) or info.get('priceMax', 0) or 90000.0
            else:
                F = 90000.0  # Заглушка
                print(f"⚠️ Не удалось получить цену фьючерса {futures_contract}, используем {F}")

        print(f"Цена фьючерса {futures_contract}: {F}")
        
        # 4. Фильтруем опционы по выбранной экспирации и собираем данные
        data = []
        processed_strikes = set()
        
        for opt in options:
            symbol = opt.get('symbol', '')
            opt_type = opt.get('type', '')
            
            # Пробуем распарсить через описание типа (новый формат АЛОР)
            parsed = self.parse_option_type(opt_type, symbol)
            
            # Если не получилось, пробуем старый формат символа
            if not parsed:
                parsed = self.parse_option_symbol(symbol)
            
            if not parsed:
                continue
            
            # Проверяем экспирацию
            exp_str = f"{parsed['expiration_month']}.{str(parsed['expiration_year'] - 2000).zfill(2)}"
            if exp_str != target_expiration:
                continue
            
            # Пропускаем дубликаты страйков
            strike_key = (parsed['strike'], parsed['option_type'])
            if strike_key in processed_strikes:
                continue
            processed_strikes.add(strike_key)
            
            # Получаем котировки опциона
            opt_quotes = self.api.get_quotes(symbol)
            
            if opt_quotes and isinstance(opt_quotes, dict):
                market_price = opt_quotes.get('last', 0) or opt_quotes.get('close', 0) or 0
            else:
                market_price = 0
            
            # Пропускаем опционы без цены
            if market_price <= 0:
                continue
            
            # Расчёт дней до экспирации
            days = self.calculate_days_to_expiration(
                parsed['expiration_month'], 
                parsed['expiration_year']
            )
            T = days / 365.0 if days > 0 else 0.001
            
            # Расчёт подразумеваемой волатильности
            iv = self.calculate_iv(
                F, 
                parsed['strike'], 
                T, 
                self.risk_free_rate, 
                market_price, 
                option_type=parsed['option_type']
            )
            
            # Расчёт теоретической цены и вег
            theo_price = self.black_76_price(
                F, 
                parsed['strike'], 
                T, 
                self.risk_free_rate, 
                iv, 
                option_type=parsed['option_type']
            )
            vega = self.black_76_vega(
                F, 
                parsed['strike'], 
                T, 
                self.risk_free_rate, 
                iv
            )
            
            # Внутренняя стоимость
            if parsed['option_type'] == 'C':
                intrinsic_value = max(F - parsed['strike'], 0)
            else:
                intrinsic_value = max(parsed['strike'] - F, 0)
            
            # Временная стоимость
            time_value = market_price - intrinsic_value
            
            data.append({
                "Тип": parsed['option_type'],
                "Символ": symbol,
                "Страйк": parsed['strike'],
                "Рын.Цена": round(market_price, 2),
                "Теор.Цена": round(theo_price, 2),
                "IV (%)": round(iv * 100, 2),
                "Внутр.ст-сть": round(intrinsic_value, 2),
                "Врем.ст-сть": round(time_value, 2),
                "Vega": round(vega, 4),
                "Дней до эксп.": days
            })
        
        if not data:
            print("⚠️ Нет данных для анализа (возможно, нет котировок)")
            return pd.DataFrame()
        
        # Создаём DataFrame
        df = pd.DataFrame(data)
        
        # Сортируем: сначала Call, потом Put, по страйку
        df = df.sort_values(['Тип', 'Страйк'])
        
        # Вывод результатов
        print("\n" + "="*100)
        print("=== РЕЗУЛЬТАТ АНАЛИЗА ===")
        print(f"Базовый актив: {underlying_symbol} | Цена: {F} | Экспирация: {target_expiration}")
        print("="*100)
        print(df.to_string(index=False))
        print("="*100)
        
        # Статистика
        print("\n📊 СТАТИСТИКА:")
        print(f"  Всего опционов: {len(df)}")
        print(f"  Call: {len(df[df['Тип'] == 'C'])}")
        print(f"  Put: {len(df[df['Тип'] == 'P'])}")
        
        if len(df) > 0:
            avg_iv = df['IV (%)'].mean()
            print(f"  Средняя IV: {avg_iv:.2f}%")
        
        return df
