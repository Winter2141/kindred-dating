"""A small built-in gazetteer, so a typed city can become coordinates without a geocoding API.

Coordinates are city or neighbourhood centres, which is all distance matching needs; nobody's
exact position is stored unless their browser shares it.
"""

PLACES: dict[str, tuple[float, float]] = {
    # New York City and around
    "Brooklyn, NY": (40.6782, -73.9442),
    "Williamsburg, NY": (40.7081, -73.9571),
    "Park Slope, NY": (40.6710, -73.9814),
    "Bushwick, NY": (40.6958, -73.9171),
    "Manhattan, NY": (40.7831, -73.9712),
    "Harlem, NY": (40.8116, -73.9465),
    "Lower East Side, NY": (40.7150, -73.9843),
    "Queens, NY": (40.7282, -73.7949),
    "Astoria, NY": (40.7644, -73.9235),
    "Long Island City, NY": (40.7447, -73.9485),
    "The Bronx, NY": (40.8448, -73.8648),
    "Staten Island, NY": (40.5795, -74.1502),
    "Yonkers, NY": (40.9312, -73.8988),
    "Jersey City, NJ": (40.7178, -74.0431),
    "Hoboken, NJ": (40.7440, -74.0324),
    "Newark, NJ": (40.7357, -74.1724),
    "Princeton, NJ": (40.3573, -74.6672),
    "New Haven, CT": (41.3083, -72.9279),
    # Elsewhere in North America
    "Philadelphia, PA": (39.9526, -75.1652),
    "Boston, MA": (42.3601, -71.0589),
    "Washington, DC": (38.9072, -77.0369),
    "Chicago, IL": (41.8781, -87.6298),
    "Atlanta, GA": (33.7490, -84.3880),
    "Miami, FL": (25.7617, -80.1918),
    "Austin, TX": (30.2672, -97.7431),
    "Denver, CO": (39.7392, -104.9903),
    "Los Angeles, CA": (34.0522, -118.2437),
    "San Francisco, CA": (37.7749, -122.4194),
    "Portland, OR": (45.5152, -122.6784),
    "Seattle, WA": (47.6062, -122.3321),
    "Toronto, ON": (43.6532, -79.3832),
    "Montreal, QC": (45.5019, -73.5674),
    # Europe
    "London, UK": (51.5074, -0.1278),
    "Paris, France": (48.8566, 2.3522),
    "Berlin, Germany": (52.5200, 13.4050),
    "Lisbon, Portugal": (38.7223, -9.1393),
}

_BY_KEY = {name.lower(): coords for name, coords in PLACES.items()}
_BY_SHORT_NAME = {name.split(",")[0].lower(): coords for name, coords in PLACES.items()}
_NAMES = {name.lower(): name for name in PLACES} | {
    name.split(",")[0].lower(): name for name in PLACES
}


def geocode(city: str) -> tuple[float, float] | None:
    """Coordinates for a known place, matching "Brooklyn, NY" or just "brooklyn"."""
    key = " ".join(city.lower().split())
    if not key:
        return None
    return _BY_KEY.get(key) or _BY_SHORT_NAME.get(key.split(",")[0].strip())


def canonical(city: str) -> str | None:
    """The gazetteer's own spelling of a known place ("lisbon" -> "Lisbon, Portugal")."""
    key = " ".join(city.lower().split())
    return _NAMES.get(key) or _NAMES.get(key.split(",")[0].strip()) if key else None


def search(query: str, limit: int = 8) -> list[str]:
    """Known places for an autocomplete box: prefix matches first, then substring matches."""
    needle = query.strip().lower()
    if not needle:
        return []
    starts = [n for n in PLACES if n.lower().startswith(needle)]
    contains = [n for n in PLACES if needle in n.lower() and n not in starts]
    return (starts + contains)[:limit]
