import pandas as pd
import numpy as np
from scipy.stats import norm

class OptionsAnalyzer:
    def __init__(self, api_client):
        self.api = api_client

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

    def fetch_and_analyze(self, underlying_symbol):
        print(f"Запуск аналитики для базового актива: {underlying_symbol}")
        
        # 1. Загрузка доски опционов через API (тут пока заглушка)
        # raw_chain = self.api.get_option_chain_by_underlying(underlying_symbol)
        
        print("Формирование тестовых данных для демонстрации расчета IV и Цены...")
        
        # Для демонстрации создадим фейковую позицию на доске
        # Допустим:
        F = 90000.0  # Цена фьючерса (например, Si)
        K = 92000.0  # Страйк
        T = 30 / 365 # До экспирации 30 дней
        r = 0.16     # Безрисковая ставка ЦБ (16%)
        
        market_price_call = 1200.0 # Текущая рыночная цена опциона Call
        
        # 2. Рассчитываем подразумеваемую волатильность (IV)
        iv_call = self.calculate_iv(F, K, T, r, market_price_call, option_type='C')
        
        # 3. Рассчитываем теоретическую цену по полученной IV (самопроверка)
        theo_price = self.black_76_price(F, K, T, r, iv_call, option_type='C')
        vega = self.black_76_vega(F, K, T, r, iv_call)
        
        data = [{
            "Тип": "Call",
            "Фьючерс (F)": F,
            "Страйк (K)": K,
            "Дней до эксп.": round(T*365),
            "Рын. Цена": market_price_call,
            "IV (%)": round(iv_call * 100, 2),
            "Теор. Цена": round(theo_price, 2),
            "Vega": round(vega, 2)
        }]
        
        df = pd.DataFrame(data)
        print("\n=== Результат обсчета ===")
        print(df.to_string(index=False))
        print("======================\n")
        
        return df
