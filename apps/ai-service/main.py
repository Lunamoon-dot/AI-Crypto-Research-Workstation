"""Minimal example: run a single-ticker analysis programmatically.

Usage:
    python main.py
"""

if __name__ == "__main__":
    from luna_workstation.graph import ResearchAgentsGraph

    ta = ResearchAgentsGraph(debug=True)
    _, decision = ta.propagate("ETH/USDT", "2024-05-10")
    print(decision)
