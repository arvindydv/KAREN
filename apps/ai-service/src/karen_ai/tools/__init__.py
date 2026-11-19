"""Tool registry. The LLM may only *propose* tool calls; side-effecting tools are executed by the
action plane (Temporal + API policy), never by this service."""
