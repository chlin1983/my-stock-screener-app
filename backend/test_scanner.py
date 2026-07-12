import unittest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

import config
import scanner

class TestStockScreener(unittest.TestCase):
    
    def generate_dummy_uptrend(self, length=300):
        """Generates a dummy stock price history with a clear Stage 2 uptrend."""
        dates = [datetime.now() - timedelta(days=i) for i in range(length)]
        dates.reverse()
        
        # Start at 50 and trend upwards to 150
        base_price = np.linspace(50, 150, length)
        # Add random noise
        np.random.seed(42)
        noise = np.random.normal(0, 1.5, length)
        close_prices = base_price + noise
        
        df = pd.DataFrame(index=dates)
        df["Close"] = close_prices
        # High and Low surrounding close
        df["High"] = close_prices + np.random.uniform(0.5, 2.0, length)
        df["Low"] = close_prices - np.random.uniform(0.5, 2.0, length)
        df["Open"] = close_prices + np.random.uniform(-1.0, 1.0, length)
        df["Volume"] = np.random.uniform(100000, 1000000, length)
        
        return df

    def test_trend_template_pass(self):
        df = self.generate_dummy_uptrend(300)
        # Verify it passes the trend template
        is_trend = scanner.check_trend_template(df)
        self.assertTrue(is_trend, "Dummy uptrend should pass the Trend Template")

    def test_ma20_pullback_detection(self):
        # Generate a stock in an uptrend
        df = self.generate_dummy_uptrend(300)
        
        # Modify the last few days to simulate a pullback and touch of MA20
        # Calculate moving average of the first 295 days
        ma20_series = df["Close"].rolling(window=20).mean()
        ma20_val = ma20_series.iloc[-6]
        
        # Make days t-4, t-3, t-2 down days (pullback)
        df.iloc[-4, df.columns.get_loc("Close")] = ma20_val * 1.08
        df.iloc[-3, df.columns.get_loc("Close")] = ma20_val * 1.05
        df.iloc[-2, df.columns.get_loc("Close")] = ma20_val * 1.03
        df.iloc[-1, df.columns.get_loc("Close")] = ma20_val * 1.002 # Initial value to compute MA20
        
        # Recalculate actual MA20 of today after these modifications
        actual_ma20 = df["Close"].rolling(window=20).mean().iloc[-1]
        
        # Set today's Low and Close relative to the actual MA20 to ensure touch
        df.iloc[-1, df.columns.get_loc("Open")] = actual_ma20 * 1.02
        df.iloc[-1, df.columns.get_loc("High")] = actual_ma20 * 1.03
        df.iloc[-1, df.columns.get_loc("Low")] = actual_ma20 * 0.998  # Dips below MA20
        df.iloc[-1, df.columns.get_loc("Close")] = actual_ma20 * 1.002 # Closes just above MA20
        
        params = {
            "tolerance_pct": 0.5,
            "min_pullback_days": 2,
            "trend_filter": False  # Disable long-term trend filter for simplified testing
        }
        
        res = scanner.check_ma20_pullback(df, params)
        self.assertTrue(res["is_pullback"], f"Should detect MA20 pullback: {res.get('reason')}")
        self.assertAlmostEqual(res["ma20"], actual_ma20, delta=0.1)


    def test_vcp_detection(self):
        # Generate an uptrend base
        df = self.generate_dummy_uptrend(300)
        
        # Let's override the last 100 days to form a beautiful Volatility Contraction Pattern (VCP)
        # Peak of base at 150
        # Contraction 1: Pulls back 20% to 120, then bounces back to 148
        # Contraction 2: Pulls back 10% to 133, then bounces back to 147
        # Contraction 3 (Pivot): Pulls back 4% to 141, then consolidates at 145
        
        # We'll programmatically set close prices for the last 100 days
        prices = list(df["Close"].values[:-100])
        start_price = prices[-1]
        
        # Swing 1: 40 days. Peak at 150, Trough at 120, bounce to 148
        for i in range(15): # rise to 150
            prices.append(start_price + (150 - start_price) * (i / 15))
        for i in range(15): # drop to 120
            prices.append(150 - 30 * (i / 15))
        for i in range(10): # bounce to 148
            prices.append(120 + 28 * (i / 10))
            
        # Swing 2: 30 days. Peak at 148, Trough at 133, bounce to 147
        for i in range(15): # drop to 133
            prices.append(148 - 15 * (i / 15))
        for i in range(15): # bounce to 147
            prices.append(133 + 14 * (i / 15))
            
        # Swing 3: 30 days. Peak at 147, Trough at 141, bounce to 145 (tight range)
        for i in range(10): # drop to 141
            prices.append(147 - 6 * (i / 10))
        for i in range(10): # bounce to 145
            prices.append(141 + 4 * (i / 10))
        for i in range(10): # tight consolidation (pivot)
            prices.append(145 + np.sin(i) * 0.5)
            
        # Update df values
        for idx in range(100):
            df_idx = -100 + idx
            price_val = prices[df_idx]
            df.iloc[df_idx, df.columns.get_loc("Close")] = price_val
            df.iloc[df_idx, df.columns.get_loc("High")] = price_val + 0.5
            df.iloc[df_idx, df.columns.get_loc("Low")] = price_val - 0.5
            # Make volume dry up in the last 10 days
            if idx >= 90:
                df.iloc[df_idx, df.columns.get_loc("Volume")] = 50000 # Lower than normal
            else:
                df.iloc[df_idx, df.columns.get_loc("Volume")] = 200000
                
        params = {
            "trend_template": False, # Disable for simplified test
            "max_tightness_pct": 8.0,
            "volume_dryup_pct": 70.0,
            "min_contractions": 2,
            "max_contractions": 4,
            "consolidation_days": 100
        }
        
        res = scanner.check_vcp(df, params)
        self.assertTrue(res["is_vcp"], f"Should detect VCP setup: {res.get('reason')}")
        self.assertLessEqual(res["final_tightness"], 8.0)

    def test_exchange_tickers(self):
        # Test fetching exchange tickers
        amex_tickers = scanner.get_exchange_tickers("amex")
        self.assertTrue(len(amex_tickers) > 0, "Should fetch AMEX tickers successfully")
        self.assertIsInstance(amex_tickers, list)
        self.assertTrue(all(t.isalpha() and t.isupper() for t in amex_tickers), "All tickers must be alphabetic and uppercase")
        
        # Test NYSE
        nyse_tickers = scanner.get_exchange_tickers("nyse")
        self.assertTrue(len(nyse_tickers) > 0, "Should fetch NYSE tickers successfully")
        self.assertIn("A", nyse_tickers) # Agilent is NYSE

if __name__ == "__main__":
    unittest.main()
