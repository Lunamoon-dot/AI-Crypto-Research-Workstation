from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel


class AssetClass(str, Enum):
    STOCK = "stock"
    CRYPTO = "crypto"


class AnalystType(str, Enum):
    MARKET = "market"
    SOCIAL = "social"
    NEWS = "news"
    ONCHAIN = "onchain"
