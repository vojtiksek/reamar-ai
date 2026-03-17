import csv
import os

import requests


def main() -> None:
    """
    Export all projects in region 'Hlavní město Praha' to a CSV file.

    Columns: Developer; Název projektu; Odkaz na web; Počet jednotek
    """

    api_base = os.environ.get("API_BASE", "http://localhost:8000")

    # Načteme všechny projekty po stránkách (max 500 na dotaz) a filtrujeme
    # na straně Pythonu podle region_iga == "Hlavní město Praha".
    limit = 500
    offset = 0
    items: list[dict] = []
    while True:
        params = {
            "limit": limit,
            "offset": offset,
            "include_archived": "true",
        }
        resp = requests.get(f"{api_base}/projects", params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        page_items = data.get("items", []) or []
        items.extend(page_items)
        if len(page_items) < limit:
            break
        offset += limit

    # Filtrujeme jen projekty v kraji „Hlavní město Praha“
    filtered = [
        p
        for p in items
        if (p.get("region_iga") or "").strip() == "Hlavní město Praha"
    ]

    out_path = os.path.join(os.path.dirname(__file__), "projekty_praha.csv")

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["Developer", "Název projektu", "Odkaz na web", "Počet jednotek"])
        for p in filtered:
            developer = (p.get("developer") or "").strip()
            name = (p.get("project") or p.get("name") or "").strip()
            url = (p.get("project_url") or "").strip()
            total_units = p.get("total_units") or ""
            writer.writerow([developer, name, url, total_units])

    print(f"Napsáno {len(filtered)} projektů do {out_path}")


if __name__ == "__main__":
    main()

