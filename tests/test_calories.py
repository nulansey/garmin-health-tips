from src.main import calorie_target


def test_deficit_subtracts_amount():
    assert calorie_target(2650, "deficit", 500) == 2150


def test_maintain_ignores_amount():
    assert calorie_target(2650, "maintain", 500) == 2650


def test_surplus_adds_amount():
    assert calorie_target(2650, "surplus", 300) == 2950


def test_rounds_to_nearest_50():
    assert calorie_target(2649, "maintain", 0) == 2650


def test_never_recommends_below_1200():
    assert calorie_target(1500, "deficit", 800) == 1200
