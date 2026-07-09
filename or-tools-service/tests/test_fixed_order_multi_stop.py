import pytest

from app.services import ortools_solver as solver


@pytest.mark.asyncio
async def test_fixed_order_multi_stop_uses_sequential_primary_and_skips_alts(monkeypatch):
    captured_orders: list[list[int]] = []
    alt_solve_calls = {"count": 0}

    async def fake_snap(lat, lon, client):
        return lat, lon, False

    async def fake_matrix(coords, avoided, o_state, d_state):
        n = len(coords)
        matrix = [[0 if i == j else 1000 for j in range(n)] for i in range(n)]
        return matrix, True

    async def fake_build_route(order, stops, load, matrix):
        captured_orders.append(list(order))
        return {
            "routeCorridor": ["NE", "ND"],
            "distanceMeters": 50000,
            "durationSeconds": 3600,
            "highways": [],
            "notes": [],
        }

    class FakeRouting:
        def RegisterTransitCallback(self, _cb):
            return 0

        def SetArcCostEvaluatorOfAllVehicles(self, _cb):
            return None

        def SolveWithParameters(self, _params):
            alt_solve_calls["count"] += 1
            return None

        def Start(self, _vehicle):
            return 0

        def IsEnd(self, _idx):
            return True

        def NextVar(self, _idx):
            return 0

    class FakeManager:
        def __init__(self, n, _vehicles, _starts, _ends):
            self.n = n

        def IndexToNode(self, idx):
            return idx

    monkeypatch.setattr(solver, "snap_to_state_highway", fake_snap)
    monkeypatch.setattr(solver, "_build_distance_matrix", fake_matrix)
    monkeypatch.setattr(solver, "_build_route_info_from_order", fake_build_route)
    monkeypatch.setattr(solver.pywrapcp, "RoutingIndexManager", FakeManager)
    monkeypatch.setattr(solver.pywrapcp, "RoutingModel", lambda _manager: FakeRouting())

    load = {
        "origin": {"city": "Grand Island", "state": "NE"},
        "destination": {"city": "Dickinson", "state": "ND"},
        "drops": [
            {"query": "Minot", "lat": 48.232, "lon": -101.296, "city": "Minot", "state": "ND"},
            {"query": "Dickinson", "lat": 46.879, "lon": -102.789, "city": "Dickinson", "state": "ND"},
        ],
        "weight": 80000,
        "length": 74,
        "width": 8.5,
        "height": 13.5,
        "originLat": 40.926,
        "originLon": -98.342,
        "destinationLat": 46.879,
        "destinationLon": -102.789,
    }

    result = await solver.optimize_route(load, max_alts=2)

    assert result["status"] == "ok"
    assert captured_orders == [[0, 1, 2]]
    assert result["alternatives"] == []
    assert alt_solve_calls["count"] == 1
    assert result["meta"]["num_stops"] == 3