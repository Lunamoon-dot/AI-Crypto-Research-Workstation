from luna_workstation.graph.node_names import ToolKey
from luna_workstation.graph.tooling import create_tool_nodes


def _tool_names(node) -> set[str]:
    return set(node.tools_by_name)


def test_social_tool_node_only_exposes_social_sentiment_tools():
    nodes = create_tool_nodes({})

    assert _tool_names(nodes[ToolKey.SOCIAL]) == {
        "get_fear_greed_index",
        "get_social_sentiment",
    }


def test_news_tool_node_excludes_news_sentiment_heuristic():
    nodes = create_tool_nodes({})

    assert _tool_names(nodes[ToolKey.NEWS]) == {
        "get_news",
        "get_global_news",
    }


def test_social_tool_node_excludes_news_tools():
    nodes = create_tool_nodes({})

    social_tools = _tool_names(nodes[ToolKey.SOCIAL])

    assert "get_news" not in social_tools
    assert "get_global_news" not in social_tools
    assert "get_news_sentiment_aggregate" not in social_tools
