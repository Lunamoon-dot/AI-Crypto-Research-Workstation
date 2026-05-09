from tradingagents.graph import ResearchAgentsGraph
from tradingagents.config.loader import ConfigLoader

# ConfigLoader handles .env loading, config file layering, and validation
loader = ConfigLoader()
config = loader.load(
    cli_overrides={
        "deep_think_llm": "gpt-5.4-mini",
        "quick_think_llm": "gpt-5.4-mini",
        "max_debate_rounds": 1,
    },
)

# Initialize with custom config
ta = ResearchAgentsGraph(debug=True, config=config)

# forward propagate
_, decision = ta.propagate("ETH/USDT", "2024-05-10")
print(decision)

# Memorize mistakes and reflect
# ta.reflect_and_remember(1000)
