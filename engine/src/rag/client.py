import httpx


class RAGClient:
    def __init__(self, server_url, collection_name, search_type="keyword", top_k=3, alpha=0, rerank=False):
        self.server_url = server_url.rstrip("/")
        self.collection = collection_name
        self.search_type = search_type
        self.top_k = top_k
        self.alpha = alpha
        self.rerank = rerank

    async def search(self, query):
        payload = {
            "query": query,
            "collection": self.collection,
            "search_type": self.search_type,
            "top_k": self.top_k,
            "alpha": self.alpha,
            "rerank": self.rerank,
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(f"{self.server_url}/search", json=payload)
                resp.raise_for_status()
                data = resp.json()
            return data.get("results", [])
        except Exception:
            return []

    def format_results(self, results):
        parts = ["KNOWLEDGE BASE CONTEXT:"]
        for i, r in enumerate(results, 1):
            section = r.get("section", "")
            content = r.get("content", "")
            if section:
                parts.append(f"[{i}] ({section}) {content}")
            else:
                parts.append(f"[{i}] {content}")
        return "\n".join(parts)
