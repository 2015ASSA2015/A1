import os
from alor_api import AlorApi
from options_analyzer import OptionsAnalyzer

def main():
    print("=== АЛОР Опционный Аналитик ===")
    
    # Рекомендуется не хардкодить токен, а хранить в переменных окружения.
    # Windows: setx ALOR_REFRESH_TOKEN "ваш_токен"
    refresh_token = os.getenv("ALOR_REFRESH_TOKEN", "ТВОЙ_ТОКЕН_ЗДЕСЬ")
    
    if refresh_token == "ТВОЙ_ТОКЕН_ЗДЕСЬ":
        print(">> Внимание: Токен пока не задан! Программа работает в структурированном режиме (Без запросов в АЛОР).\n")
    
    # 1. Инициализируем API
    api = AlorApi(refresh_token)
    
    # 2. Инициализируем Аналитику
    analyzer = OptionsAnalyzer(api)
    
    # 3. Указываем базовый актив (например, фьючерс на доллар-рубль актуального контракта)
    underlying = "SiM4" # Тестовый актив (актуальный нужно будет поменять)
    
    # 4. Запускаем анализ
    df = analyzer.fetch_and_analyze(underlying)
    
    print("\nПрограмма успешно завершена.")

if __name__ == "__main__":
    main()
