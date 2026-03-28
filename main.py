import os
from alor_api import AlorApi
from options_analyzer import OptionsAnalyzer

def main():
    print("=== АЛОР Опционный Аналитик ===")

    # Для тестирования токен вписан напрямую:
    refresh_token = "48ca265c-b7e6-4c25-b45e-bd7cb194feae"

    # 1. Инициализируем API
    api = AlorApi(refresh_token)

    # 2. Инициализируем Аналитику
    analyzer = OptionsAnalyzer(api)

    # 3. Указываем базовый актив
    # Si - фьючерс на доллар/рубль (базовый актив для опционов)
    # RTS - фьючерс на индекс РТС (базовый актив для опционов)
    # SiM6/RTSM6 - фьючерсные контракты с экспирацией в июне 2026
    underlying = "RTS"  # Базовый актив для опционов (индекс РТС)
    futures_contract = "RTSM6"  # Фьючерсный контракт для получения цены
    
    # 4. Опционально: указываем экспирацию (формат "MM.YY")
    # Если None - будет использована ближайшая экспирация
    expiration = "6.26"  # или None для автовыбора

    print(f"\n📈 Базовый актив: {underlying}")
    print(f"📄 Фьючерс: {futures_contract}")
    if expiration:
        print(f"📅 Экспирация: {expiration}")
    else:
        print("📅 Экспирация: ближайшая (автовыбор)")
    print()

    # 5. Запускаем анализ
    df = analyzer.fetch_and_analyze(underlying, expiration=expiration, futures_contract=futures_contract)

    if df.empty:
        print("\n⚠️ Анализ не выполнен (нет данных)")
    else:
        print("\n✅ Программа успешно завершена.")

if __name__ == "__main__":
    main()
