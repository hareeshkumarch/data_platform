"""Synthetic demo dataset generators.

Each generator yields a pandas DataFrame and a human-readable name. The
resulting CSV is persisted to disk + registered with the existing
ingestion pipeline so the rest of Lumen (preview, schema, analytics)
treats it like any user-uploaded dataset.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from typing import Callable, Dict, Tuple

import numpy as np
import pandas as pd


Generator = Callable[[int, int], pd.DataFrame]


def _seed(seed: int | None) -> None:
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)


# ---------------------------------------------------------------------------
# Sales performance
# ---------------------------------------------------------------------------


def _sales(rows: int = 420, seed: int = 7) -> pd.DataFrame:
    _seed(seed)
    regions = ["North", "South", "East", "West", "Central"]
    products = ["Aurora", "Nebula", "Pulsar", "Quasar", "Helios"]
    segments = ["Enterprise", "SMB", "Startup", "Government"]
    channels = ["Direct", "Partner", "Online", "Reseller"]
    start = date(2024, 1, 1)
    records = []
    for i in range(rows):
        month = start + timedelta(days=(i % 18) * 28)
        region = random.choice(regions)
        segment = random.choice(segments)
        base = (
            35_000 if segment == "Enterprise" else 12_000 if segment == "SMB" else 6_000
        )
        revenue = round(max(500, np.random.normal(base, base * 0.25)), 2)
        cost = round(revenue * random.uniform(0.34, 0.68), 2)
        records.append(
            {
                "date": month.isoformat(),
                "region": region,
                "product": random.choice(products),
                "segment": segment,
                "channel": random.choice(channels),
                "revenue": revenue,
                "cost": cost,
                "profit": round(revenue - cost, 2),
                "customers": random.randint(40, 520),
                "deals_won": random.randint(2, 48),
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# E-commerce order log
# ---------------------------------------------------------------------------


def _ecommerce(rows: int = 600, seed: int = 11) -> pd.DataFrame:
    _seed(seed)
    categories = [
        "Electronics",
        "Home",
        "Fashion",
        "Beauty",
        "Sports",
        "Books",
        "Grocery",
    ]
    status = ["shipped", "delivered", "returned", "cancelled", "processing"]
    countries = ["US", "UK", "DE", "FR", "IN", "BR", "AU", "CA"]
    start = datetime(2024, 6, 1)
    records = []
    for i in range(rows):
        ts = start + timedelta(minutes=int(np.random.exponential(1200) + i * 3))
        qty = random.randint(1, 6)
        price = round(max(5, np.random.gamma(shape=2.5, scale=28)), 2)
        records.append(
            {
                "order_id": f"ORD-{100000 + i}",
                "order_ts": ts.isoformat(),
                "country": random.choice(countries),
                "category": random.choice(categories),
                "status": random.choice(status),
                "quantity": qty,
                "unit_price": price,
                "gross_amount": round(qty * price, 2),
                "discount_pct": random.choice([0, 0, 5, 10, 15, 25]),
                "shipping_cost": round(random.uniform(0, 12.5), 2),
                "customer_id": f"CUST-{random.randint(1, 220)}",
                "rating": random.choice([None, 3, 4, 4, 5, 5, 5, 2]),
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Marketing campaigns
# ---------------------------------------------------------------------------


def _marketing(rows: int = 280, seed: int = 19) -> pd.DataFrame:
    _seed(seed)
    channels = ["google_ads", "meta_ads", "linkedin", "email", "seo", "partner"]
    campaigns = [
        "winter_launch",
        "spring_reboot",
        "retention_30d",
        "enterprise_abm",
        "student_deal",
        "holiday_bundle",
    ]
    start = date(2024, 1, 1)
    records = []
    for i in range(rows):
        day = start + timedelta(days=i % 240)
        impressions = int(max(100, np.random.gamma(3.1, 1200)))
        ctr = round(random.uniform(0.004, 0.07), 4)
        clicks = int(impressions * ctr)
        cvr = round(random.uniform(0.01, 0.12), 4)
        conversions = int(clicks * cvr)
        spend = round(impressions * random.uniform(0.002, 0.020), 2)
        revenue = round(conversions * random.uniform(10, 185), 2)
        records.append(
            {
                "date": day.isoformat(),
                "channel": random.choice(channels),
                "campaign": random.choice(campaigns),
                "impressions": impressions,
                "clicks": clicks,
                "ctr": ctr,
                "conversions": conversions,
                "cvr": cvr,
                "spend": spend,
                "revenue": revenue,
                "roas": round(revenue / spend, 2) if spend else 0.0,
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Finance / portfolio
# ---------------------------------------------------------------------------


def _finance(rows: int = 520, seed: int = 23) -> pd.DataFrame:
    _seed(seed)
    tickers = [
        "AAPL",
        "MSFT",
        "NVDA",
        "GOOGL",
        "META",
        "AMZN",
        "TSLA",
        "NFLX",
        "AMD",
        "CRM",
    ]
    records = []
    start = date(2024, 1, 2)
    for ticker in tickers:
        price = random.uniform(90, 420)
        for i in range(rows // len(tickers)):
            d = start + timedelta(days=i)
            drift = np.random.normal(0.0005, 0.022)
            price = max(20, price * (1 + drift))
            volume = int(max(200_000, np.random.gamma(2.1, 9e6)))
            records.append(
                {
                    "date": d.isoformat(),
                    "ticker": ticker,
                    "open": round(price * random.uniform(0.99, 1.01), 2),
                    "close": round(price, 2),
                    "high": round(price * random.uniform(1.001, 1.035), 2),
                    "low": round(price * random.uniform(0.965, 0.999), 2),
                    "volume": volume,
                    "sector": random.choice(
                        ["Tech", "Tech", "Media", "Retail", "Automotive"]
                    ),
                }
            )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# HR / people analytics
# ---------------------------------------------------------------------------


def _hr(rows: int = 300, seed: int = 29) -> pd.DataFrame:
    _seed(seed)
    depts = ["Engineering", "Sales", "Marketing", "Ops", "Finance", "Support", "HR"]
    levels = ["IC1", "IC2", "IC3", "IC4", "Manager", "Director"]
    genders = ["F", "M", "Non-binary", None]
    records = []
    for i in range(rows):
        hire = date(2020, 1, 1) + timedelta(days=random.randint(0, 1600))
        dept = random.choice(depts)
        level = random.choice(levels)
        base = {
            "IC1": 55,
            "IC2": 75,
            "IC3": 105,
            "IC4": 140,
            "Manager": 160,
            "Director": 210,
        }[level]
        salary = round(base * 1000 + np.random.normal(0, 12000), 2)
        attrition = random.random() < 0.12
        records.append(
            {
                "employee_id": f"EMP-{1000 + i}",
                "hire_date": hire.isoformat(),
                "department": dept,
                "level": level,
                "location": random.choice(
                    ["NYC", "SFO", "LON", "BLR", "BER", "Remote"]
                ),
                "gender": random.choice(genders),
                "tenure_months": int((date.today() - hire).days / 30),
                "salary_usd": salary,
                "performance_score": round(random.uniform(2.5, 5.0), 2),
                "engagement_score": round(random.uniform(3.0, 5.0), 2),
                "left_company": attrition,
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Customer churn
# ---------------------------------------------------------------------------


def _customers(rows: int = 500, seed: int = 31) -> pd.DataFrame:
    _seed(seed)
    plans = ["free", "starter", "pro", "business", "enterprise"]
    records = []
    for i in range(rows):
        signup = date(2023, 1, 1) + timedelta(days=random.randint(0, 700))
        plan = random.choice(plans)
        mrr = {
            "free": 0,
            "starter": 29,
            "pro": 99,
            "business": 299,
            "enterprise": 1200,
        }[plan]
        active = random.random() < 0.78
        records.append(
            {
                "customer_id": f"CUST-{10000 + i}",
                "signup_date": signup.isoformat(),
                "plan": plan,
                "country": random.choice(
                    ["US", "UK", "DE", "IN", "BR", "CA", "AU", "FR"]
                ),
                "industry": random.choice(
                    ["SaaS", "Retail", "Fintech", "Health", "Edu", "Media"]
                ),
                "mrr_usd": mrr
                + (random.randint(0, 350) if plan == "enterprise" else 0),
                "sessions_30d": int(np.random.poisson(14 if active else 3)),
                "tickets_30d": int(np.random.poisson(1.5)),
                "nps": random.choice([None, 0, 3, 5, 7, 8, 9, 10]),
                "churned": not active,
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# IoT sensor readings
# ---------------------------------------------------------------------------


def _iot(rows: int = 1000, seed: int = 37) -> pd.DataFrame:
    _seed(seed)
    sensors = [f"sensor-{i:02d}" for i in range(1, 9)]
    start = datetime(2024, 9, 1)
    records = []
    for i in range(rows):
        ts = start + timedelta(minutes=5 * i)
        sensor = random.choice(sensors)
        base_temp = 22 + (6 * np.sin(i / 288 * 2 * np.pi))
        anomaly = 1 if random.random() < 0.012 else 0
        records.append(
            {
                "ts": ts.isoformat(),
                "sensor_id": sensor,
                "location": random.choice(["plant-a", "plant-b", "warehouse"]),
                "temperature_c": round(
                    base_temp + np.random.normal(0, 0.9) + anomaly * 8, 2
                ),
                "humidity_pct": round(45 + np.random.normal(0, 6), 1),
                "pressure_kpa": round(101.3 + np.random.normal(0, 0.35), 2),
                "vibration_g": round(
                    abs(np.random.normal(0.12, 0.04)) + anomaly * 0.5, 4
                ),
                "power_w": round(abs(np.random.normal(420, 25)), 2),
                "is_anomaly": bool(anomaly),
            }
        )
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

GENERATORS: Dict[str, Tuple[str, Generator]] = {
    "sales": ("Sales Performance (Sample)", _sales),
    "ecommerce": ("E-commerce Orders (Sample)", _ecommerce),
    "marketing": ("Marketing Campaigns (Sample)", _marketing),
    "finance": ("Stock Prices (Sample)", _finance),
    "hr": ("People Analytics (Sample)", _hr),
    "customers": ("Customer Churn (Sample)", _customers),
    "iot": ("IoT Sensor Telemetry (Sample)", _iot),
}


def list_demo_kinds() -> list[dict]:
    """Catalogue surfaced to the UI."""
    descriptions: Dict[str, str] = {
        "sales": "Monthly revenue, cost, customers and deals by region, product & segment.",
        "ecommerce": "Order-level data with status, categories, discounts, ratings.",
        "marketing": "Campaign performance — impressions, CTR, conversions, ROAS.",
        "finance": "Daily OHLCV prices across 10 tickers.",
        "hr": "Employee demographics, tenure, salary, performance and attrition.",
        "customers": "Subscription + usage data ideal for churn & cohort analysis.",
        "iot": "5-minute sensor telemetry with synthetic anomaly flags.",
    }
    return [
        {"kind": k, "label": v[0], "description": descriptions.get(k, "")}
        for k, v in GENERATORS.items()
    ]


def generate_demo(kind: str) -> Tuple[str, bytes]:
    """Return (human-readable filename, csv bytes) for the requested kind."""
    if kind not in GENERATORS:
        raise KeyError(f"Unknown demo dataset: {kind}")
    _label, fn = GENERATORS[kind]
    df = fn()  # generators use their own defaults
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    filename = f"{kind}_sample.csv"
    return filename, csv_bytes
