from app.import_semantics import (
    canonicalize_floor_materials,
    canonicalize_heating,
    canonicalize_partition_walls,
    canonicalize_windows,
)


def test_canonicalize_windows_handles_hybrid_and_unknown_forms():
    assert canonicalize_windows('aluminum-wood') == ['aluminum_wood']
    assert canonicalize_windows('aluminum-PVC') == ['aluminum_pvc']


def test_canonicalize_partition_walls_handles_mixed_language_values():
    assert canonicalize_partition_walls('beton') == ['concrete']
    assert canonicalize_partition_walls('SDK, brick') == ['drywall', 'brick']


def test_canonicalize_heating_handles_single_and_mixed_values():
    assert canonicalize_heating('conventional, underfloor') == ['conventional', 'underfloor']
    assert canonicalize_heating('central') == ['central']


def test_canonicalize_floor_materials_handles_mixed_materials():
    assert canonicalize_floor_materials('laminate, vinyl') == ['laminate', 'vinyl']
    assert canonicalize_floor_materials('wood') == ['hardwood']
