import sys
sys.path.insert(0, '.')
from tradingagents.storage.repositories import JournalRepository
import inspect

methods = ['save_signals', 'save_agent_opinions', 'save_thesis', 'save_debate', 
           'save_scenarios', 'save_research_run', 'complete_research_run',
           'save_user_decision', 'save_outcome_review']

for m in methods:
    src = inspect.getsource(getattr(JournalRepository, m))
    print(f"=== {m} ===")
    print(src)
    print()
